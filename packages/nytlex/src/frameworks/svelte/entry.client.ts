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
import { mount, hydrate, unmount, createRawSnippet } from 'svelte';
import { router } from '../../client/clientRouter.ts';
import type { Metadata } from "../../types.ts";

import {
    NytlexBuildError, findRouteForPath, updateDocumentTitle,
    copyBuildError, setupBuildErrorEvents, setupHMREvents, dispatchHmrReady, renderCriticalError
} from '../FrontCore';

import '../themes/DevBadge';
import '../themes/ErrorModal';

declare global {
    interface Window {
        __NYTLEX_ROUTES__?: any[];
        __NYTLEX_COMPONENTS__?: Record<string, any>;
        __NYTLEX_LAYOUT__?: any;
        __NYTLEX_NOT_FOUND__?: any;
        __NYTLEX_DEFAULT_NOT_FOUND__?: { getDefaultNotFound: () => string };
        __NYTLEX_BUILD_ERROR__?: NytlexBuildError | null;
        __NYTLEX_SVELTE_INSTANCE__?: any;
        __NYTLEX_LAYOUT_METADATA__?: Metadata;
    }
}

// Variáveis de estado do Cliente Svelte
let currentAppInstance: any = null;
let buildError: NytlexBuildError | null = (window as any).__NYTLEX_BUILD_ERROR__ || null;

let devBadgeEl: HTMLElement | null = null;
let errorModalEl: any = null;

// --- Setup dos Web Components (Overlays) ---
function setupOverlays() {
    if (process.env.NODE_ENV !== 'production' && !document.querySelector('nytlex-dev-badge')) {
        devBadgeEl = document.createElement('nytlex-dev-badge');
        document.body.appendChild(devBadgeEl);

        devBadgeEl.addEventListener('click-build-error', () => {
            if (errorModalEl) errorModalEl.isOpen = true;
        });
    }

    if (!document.querySelector('nytlex-error-modal')) {
        errorModalEl = document.createElement('nytlex-error-modal');
        document.body.appendChild(errorModalEl);

        errorModalEl.addEventListener('close-modal', () => {
            if (errorModalEl) errorModalEl.isOpen = false;
        });

        errorModalEl.addEventListener('copy-log', () => copyBuildError(buildError));
    }

    updateOverlaysState();
}

function updateOverlaysState() {
    if (devBadgeEl) devBadgeEl.setAttribute('has-build-error', buildError ? 'true' : 'false');
    if (errorModalEl) {
        errorModalEl.error = buildError;
        errorModalEl.isOpen = !!buildError;
    }
}

async function renderRoute(routes: any[], componentMap: Record<string, any>, isInitialRender: boolean = false) {
    const currentPath = window.location.pathname.replace("index.html", '');
    const match = findRouteForPath(currentPath, routes);

    const container = document.getElementById('root');
    if (!container) return;

    let PageComponent = match ? componentMap[match.componentPath] : null;
    let ActualPageComponent = PageComponent;
    const LayoutComponent = window.__NYTLEX_LAYOUT__;

    // PRELOAD DO CHUNK: Resolvemos a Promise da página ANTES de tocar no DOM.
    // Isso garante que o Svelte não jogue o HTML do SSR fora pra renderizar uma tela vazia.
    if (PageComponent && typeof PageComponent.__importFunc === 'function') {
        try {
            const actualModule = await PageComponent.__importFunc();
            ActualPageComponent = actualModule.default || actualModule;
        } catch (err) {
            console.error('[Nytlex] Erro ao resolver o chunk Svelte:', err);
        }
    }

    // Só destrói a instância anterior APÓS baixar o componente novo
    if (!isInitialRender && currentAppInstance) {
        try {
            if (typeof currentAppInstance.$destroy === 'function') {
                currentAppInstance.$destroy();
            } else {
                unmount(currentAppInstance);
            }
        } catch (e) { }
        currentAppInstance = null;
    }

    // NUNCA limpa o innerHTML no render inicial do SSR!
    if (!isInitialRender) {
        container.innerHTML = '';
    }

    if (!match) {
        const NotFoundComponent = window.__NYTLEX_NOT_FOUND__;
        if (NotFoundComponent) {
            mountSvelteComponent(NotFoundComponent, {}, LayoutComponent, container, isInitialRender);
        } else {
            const { getDefaultNotFound } = window.__NYTLEX_DEFAULT_NOT_FOUND__ || { getDefaultNotFound: () => '404 Not Found' };
            container.innerHTML = getDefaultNotFound();
        }
        return;
    }

    const LayoutMetadata = window.__NYTLEX_LAYOUT_METADATA__ || {};
    let pageTitle = null;

    if (LayoutMetadata && LayoutMetadata.title) {
        pageTitle = LayoutMetadata.title;
    }

    if (match.metadata?.title) {
        pageTitle = match.metadata.title;
    }

    if (ActualPageComponent) {
        try {
            if (typeof ActualPageComponent.getMetadata === 'function') {
                const dynamicMetaRaw = await ActualPageComponent.getMetadata();

                let dynamicMeta = dynamicMetaRaw;
                if (typeof dynamicMetaRaw === 'function') {
                    dynamicMeta = await dynamicMetaRaw(match.params);
                }

                if (dynamicMeta && dynamicMeta.title) {
                    pageTitle = dynamicMeta.title;
                }
            }
        } catch (err) {}
    }

    if (pageTitle) {
        updateDocumentTitle(pageTitle);
    }

    if (ActualPageComponent) {
        mountSvelteComponent(ActualPageComponent, match.params, LayoutComponent, container, isInitialRender);
    }
}

