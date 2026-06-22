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

// 1. IMPORTANTE: O Runtime do React Refresh precisa ser injetado ANTES do react-dom
import RefreshRuntime from 'react-refresh/runtime';

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    // PREVINE QUE O HMR REGISTRE O EVENTO MÚLTIPLAS VEZES CASO O ENTRY RE-EXECUTE
    if (!(window as any).__NYTLEX_HMR_SETUP__) {
        (window as any).__NYTLEX_HMR_SETUP__ = true;

        // Injeta o hook global que o plugin do esbuild vai usar para registrar os componentes
        RefreshRuntime.injectIntoGlobalHook(window);

        // ATENÇÃO: As funções precisam ser reais. O plugin do Esbuild precisa disso para registrar o componente na memória!
        (window as any).$RefreshRuntime$ = RefreshRuntime;
        (window as any).$RefreshReg$ = (type: any, id: string) => {
            RefreshRuntime.register(type, id);
        };
        (window as any).$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;

        // Escutando o nosso novo evento maroto de HMR
        window.addEventListener('nytlex:hmr-update', async (e: any) => {
            console.log('[Nytlex] ⚛️ HMR Recebido! Sincronizando módulos...');
            try {
                const files = e.detail?.files || [];
                // Filtra os arquivos de script modificados
                const jsFiles = files.filter((f: string) => f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.mjs') || f.endsWith('.ts') || f.endsWith('.tsx'));

                if (jsFiles.length > 0) {
                    for (const file of jsFiles) {
                        let publicPath = '';
                        const parts = file.replace(/\\/g, '/').split('/');
                        const rootDirs = ['chunks', 'assets', 'pages'];
                        const idx = parts.findIndex((p: string) => rootDirs.includes(p) || p.includes('entry.client'));

                        if (idx !== -1) {
                            publicPath = '/_nytlex/' + parts.slice(idx).join('/');
                        } else {
                            // Fallback, pega o nome final
                            publicPath = '/_nytlex/' + parts[parts.length - 1];
                        }


                        try {
                            // O import() força o navegador a buscar e EXECUTAR a nova versão do arquivo.
                            // Ao executar, o plugin babel/esbuild registra a nova versão dos componentes.
                            await import(publicPath + '?hmr=' + Date.now());
                        } catch (err) {
                            console.warn(`[Nytlex] Falha ao injetar ${publicPath}`, err);
                        }
                    }
                }

                // AGORA SIM! Com o código novo em memória e as funções de cache salvas, o React faz o patch na tela sem piscar!
                RefreshRuntime.performReactRefresh();

                // Força a atualização da rota para pegar os novos componentes do window.__NYTLEX_COMPONENTS__
                window.dispatchEvent(new CustomEvent('nytlex:react-hmr-swap'));

                // Avisa o DevBadge para parar de girar (retornar ao estado idle)
                window.dispatchEvent(new CustomEvent('nytlex:hotreload', {
                    detail: { state: 'idle', payload: { success: true }, ts: Date.now() }
                }));

            } catch (err) {
                console.warn('[Nytlex] Fast-Refresh falhou, forçando reload da página...', err);
                window.location.reload();
            }
        });
    }
}
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot, hydrateRoot, Root } from 'react-dom/client';
import { router } from '../../client/clientRouter.ts';
import type { Metadata } from "../../types.ts";

import {
    NytlexBuildError, findRouteForPath, updateDocumentTitle,
    copyBuildError, setupBuildErrorEvents, setupHMREvents, dispatchHmrReady, renderCriticalError
} from '../FrontCore';

import '../themes/DevBadge';
import '../themes/ErrorModal';

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'nytlex-dev-badge': any;
            'nytlex-error-modal': any;
        }
    }
    interface Window {
        __NYTLEX_ROOT__?: Root;
    }
}

interface AppProps {
    componentMap: Record<string, any>;
    routes: any[];
    initialComponentPath: string;
    initialParams: any;
    layoutComponent?: any;
    initialResolvedComponent?: any;
}

