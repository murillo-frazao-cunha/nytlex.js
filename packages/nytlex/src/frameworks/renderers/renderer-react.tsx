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
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { RouteConfig, Metadata } from '../../types.ts';
import { getLayout } from '../../router.ts';
import type { GenericRequest, GenericResponse } from '../../types/framework.ts';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import {
    stripScriptTags,
    getRequestUrl,
    toError,
    polyfillBrowserEnv,
    requireWithoutStyles,
    generateMetaTags,
    getBuildAssets,
    extractComponentPreloads,
    BuildAssets,
} from '../../renderers/common.ts';

// Importa os geradores de HTML Vanilla
import { getBuildingScreenHtml } from '../themes/BuildingPage';
import { getServerErrorHtml } from '../themes/ServerError';

function buildShellHtml(options: {
    lang: string;
    title: string;
    metaTagsHtml: string;
    stylesHtml: string;
    hotReloadScript: string;
    scriptsHtml?: string;
}): string {
    const { lang, title, metaTagsHtml, stylesHtml, hotReloadScript, scriptsHtml } = options;

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <title>${title}</title>
    ${metaTagsHtml || ''}
    ${stylesHtml || ''}
</head>
<body>
    
    <div id="root"></div>
    ${scriptsHtml || ''}
    ${hotReloadScript ? `<div style="display:none">${hotReloadScript}</div>` : ''}
</body>
</html>`;
}

async function sendReactSsrFallback(options: {
    req: GenericRequest;
    res: any;
    isProduction: boolean;
    error: unknown;
    assets: BuildAssets;
    lang: string;
    title: string;
    metaTagsHtml: string;
    stylesHtml: string;
    hotReloadScript: string;
}): Promise<void | string> {
    const {
        req,
        res,
        isProduction,
        error,
        assets,
        lang,
        title,
        metaTagsHtml,
        stylesHtml,
        hotReloadScript,
    } = options;

    const scriptsHtml = assets.scripts
        .map((src) => `<script type="module" src="${src}"></script>`)
        .join('\n');

    if (process.env.NYTLEX_MODE === 'export') {
        if (isProduction) {
            return buildShellHtml({
                lang,
                title,
                metaTagsHtml,
                stylesHtml,
                hotReloadScript: '',
                scriptsHtml,
            });
        }

        const err = toError(error);
        let errorHtml = getServerErrorHtml({
            title: title || 'SSR Error',
            error: err,
            requestUrl: getRequestUrl(req),
            hint: "SSR failed to render this route. See the error below."
        });

        if (hotReloadScript) {
            errorHtml = errorHtml.replace('</body>', `<div style="display:none">${hotReloadScript}</div></body>`);
        }
        return errorHtml;
    }

    if (res.headersSent) {
        try {
            res.end();
        } catch {
            // ignore
        }
        return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = isProduction ? 200 : 500;

    if (isProduction) {
        res.end(
            buildShellHtml({
                lang,
                title,
                metaTagsHtml,
                stylesHtml,
                hotReloadScript: '',
                scriptsHtml,
            })
        );
        return;
    }

    const err = toError(error);

    // Gera o HTML do Erro via Vanilla JS
    let errorHtml = getServerErrorHtml({
        title: title || 'SSR Error',
        error: err,
        requestUrl: getRequestUrl(req),
        hint: "SSR failed to render this route. See the error below."
    });

    // Injeta o script de Hot Reload no HTML cru para continuar escutando mudanças
    if (hotReloadScript) {
        errorHtml = errorHtml.replace('</body>', `<div style="display:none">${hotReloadScript}</div></body>`);
    }

    res.end(errorHtml);
    return Promise.resolve();
}

// --- Componentes de Servidor ---

interface ServerRootProps {
    lang: string;
    title: string;
    metaTagsHtml: string;
    stylesHtml: string;
    initialDataScript: string;
    hotReloadScript: string;
    children: React.ReactNode;
}

function ServerRoot({ lang, title, metaTagsHtml, stylesHtml, initialDataScript, hotReloadScript, children }: ServerRootProps) {
    const headContent = `
        <meta charset="utf-8" />
        <title>${title}</title>
        ${initialDataScript ? `<script>${initialDataScript}</script>` : ''}
        ${metaTagsHtml || ''}
        ${stylesHtml || ''}
    `;

    return (
        <html lang={lang}>
        <head dangerouslySetInnerHTML={{ __html: headContent }} />

        <body>

        <div id="root">{children}</div>

        {hotReloadScript && (
            <div
                style={{ display: 'none' }}
                dangerouslySetInnerHTML={{ __html: hotReloadScript }}
            />
        )}
        </body>
        </html>
    );
}

// --- Renderização Principal ---

interface RenderOptions {
    req: GenericRequest;
    res: any;
    route: RouteConfig & { componentPath: string };
    params: Record<string, string>;
    allRoutes: (RouteConfig & { componentPath: string })[];
}

export async function render({ req, res, route, params, allRoutes }: RenderOptions): Promise<void | string> {
    polyfillBrowserEnv();

    const { generateMetadata } = route;
    const isProduction = !(req as any).hwebDev;
    const hotReloadManager = (req as any).hotReloadManager;

    let assets: BuildAssets | null = null;
    let metadata: Metadata = { title: 'Nytlex App' };
    let layoutInfo: any = null;

    try {
        assets = getBuildAssets();

        // 1. Verificar Build - Envia a página pura em Vanilla JS se não terminou de compilar
        if (!assets || assets.scripts.length === 0) {
            const html = getBuildingScreenHtml();
            if (process.env.NYTLEX_MODE === 'export') {
                return html;
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
            return;
        }

        // 2. Preparar Layout
        layoutInfo = getLayout();
        let LayoutComponent: any = null;

        if (layoutInfo) {
            try {
                const layoutModule = requireWithoutStyles<any>(path.resolve(process.cwd(), layoutInfo.componentPath));
                LayoutComponent = layoutModule.default;
            } catch (e) {
                console.error("Error loading layout component for SSR:", e);
            }
        }

        // 3. Preparar Metadata
        if (layoutInfo && layoutInfo.metadata) {
            metadata = { ...metadata, ...layoutInfo.metadata };
        }
        if (generateMetadata) {
            const routeMetadata = await Promise.resolve(generateMetadata(params, req));
            metadata = { ...metadata, ...routeMetadata };
        }

        // 4. Preparar Dados Iniciais
        const results = await Promise.all(
            allRoutes.map(async (r) => {
                let routeMeta: Metadata = {};
                if (r.generateMetadata) {
                    routeMeta = await r.generateMetadata(params, req);
                }
                if(!routeMeta.title) {
                    routeMeta.title = layoutInfo?.metadata.title || 'Nytlex App'
                }
                return {
                    pattern: r.pattern,
                    componentPath: r.componentPath,
                    metadata: routeMeta,
                }
            })
        );

        const initialData = {
            routes: results,
            initialComponentPath: route.componentPath,
            initialParams: params,
        };

        const hotReloadScript = !isProduction && hotReloadManager ? hotReloadManager.getClientScript() : '';
        const metaTagsHtml = generateMetaTags(metadata);
        const htmlLang = metadata.language || 'pt-BR';

        const stylesHtml = assets.styles.map(styleUrl => {
            const [basePath, query] = styleUrl.split('?');
            const finalUrl = !basePath.endsWith('.css') ? `${basePath}.css${query ? `?${query}` : ''}` : styleUrl;
            return `<link rel="stylesheet" href="${finalUrl}">`;
        }).join('\n');

        // 5. Componente da Página Atual
        const PageComponent = route.component;

        let AppTree = <PageComponent params={params} />;
        if (LayoutComponent) {
            AppTree = <LayoutComponent>{AppTree}</LayoutComponent>;
        }

        // 6. Streaming React
        return new Promise((resolve) => {
            let didError = false;
            let firstError: unknown = null;

            const stream = renderToPipeableStream(
                <ServerRoot
                    lang={htmlLang}
                    title={metadata.title || 'Nytlex.js'}
                    metaTagsHtml={metaTagsHtml}
                    stylesHtml={stylesHtml}
                    initialDataScript={`/* Data Injection */`}
                    hotReloadScript={hotReloadScript}
                >
                    {AppTree}
                </ServerRoot>,
                {
                    bootstrapModules: assets!.scripts,
                    onAllReady() {
                        if (didError) {
                            stream.abort();
                            sendReactSsrFallback({
                                req,
                                res,
                                isProduction,
                                error: firstError || new Error('SSR error'),
                                assets: assets!,
                                lang: htmlLang,
                                title: metadata.title || 'Nytlex.js',
                                metaTagsHtml,
                                stylesHtml,
                                hotReloadScript,
                            }).then(resolve as any);
                            return;
                        }

                        if (process.env.NYTLEX_MODE === 'export') {
                            let html = '';
                            const writable = new Writable({
                                write(chunk, _encoding, callback) {
                                    html += chunk.toString();
                                    callback();
                                }
                            });
                            writable.on('finish', () => resolve(html));
                            stream.pipe(writable);
                            return;
                        }

                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        stream.pipe(res);
                        resolve();
                    },
                    onShellError(error: any) {
                        firstError ||= error;
                        didError = true;
                    },
                    onError(error: any) {
                        firstError ||= error;
                        didError = true;
                        if (!isProduction) {
                            console.error('Streaming Error:', error);
                        }
                    },
                }
            );
        });
    } catch (err) {
        if (!assets) {
            const errorHtml = isProduction ? '' : getServerErrorHtml({ error: err, title: 'Critical SSR Error' });

            if (process.env.NYTLEX_MODE === 'export') {
                return errorHtml;
            }

            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(errorHtml);
            }
            return;
        }

        return await sendReactSsrFallback({
            req,
            res,
            isProduction,
            error: err,
            assets,
            lang: (metadata as any)?.language || 'pt-BR',
            title: metadata.title || 'Nytlex.js',
            metaTagsHtml: (() => {
                try {
                    return generateMetaTags(metadata);
                } catch {
                    return '';
                }
            })(),
            stylesHtml: assets.styles.map((styleUrl) => {
                const [basePath, query] = styleUrl.split('?');
                const finalUrl = !basePath.endsWith('.css') ? `${basePath}.css${query ? `?${query}` : ''}` : styleUrl;
                return `<link rel="stylesheet" href="${finalUrl}">`;
            }).join('\n'),
            hotReloadScript: !isProduction && hotReloadManager ? hotReloadManager.getClientScript() : '',
        });
    }
}