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
import { createRequire } from 'module';
import {
    getRequestUrl,
    polyfillBrowserEnv,
    obfuscateData,
    generateMetaTags,
    extractComponentPreloads,
    getBuildAssets,
    BuildAssets,
} from '../../renderers/common.ts';

// Importa os geradores de HTML Vanilla
import { getBuildingScreenHtml } from '../themes/BuildingPage';
import { getServerErrorHtml } from '../themes/ServerError';
polyfillBrowserEnv();
function buildSvelteShellDocument(options: {
    lang: string;
    title: string;
    metaTagsHtml: string;
    svelteHeadHtml: string;
    scriptPreloadsHtml: string;
    componentPreloadsHtml: string;
    stylesHtml: string;
    svelteCssHtml: string;
    obfuscatedData: string;
    scriptsHtml: string;
    hotReloadScript: string;
    bodyInnerHtml: string;
}): string {
    const {
        lang,
        title,
        metaTagsHtml,
        svelteHeadHtml,
        scriptPreloadsHtml,
        componentPreloadsHtml,
        stylesHtml,
        svelteCssHtml,
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
    ${svelteHeadHtml}
    ${scriptPreloadsHtml}
    ${componentPreloadsHtml}
    ${stylesHtml}
    ${svelteCssHtml}
</head>
<body>
    <div id="root">${bodyInnerHtml || ''}</div>
    ${scriptsHtml}
    ${hotReloadScript ? `<div style="display:none">${hotReloadScript}</div>` : ''}
</body>
</html>`;
}

function compileSvelteComponentForSSR(componentPath: string): any {
    try {
        const svelte = require('svelte/compiler');
        const esbuild = require('esbuild');
        const source = fs.readFileSync(componentPath, 'utf8');

        // Configuração do compilador para Svelte 5 SSR
        const result = svelte.compile(source, {
            generate: 'server',
            filename: componentPath,
            dev: false
        });

        if (result.js && result.js.code) {
            const transformed = esbuild.transformSync(result.js.code, {
                loader: 'js',
                format: 'cjs',
                target: 'node18' // Recomendado para Svelte 5
            });

            const mod = { exports: {} as any };
            const componentRequire = createRequire(path.resolve(componentPath));
            const runModule = new Function('module', 'exports', 'require', transformed.code);
            runModule(mod, mod.exports, componentRequire);

            return mod.exports.default || mod.exports;
        }
    } catch (e) {
        console.warn(`[Nytlex] Failed to compile Svelte SSR ${componentPath}:`, e);
        return null;
    }
}

function ensureSvelteComponent(existingComponent: any, componentPath: string): any {
    if (componentPath && componentPath.endsWith('.svelte')) {
        return compileSvelteComponentForSSR(componentPath);
    }
    let component = existingComponent;
    if (!component && componentPath) {
        try {
            const module = require(componentPath);
            component = module.default || module;
        } catch (e) {
            return null;
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

export async function renderSvelte({ req, res, route, params, allRoutes }: RenderOptions): Promise<void> {
    polyfillBrowserEnv();
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
            LayoutComponent = ensureSvelteComponent(null, path.resolve(process.cwd(), layoutInfo.componentPath));
        }

        if (layoutInfo?.metadata) metadata = { ...metadata, ...layoutInfo.metadata };
        if (generateMetadata) {
            const routeMetadata = await Promise.resolve(generateMetadata(params, req));
            metadata = { ...metadata, ...routeMetadata };
        }

        const results = await Promise.all(allRoutes.map(async (r) => {
            let routeMeta = r.generateMetadata ? await Promise.resolve(r.generateMetadata(params, req)) : {};
            return {
                pattern: r.pattern,
                componentPath: r.componentPath,
                metadata: { ...routeMeta, title: routeMeta.title || layoutInfo?.metadata.title || 'Nytlex App' }
            };
        }));

        const obfuscatedData = obfuscateData({ routes: results, initialComponentPath: route.componentPath, initialParams: params });
        const hotReloadScript = !isProduction && hotReloadManager ? hotReloadManager.getClientScript() : '';
        const metaTagsHtml = generateMetaTags(metadata);
        const htmlLang = metadata.language || 'pt-BR';
        const stylesHtml = assets.styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n');
        const scriptsHtml = assets.scripts.map(s => `<script type="module" src="${s}"></script>`).join('\n');

        let PageComponent = ensureSvelteComponent(route.component, route.componentPath ? path.resolve(process.cwd(), route.componentPath) : '');

        let bodyInnerHtml = '';
        let svelteHeadHtml = '';
        let svelteCssHtml = '';

        // Ignora a renderização SSR caso esteja no modo export.
        if (process.env.NYTLEX_MODE !== 'export') {
            if (PageComponent) {
                const { render } = require('svelte/server');

                if (LayoutComponent) {
                    const result = render(LayoutComponent, {
                        props: {
                            params,
                            children: ($$payload: any) => {
                                PageComponent($$payload, { params });
                            }
                        }
                    });

                    bodyInnerHtml = result.body || result.html || '';
                    svelteHeadHtml = result.head || '';
                } else {
                    const result = render(PageComponent, { props: { params } });
                    bodyInnerHtml = result.body || result.html || '';
                    svelteHeadHtml = result.head || '';
                }
            } else {
                bodyInnerHtml = '<div>Page not found</div>';
            }
        }

        const finalHtml = buildSvelteShellDocument({
            lang: htmlLang,
            title: metadata.title || 'Nytlex.js',
            metaTagsHtml,
            svelteHeadHtml,
            scriptPreloadsHtml: assets.scripts.map(s => `<link rel="modulepreload" href="${s}">`).join('\n'),
            componentPreloadsHtml: extractComponentPreloads(route.componentPath ? path.resolve(process.cwd(), route.componentPath) : '').join('\n'),
            stylesHtml,
            svelteCssHtml,
            obfuscatedData,
            scriptsHtml,
            hotReloadScript,
            bodyInnerHtml,
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(finalHtml);

    } catch (err) {
        if (!isProduction) console.error("Critical Svelte SSR Render Error:", err);

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