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

// --- NOVA LÓGICA DE FAST-REFRESH (SOFT-RELOAD) ---
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    if (!(window as any).__NYTLEX_HMR_SETUP__) {
        (window as any).__NYTLEX_HMR_SETUP__ = true;

        window.addEventListener('nytlex:hmr-update', async (e: any) => {
            console.log('[Nytlex] 🟠 HMR Recebido! Sincronizando módulos...');
            try {
                const files = e.detail?.files || [];
                const jsFiles = files.filter((f: string) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts'));

                if (jsFiles.length > 0) {
                    const hmrTimestamp = Date.now();

                    // OTIMIZAÇÃO: Promise.all para importar tudo em paralelo
                    const importPromises = jsFiles.map((file: string) => {
                        let publicPath = '';
                        const parts = file.replace(/\\/g, '/').split('/');
                        const rootDirs = ['chunks', 'assets', 'pages'];
                        const idx = parts.findIndex((p: string) => rootDirs.includes(p) || p.includes('entry.client'));

                        if (idx !== -1) {
                            publicPath = '/_nytlex/' + parts.slice(idx).join('/');
                        } else {
                            publicPath = '/_nytlex/' + parts[parts.length - 1];
                        }

                        return import(publicPath + '?hmr=' + hmrTimestamp).catch(err => {
                            console.warn(`[Nytlex] Falha ao injetar ${publicPath}`, err);
                        });
                    });

                    // Aguarda todos os imports terminarem de uma vez
                    await Promise.all(importPromises);

                    // 👉 A MÁGICA TÁ AQUI! Avisa o App.vue que baixou tudo e ele já pode atualizar
                    window.dispatchEvent(new CustomEvent('nytlex:vue-hmr-swap'));
                }
            } catch (err) {
                console.warn('[Nytlex] HMR falhou, forçando reload da página...', err);
                window.location.reload();
            }
        });
    }
}

declare global {
    interface Window {
        __NYTLEX_ROUTES__?: any[];
        __NYTLEX_COMPONENTS__?: Record<string, any>;
        __NYTLEX_LAYOUT__?: any;
        __NYTLEX_NOT_FOUND__?: any;
        __NYTLEX_DEFAULT_NOT_FOUND__?: { getDefaultNotFound: () => string };
        __NYTLEX_BUILD_ERROR__?: NytlexBuildError | null;
        __NYTLEX_SVELTE_INSTANCE__?: any;
        __NYTLEX_SVELTE_PAGE_INSTANCE__?: any; // <--- Referência direta para a página isolada
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

    // PRELOAD DO CHUNK
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
                    hydrate: hasSSRHtml,
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
            await renderRoute(routes, window.__NYTLEX_COMPONENTS__ || componentMap, false);
            dispatchHmrReady(pendingHmr);
            pendingHmr = null;
        });

        // Ouve o sinal do HMR recém baixado na memória e força a troca do componente Svelte
        window.addEventListener('nytlex:svelte-hmr-swap', async () => {
            console.log('[Nytlex] ♻️ Svelte HMR Swap: Trocando componente dinamicamente...');
            const compMap = window.__NYTLEX_COMPONENTS__ || componentMap;
            await renderRoute(routes, compMap, false);

            // AGORA SIM: Dispara o evento de "hmr-ready" global, que o DevBadge ouve
            // e retorna o estado dele para 'idle', parando de rodar o spinner kkkkkk.
            const syntheticEvent = new CustomEvent('nytlex:hotreload', {
                detail: { state: 'idle', payload: { success: true }, ts: Date.now() }
            });
            window.dispatchEvent(syntheticEvent);
        });

        const handleRouteUpdate = () => renderRoute(routes, window.__NYTLEX_COMPONENTS__ || componentMap, false);
        window.addEventListener('popstate', handleRouteUpdate);
        router.subscribe(handleRouteUpdate);

        await renderRoute(routes, componentMap, true);

    } catch (error: any) {
        renderCriticalError(error, 'Svelte');
    }
}

// TRAVA DE SEGURANÇA MÁXIMA PARA EVITAR RE-EXECUÇÃO
if (!(window as any).__NYTLEX_INITIALIZED__) {
    (window as any).__NYTLEX_INITIALIZED__ = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeClient);
    } else {
        setTimeout(initializeClient, 0);
    }
}