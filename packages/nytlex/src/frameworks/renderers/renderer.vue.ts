/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Metadata, RouteConfig } from '../../types.ts';
import { getLayout } from '../../router.ts';
import type { GenericRequest } from '../../types/framework.ts';
import fs from 'fs';
import path from 'path';
import {
    getRequestUrl,
    polyfillBrowserEnv,
    obfuscateData,
    generateMetaTags,
    extractComponentPreloads,
    getBuildAssets,
    BuildAssets, withSilencedConsoleSync,
} from '../../renderers/common.ts';

import * as vue from "vue";
import * as vueServerRenderer from "@vue/server-renderer";

// Importa os geradores de HTML Vanilla
import { getBuildingScreenHtml } from '../themes/BuildingPage';
import { getServerErrorHtml } from '../themes/ServerError';
polyfillBrowserEnv();



async function withSilencedConsoleAsync<T>(fn: () => Promise<T>): Promise<T> {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    console.info = () => {};

    try {
        return await fn();
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        console.info = originalInfo;
    }
}

function buildVueShellDocument(options: {
    lang: string;
    title: string;
    metaTagsHtml: string;
    scriptPreloadsHtml: string;
    componentPreloadsHtml: string;
    stylesHtml: string;
    obfuscatedData: string;
    scriptsHtml: string;
    hotReloadScript: string;
    bodyInnerHtml: string;
}): string {
    const {
        lang,
        title,
        metaTagsHtml,
        scriptPreloadsHtml,
        componentPreloadsHtml,
        stylesHtml,
        obfuscatedData,
        scriptsHtml,
        hotReloadScript,
        bodyInnerHtml,
    } = options;

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <title>${title}</title>
    ${metaTagsHtml}
    ${scriptPreloadsHtml}
    ${componentPreloadsHtml}
    ${stylesHtml}
</head>
<body>
    <div id="root">${bodyInnerHtml || ''}</div>
    ${scriptsHtml}
    ${hotReloadScript ? `<div style="display:none">${hotReloadScript}</div>` : ''}
</body>
</html>`;
}

function ensureVueComponent(existingComponent: any, componentPath: string): any {
    let component = existingComponent;
    if (!component && componentPath) {
        try {
            // Silenciamos o require do componente inicial
            component = withSilencedConsoleSync(() => {
                const module = require(componentPath);
                return module.default || module;
            });
        } catch (e) { return null; }
    }
    if (!component) return null;

    if (typeof component === 'object' && !component.render && !component.ssrRender && componentPath && componentPath.endsWith('.vue')) {
        try {
            withSilencedConsoleSync(() => {
                const sfc = require('vue/compiler-sfc');
                const esbuild = require('esbuild');
                const source = fs.readFileSync(componentPath, 'utf8');
                const { descriptor } = sfc.parse(source, { filename: componentPath });
                if (descriptor.template) {
                    const templateResult = sfc.compileTemplate({
                        source: descriptor.template.content,
                        filename: componentPath,
                        id: componentPath,
                        ssr: true
                    });
                    if (templateResult.code) {
                        const transformed = esbuild.transformSync(templateResult.code, { loader: 'js', format: 'cjs', target: 'node16' });
                        const mod = { exports: {} as any };
                        const runModule = new Function('module', 'exports', 'require', transformed.code);
                        runModule(mod, mod.exports, require);
                        if (mod.exports.ssrRender) component.ssrRender = mod.exports.ssrRender;
                    }
                }
            });
        } catch (e) {
            // Falhas silenciadas
        }
    }
    return component;
}

interface RenderOptions {
    req: GenericRequest;
    res: any;
    route: RouteConfig & { componentPath: string };
    params: Record<string, string>;
    allRoutes: (RouteConfig & { componentPath: string })[];
}

export async function renderVue({ req, res, route, params, allRoutes }: RenderOptions): Promise<void> {

    // EXTRAÍMOS FRAGMENT E COMMENT VNODE NATIVOS DO VUE
    const { createSSRApp, h, Fragment, createCommentVNode } = vue;
    const { renderToString } = vueServerRenderer as any;
    const { generateMetadata } = route;
    const isProduction = !(req as any).hwebDev;
    const hotReloadManager = (req as any).hotReloadManager;

    let assets: BuildAssets | null = null;
    let metadata: Metadata = { title: 'Nytlex App' };
    let layoutInfo: any = null;

    try {
        assets = getBuildAssets();

        // 1. Loading Screen (Vanilla)
        if (!assets || assets.scripts.length === 0) {
            const loadingHtml = getBuildingScreenHtml();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(loadingHtml);
            return;
        }

        // 2. Setup (Layout/Metadata)
        layoutInfo = getLayout();
        let LayoutComponent: any = null;
        if (layoutInfo) {
            LayoutComponent = ensureVueComponent(null, path.resolve(process.cwd(), layoutInfo.componentPath));
        }

        if (layoutInfo?.metadata) metadata = { ...metadata, ...layoutInfo.metadata };
        if (generateMetadata) {
            const routeMetadata = await Promise.resolve(generateMetadata(params, req));
            metadata = { ...metadata, ...routeMetadata };
        }

        const results = await Promise.all(allRoutes.map(async (r) => {
            let routeMeta = r.generateMetadata ? await Promise.resolve(r.generateMetadata(params, req)) : {};
            return { pattern: r.pattern, componentPath: r.componentPath, metadata: { ...routeMeta, title: routeMeta.title || layoutInfo?.metadata.title || 'Nytlex App' } };
        }));

        const obfuscatedData = obfuscateData({ routes: results, initialComponentPath: route.componentPath, initialParams: params });
        const hotReloadScript = !isProduction && hotReloadManager ? hotReloadManager.getClientScript() : '';
        const metaTagsHtml = generateMetaTags(metadata);
        const htmlLang = metadata.language || 'pt-BR';
        const stylesHtml = assets.styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n');
        const scriptsHtml = assets.scripts.map(s => `<script type="module" src="${s}"></script>`).join('\n');

        let bodyInnerHtml = '';

        // Ignora a renderização SSR caso esteja no modo export.
        // O Vue será montado inteiramente no lado do cliente (Client-Side Rendering)
        if (process.env.NYTLEX_MODE !== 'export') {
            let PageComponent = ensureVueComponent(route.component, route.componentPath ? path.resolve(process.cwd(), route.componentPath) : '');

            const RootComponent = {
                setup() {
                    return () => {
                        const pageNode = PageComponent ? h(PageComponent as any, { params }) : h('div', 'Page not found');
                        const mainNode = LayoutComponent ? h(LayoutComponent, null, { default: () => pageNode }) : pageNode;

                        // A MÁGICA: Retornamos um Fragmento imitando o App.vue
                        // Injetamos os nós de comentários que simulam os componentes Web (DevBadge e ErrorModal)
                        // que possuem v-if="false" no lado do servidor/primeiro render.
                        return h(Fragment, null, [
                            mainNode,
                            createCommentVNode("v-if", true),
                            createCommentVNode("v-if", true)
                        ]);
                    };
                }
            };

            const app = createSSRApp(RootComponent);

            // Envolvemos a renderização assíncrona do SSR para silenciar qualquer log durante a montagem virtual
            bodyInnerHtml = await withSilencedConsoleAsync(() => renderToString(app));
        }

        const finalHtml = buildVueShellDocument({
            lang: htmlLang,
            title: metadata.title || 'Nytlex.js',
            metaTagsHtml,
            scriptPreloadsHtml: assets.scripts.map(s => `<link rel="modulepreload" href="${s}">`).join('\n'),
            componentPreloadsHtml: extractComponentPreloads(route.componentPath ? path.resolve(process.cwd(), route.componentPath) : '').join('\n'),
            stylesHtml,
            obfuscatedData,
            scriptsHtml,
            hotReloadScript,
            bodyInnerHtml,
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(finalHtml);

    } catch (err) {
        // Removemos o console.error original daqui para evitar ruído.
        // O erro já será mostrado formatado no front-end.

        // Fallback para o ServerError Vanilla
        let errorHtml = getServerErrorHtml({
            error: err,
            title: 'Critical SSR Render Error',
            requestUrl: getRequestUrl(req)
        });

        if (!isProduction && hotReloadManager) {
            errorHtml = errorHtml.replace('</body>', `<div style="display:none">${hotReloadManager.getClientScript()}</div></body>`);
        }

        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(errorHtml);
    }
}