function mountSvelteComponent(PageComponent: any, params: any, LayoutComponent: any, target: HTMLElement, isInitialRender: boolean) {
    try {
        // Verifica se há SSR no container para usarmos "Hidratação" e não "Mount"
        const hasSSRHtml = isInitialRender && target.hasChildNodes();
        const useSvelte5Hydrate = hasSSRHtml && typeof hydrate === 'function';

        if (LayoutComponent) {
            let pageInstance: any = null;
            let childSnippet: any = undefined;

            if (typeof createRawSnippet === 'function') {
                childSnippet = createRawSnippet(() => {
                    return {
                        render: () => '<div style="display:contents" class="nytlex-page-wrapper"></div>',
                        setup: (node: Element) => {
                            if (typeof mount === 'function') {
                                // Svelte 5: Usa hydrate se estivermos na carga inicial
                                const svelteFn = useSvelte5Hydrate ? hydrate : mount;
                                pageInstance = svelteFn(PageComponent, {
                                    target: node as HTMLElement,
                                    props: { params }
                                });
                            } else {
                                pageInstance = new PageComponent({ target: node, props: { params }, hydrate: hasSSRHtml });
                            }
                            return () => {
                                if (pageInstance) {
                                    try {
                                        if (typeof pageInstance.$destroy === 'function') pageInstance.$destroy();
                                        else unmount(pageInstance);
                                    } catch (e) {}
                                }
                            };
                        }
                    };
                });
            }

            if (typeof mount === 'function') {
                const rootFn = useSvelte5Hydrate ? hydrate : mount;
                currentAppInstance = rootFn(LayoutComponent, {
                    target,
                    props: {
                        params,
                        children: childSnippet,
                        $$slots: { default: childSnippet },
                        $$scope: {}
                    }
                });
            } else {
                currentAppInstance = new LayoutComponent({
                    target,
                    hydrate: hasSSRHtml, // Fallback do Svelte 4
                    props: {
                        params,
                        $$slots: {
                            default: [
                                function() {
                                    return {
                                        c: function() {},
                                        m: function(node: HTMLElement, anchor: any) {
                                            const wrapper = document.createElement('div');
                                            wrapper.style.display = 'contents';
                                            node.insertBefore(wrapper, anchor || null);
                                            pageInstance = new PageComponent({ target: wrapper, props: { params }, hydrate: hasSSRHtml });
                                        },
                                        d: function() { if (pageInstance) pageInstance.$destroy(); },
                                        l: function() {}
                                    };
                                }
                            ]
                        },
                        $$scope: {}
                    }
                });
            }

        } else {
            if (typeof mount === 'function') {
                const rootFn = useSvelte5Hydrate ? hydrate : mount;
                currentAppInstance = rootFn(PageComponent, { target, props: { params } });
            } else {
                currentAppInstance = new PageComponent({ target, hydrate: hasSSRHtml, props: { params } });
            }
        }

        window.__NYTLEX_SVELTE_INSTANCE__ = currentAppInstance;

    } catch (error: any) {
        renderCriticalError(error, 'Svelte');
    }
}

// --- Inicialização do Cliente ---
async function initializeClient() {
    try {
        const routes = window.__NYTLEX_ROUTES__ || [];
        const componentMap = window.__NYTLEX_COMPONENTS__ || {};

        setupOverlays();

        setupBuildErrorEvents(
            (err) => { buildError = err; updateOverlaysState(); },
            () => { buildError = null; updateOverlaysState(); }
        );

        let pendingHmr: { file: string | null; timestamp: number } | null = null;
        setupHMREvents(async (file, timestamp) => {
            pendingHmr = { file, timestamp };
            // HMR não usa Hidratação. Remonta tudo na marra!
            await renderRoute(routes, componentMap, false);
            dispatchHmrReady(pendingHmr);
            pendingHmr = null;
        });

        const handleRouteUpdate = () => renderRoute(routes, componentMap, false);
        window.addEventListener('popstate', handleRouteUpdate);
        router.subscribe(handleRouteUpdate);

        // O render inicial PASSA isInitialRender = true, ativando a hidratação SSR!
        await renderRoute(routes, componentMap, true);

    } catch (error: any) {
        renderCriticalError(error, 'Svelte');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeClient);
} else {
    setTimeout(initializeClient, 0);
}