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
import { mount, unmount, createRawSnippet } from 'svelte';
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
        __NYTLEX_SVELTE_INSTANCE__?: any; // Guarda a instância ativa para o HMR
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

async function renderRoute(routes: any[], componentMap: Record<string, any>) {
    const currentPath = window.location.pathname.replace("index.html", '');
    const match = findRouteForPath(currentPath, routes);

    const container = document.getElementById('root');
    if (!container) return;

    // Destrói a instância anterior do Svelte para evitar memory leaks (Svelte 4/5 compat)
    if (currentAppInstance) {
        try {
            if (typeof currentAppInstance.$destroy === 'function') {
                currentAppInstance.$destroy();
            } else {
                unmount(currentAppInstance);
            }
        } catch (e) { }
        currentAppInstance = null;
    }

    container.innerHTML = '';

    if (!match) {
        const NotFoundComponent = window.__NYTLEX_NOT_FOUND__;
        const LayoutComponent = window.__NYTLEX_LAYOUT__;

        if (NotFoundComponent) {
            mountSvelteComponent(NotFoundComponent, {}, LayoutComponent, container);
        } else {
            const { getDefaultNotFound } = window.__NYTLEX_DEFAULT_NOT_FOUND__ || { getDefaultNotFound: () => '404 Not Found' };
            container.innerHTML = getDefaultNotFound();
        }
        return;
    }

    let PageComponent = componentMap[match.componentPath];
    const LayoutComponent = window.__NYTLEX_LAYOUT__;

    // Nova abstração do layout injetada pelo Esbuild
    const LayoutMetadata = window.__NYTLEX_LAYOUT_METADATA__ || {};
    let pageTitle = null;

    // 1. Pega do Layout primeiro (Fallback base)
    if (LayoutMetadata) {
         if (LayoutMetadata.title) {
            pageTitle = LayoutMetadata.title;
        }
    }

    // 2. Sobrescreve com o estático da rota atual mapeado no build
    if (match.metadata?.title) {
        pageTitle = match.metadata.title;
    }

    let ActualPageComponent = PageComponent;

    // 3. Resolve o Lazy Load e pega o Dinâmico da rota atual (Prioridade máxima)
    if (PageComponent) {
        try {
            // Usa a nova função de metadata que criamos no wrapper sem precisar instanciar o componente todo
            if (typeof PageComponent.getMetadata === 'function') {
                const dynamicMetaRaw = await PageComponent.getMetadata();

                // Trata tanto metadata estático quanto generateMetadata() da página
                let dynamicMeta = dynamicMetaRaw;
                if (typeof dynamicMetaRaw === 'function') {
                    dynamicMeta = await dynamicMetaRaw(match.params);
                }

                if (dynamicMeta && dynamicMeta.title) {
                    pageTitle = dynamicMeta.title;
                }
            }

            // Resolve o módulo Svelte para a renderização visual
            if (PageComponent.__importFunc) {
                const actualModule = await PageComponent();
                ActualPageComponent = actualModule.default || actualModule;
            }
        } catch (err) {
            console.error('[Nytlex] Erro ao resolver componente Svelte ou metadata:', err);
        }
    }

    // 4. Atualiza o título real da página
    if (pageTitle) {
        updateDocumentTitle(pageTitle);
    }

    // Passa o componente já resolvido para o mount
    if (ActualPageComponent) {
        mountSvelteComponent(ActualPageComponent, match.params, LayoutComponent, container);
    }
}

function mountSvelteComponent(PageComponent: any, params: any, LayoutComponent: any, target: HTMLElement) {
    try {
        if (LayoutComponent) {
            let pageInstance: any = null;
            let childSnippet: any = undefined;

            // Cria o Snippet para injeção
            if (typeof createRawSnippet === 'function') {
                childSnippet = createRawSnippet(() => {
                    return {
                        render: () => '<div style="display:contents" class="nytlex-page-wrapper"></div>',
                        setup: (node: Element) => {
                            // Suporte tanto pra Svelte 5 (mount) quanto Svelte 4 fallback
                            if (typeof mount === 'function') {
                                pageInstance = mount(PageComponent, {
                                    target: node as HTMLElement,
                                    props: { params }
                                });
                            } else {
                                pageInstance = new PageComponent({ target: node, props: { params } });
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

            // Svelte 5
            if (typeof mount === 'function') {
                currentAppInstance = mount(LayoutComponent, {
                    target,
                    props: {
                        params,
                        children: childSnippet, // 👈 Para Layouts usando Svelte 5 Runes: {@render children()}
                        $$slots: { default: childSnippet }, // 👈 A MAGIA AQUI: Para Layouts Svelte 4/Legacy usando: <slot />
                        $$scope: {}
                    }
                });
            }
            // Fallback Svelte 4 puro
            else {
                currentAppInstance = new LayoutComponent({
                    target,
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
                                            pageInstance = new PageComponent({ target: wrapper, props: { params } });
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
                currentAppInstance = mount(PageComponent, { target, props: { params } });
            } else {
                currentAppInstance = new PageComponent({ target, props: { params } });
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

        // Se HMR recarregou, limpa a instância salva
        if (window.__NYTLEX_SVELTE_INSTANCE__) {
            try {
                if (typeof window.__NYTLEX_SVELTE_INSTANCE__.$destroy === 'function') {
                    window.__NYTLEX_SVELTE_INSTANCE__.$destroy();
                } else {
                    unmount(window.__NYTLEX_SVELTE_INSTANCE__);
                }
            } catch (e) { }
            window.__NYTLEX_SVELTE_INSTANCE__ = null;
        }

        setupOverlays();

        setupBuildErrorEvents(
            (err) => { buildError = err; updateOverlaysState(); },
            () => { buildError = null; updateOverlaysState(); }
        );

        let pendingHmr: { file: string | null; timestamp: number } | null = null;
        setupHMREvents(async (file, timestamp) => {
            pendingHmr = { file, timestamp };
            await renderRoute(routes, componentMap);
            dispatchHmrReady(pendingHmr);
            pendingHmr = null;
        });

        const handleRouteUpdate = () => renderRoute(routes, componentMap);
        window.addEventListener('popstate', handleRouteUpdate);
        router.subscribe(handleRouteUpdate);

        await renderRoute(routes, componentMap);

    } catch (error: any) {
        renderCriticalError(error, 'Svelte');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeClient);
} else {
    setTimeout(initializeClient, 0);
}