function App({ componentMap, routes, initialComponentPath, initialParams, layoutComponent, initialResolvedComponent }: AppProps) {
    // 1. Garante que ferramentas puramente de frontend só apareçam APÓS a hidratação
    const [isMounted, setIsMounted] = useState(false);

    // 2. Trocado Date.now() por 0 inicial para não causar mismatches na key do React
    const [hmrTimestamp, setHmrTimestamp] = useState(0);
    const pendingHmrReadyRef = useRef<{ file: string | null; timestamp: number } | null>(null);

    const [buildError, setBuildError] = useState<NytlexBuildError | null>(() => {
        const initialError = (window as any).__NYTLEX_BUILD_ERROR__ || null;
        if (initialError) console.warn('[Nytlex] ⚠️ Erro de build inicial detectado:', initialError);
        return initialError;
    });
    const [isErrorOpen, setIsErrorOpen] = useState<boolean>(() => !!(window as any).__NYTLEX_BUILD_ERROR__);

    const devBadgeRef = useRef<HTMLElement>(null);
    const errorModalRef = useRef<HTMLElement>(null);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Setup de eventos compartilhados
    useEffect(() => {
        const cleanupErrorEvents = setupBuildErrorEvents(
            (err) => { setBuildError(err); setIsErrorOpen(true); },
            () => { setBuildError(null); setIsErrorOpen(false); }
        );

        const cleanupHmrEvents = setupHMREvents((file, timestamp) => {
            setHmrTimestamp(timestamp);
            pendingHmrReadyRef.current = { file, timestamp };
        });

        return () => {
            cleanupErrorEvents();
            cleanupHmrEvents();
        };
    }, []);

    useEffect(() => {
        dispatchHmrReady(pendingHmrReadyRef.current);
        pendingHmrReadyRef.current = null;
    }, [hmrTimestamp]);

    const handleCopyLog = useCallback(() => copyBuildError(buildError), [buildError]);

    // Sincroniza refs dos Web Components (apenas após o mount)
    useEffect(() => {
        if (!isMounted) return;
        const badge = devBadgeRef.current;
        const modal = errorModalRef.current as any;

        if (badge) badge.setAttribute('has-build-error', buildError ? 'true' : 'false');
        if (modal) {
            modal.error = buildError;
            modal.isOpen = isErrorOpen;
        }
    }, [buildError, isErrorOpen, isMounted]);

    useEffect(() => {
        if (!isMounted) return;
        const badge = devBadgeRef.current;
        const modal = errorModalRef.current;

        const handleBadgeClick = () => setIsErrorOpen(true);
        const handleModalClose = () => setIsErrorOpen(false);

        if (badge) badge.addEventListener('click-build-error', handleBadgeClick);
        if (modal) {
            modal.addEventListener('close-modal', handleModalClose);
            modal.addEventListener('copy-log', handleCopyLog);
        }

        return () => {
            if (badge) badge.removeEventListener('click-build-error', handleBadgeClick);
            if (modal) {
                modal.removeEventListener('close-modal', handleModalClose);
                modal.removeEventListener('copy-log', handleCopyLog);
            }
        };
    }, [handleCopyLog, isMounted]);

    // Roteamento
    const getMatch = useCallback((path: string) => findRouteForPath(path, routes), [routes]);

    const [CurrentPageComponent, setCurrentPageComponent] = useState(() => initialResolvedComponent);

    const [params, setParams] = useState(() => {
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = getMatch(currentPath);
        return match ? match.params : {};
    });

    const isFirstRender = useRef(true);

    const updateRoute = useCallback(async () => {
        const currentPath = router.pathname.replace("index.html", '');
        const match = getMatch(currentPath);

        if (match) {
            // MÁGICA DO HMR: Pega os componentes mais recentes que o Esbuild injetou no window
            const compMap = (window as any).__NYTLEX_COMPONENTS__ || componentMap;
            const wrapper = compMap[match.componentPath];
            setParams(match.params);

            let componentToRender = wrapper;

            if (isFirstRender.current) {
                isFirstRender.current = false;
                componentToRender = initialResolvedComponent || wrapper;
                setCurrentPageComponent(() => componentToRender);
            } else {
                if (wrapper && typeof wrapper.__importFunc === 'function') {
                    try {
                        const m = await wrapper.__importFunc();
                        componentToRender = m.default || Object.values(m)[0] || m;
                    } catch (e) {
                        console.error('[Nytlex] Error fetching route chunk:', e);
                    }
                }
                setCurrentPageComponent(() => componentToRender);
            }

            let pageTitle = null;
            const LayoutMetadata = window.__NYTLEX_LAYOUT_METADATA__ || {};

            if (LayoutMetadata) {
                if (LayoutMetadata.title) {
                    pageTitle = LayoutMetadata.title;
                }
            }

            if (match.metadata?.title) {
                pageTitle = match.metadata.title;
            }

            if (componentToRender) {
                try {
                    if (typeof componentToRender.getMetadata === 'function') {
                        const dynamicMetaRaw = await componentToRender.getMetadata();

                        let dynamicMeta = dynamicMetaRaw;
                        if (typeof dynamicMetaRaw === 'function') {
                            dynamicMeta = await dynamicMetaRaw(match.params);
                        }

                        if (dynamicMeta && dynamicMeta.title) {
                            pageTitle = dynamicMeta.title;
                        }
                    }
                } catch (err) {
                    console.error('[Nytlex] Erro ao resolver metadata da página:', err);
                }
            }

            if (pageTitle) {
                updateDocumentTitle(pageTitle);
            }
        } else {
            setCurrentPageComponent(null);
            setParams({});
        }
    }, [router.pathname, getMatch, componentMap, initialResolvedComponent]);

    useEffect(() => {
        updateRoute();
    }, [updateRoute]);

    useEffect(() => {
        const handlePopState = () => updateRoute();
        window.addEventListener('popstate', handlePopState);
        const unsubscribe = router.subscribe(updateRoute);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            unsubscribe();
        };
    }, [updateRoute]);

    // Escuta o evento customizado para forçar o Router do React a engolir a nova rota silenciosamente
    useEffect(() => {
        const handleHmrSwap = () => {
            console.log('[Nytlex] ⚛️ React HMR Swap: Re-avaliando a rota com novos componentes...');
            updateRoute();
        };
        window.addEventListener('nytlex:react-hmr-swap', handleHmrSwap);
        return () => window.removeEventListener('nytlex:react-hmr-swap', handleHmrSwap);
    }, [updateRoute]);

    // Renderização
    let resolvedContent: React.ReactNode;
    if (!CurrentPageComponent || initialComponentPath === '__404__') {
        const NotFoundComponent = (window as any).__NYTLEX_NOT_FOUND__;
        let NotFoundContent;

        if (NotFoundComponent) {
            NotFoundContent = <NotFoundComponent />;
        } else {
            const { getDefaultNotFound } = (window as any).__NYTLEX_DEFAULT_NOT_FOUND__;
            NotFoundContent = <div dangerouslySetInnerHTML={{ __html: getDefaultNotFound() }} />;
        }
        resolvedContent = typeof layoutComponent === "function"
            ? React.createElement(layoutComponent, { children: NotFoundContent })
            : NotFoundContent;
    } else {
        // MUITO IMPORTANTE: Retirei o `key={"page-" + hmrTimestamp}` daqui.
        // Se a key mudar a cada HMR, o React desmonta a tela toda e perde os estados.
        // Com uma key fixa, o Fast-Refresh atua magicamente mantendo os inputs/estados vivos.
        const PageContent = <CurrentPageComponent key="nytlex-page" params={params} />;
        resolvedContent = typeof layoutComponent === "function"
            ? React.createElement(layoutComponent, { children: PageContent })
            : <div>{PageContent}</div>;
    }

    return (
        <>
            {resolvedContent}
            {isMounted && process.env.NODE_ENV !== 'production' ? (
                <nytlex-dev-badge ref={devBadgeRef}></nytlex-dev-badge>
            ) : null}
            {isMounted ? (
                <nytlex-error-modal ref={errorModalRef}></nytlex-error-modal>
            ) : null}
        </>
    );
}

// --- Inicialização do Cliente ---
async function initializeClient() {
    try {
        const routes = (window as any).__NYTLEX_ROUTES__ || [];
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = findRouteForPath(currentPath, routes);

        const initialComponentPath = match ? match.componentPath : '__404__';
        const initialParams = match ? match.params : {};

        const componentMap: Record<string, any> = {};
        if ((window as any).__NYTLEX_COMPONENTS__) {
            Object.assign(componentMap, (window as any).__NYTLEX_COMPONENTS__);
        } else {
            console.warn('[Nytlex] ⚠️ No components found in window.__NYTLEX_COMPONENTS__');
        }

        const container = document.getElementById('root');
        if (!container) throw new Error('Container #root not found.');

        let resolvedInitialComponent = null;
        if (initialComponentPath !== '__404__') {
            const wrapper = componentMap[initialComponentPath];
            if (wrapper && typeof wrapper.__importFunc === 'function') {
                try {
                    const m = await wrapper.__importFunc();
                    resolvedInitialComponent = m.default || Object.values(m)[0] || m;
                } catch (e) {
                    console.error('[Nytlex] Error preloading initial component:', e);
                }
            } else {
                resolvedInitialComponent = wrapper;
            }
        }

        const appElement = (
            <App
                componentMap={componentMap}
                routes={routes}
                initialComponentPath={initialComponentPath}
                initialParams={initialParams}
                layoutComponent={(window as any).__NYTLEX_LAYOUT__}
                initialResolvedComponent={resolvedInitialComponent}
            />
        );

        if (window.__NYTLEX_ROOT__) {
            console.log('[Nytlex] ♻️ HMR detectado: Limpando a root do React...');
            try {
                window.__NYTLEX_ROOT__.unmount();
                container.innerHTML = '';
            } catch (e) {
                console.warn('[Nytlex] ⚠️ Warning during unmount:', e);
            }
            const root = createRoot(container);
            window.__NYTLEX_ROOT__ = root;
            root.render(appElement);
        } else {
            if (container.hasChildNodes()) {
                window.__NYTLEX_ROOT__ = hydrateRoot(container, appElement);
            } else {
                const root = createRoot(container);
                window.__NYTLEX_ROOT__ = root;
                root.render(appElement);
            }
        }

    } catch (error: any) {
        renderCriticalError(error, 'React');
    }
}

// TRAVA DE SEGURANÇA MÁXIMA: Garante que o App só vai dar mount 1 ÚNICA VEZ.
// Sem isso, a re-importação do HMR causava a re-execução deste arquivo, rodando o initializeClient()
// e consequentemente chamando root.unmount() e fazendo a tela toda piscar perdendo os estados tlgd.
if (!(window as any).__NYTLEX_INITIALIZED__) {
    (window as any).__NYTLEX_INITIALIZED__ = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeClient);
    } else {
        setTimeout(initializeClient, 0);
    }
}