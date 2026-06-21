/*
 * This file is part of the Vatts.js Project.
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
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
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
}

function App({ componentMap, routes, initialComponentPath, initialParams, layoutComponent }: AppProps) {
    const [hmrTimestamp, setHmrTimestamp] = useState(Date.now());
    const pendingHmrReadyRef = useRef<{ file: string | null; timestamp: number } | null>(null);

    const [buildError, setBuildError] = useState<NytlexBuildError | null>(() => {
        const initialError = (window as any).__NYTLEX_BUILD_ERROR__ || null;
        if (initialError) console.warn('[Vatts.js] ⚠️ Erro de build inicial detectado:', initialError);
        return initialError;
    });
    const [isErrorOpen, setIsErrorOpen] = useState<boolean>(() => !!(window as any).__NYTLEX_BUILD_ERROR__);

    const devBadgeRef = useRef<HTMLElement>(null);
    const errorModalRef = useRef<HTMLElement>(null);

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

    // Sincroniza refs dos Web Components
    useEffect(() => {
        const badge = devBadgeRef.current;
        const modal = errorModalRef.current as any;

        if (badge) badge.setAttribute('has-build-error', buildError ? 'true' : 'false');
        if (modal) {
            modal.error = buildError;
            modal.isOpen = isErrorOpen;
        }
    }, [buildError, isErrorOpen]);

    useEffect(() => {
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
    }, [handleCopyLog]);

    // Roteamento
    const getMatch = useCallback((path: string) => findRouteForPath(path, routes), [routes]);

    const [CurrentPageComponent, setCurrentPageComponent] = useState(() => {
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = getMatch(currentPath);
        // Puxa o 'component' visual do novo objeto
        const routeData = match ? componentMap[match.componentPath] : null;
        return routeData ? routeData.component : null;
    });

    const [params, setParams] = useState(() => {
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = getMatch(currentPath);
        return match ? match.params : {};
    });

    const [currentMetadata, setCurrentMetadata] = useState<Metadata | null>(() => {
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = getMatch(currentPath);
        return match ? match.metadata : null;
    });

    // MUDANÇA: transformado em async para dar await nos módulos e unificar as Metadatas
    const updateRoute = useCallback(async () => {
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = getMatch(currentPath);

        if (match) {
            const routeData = componentMap[match.componentPath];
            setCurrentPageComponent(() => routeData ? routeData.component : null);
            setParams(match.params);

            try {
                // 1. Resolve Metadata do Layout
                let layoutMeta = {};
                if (layoutComponent && layoutComponent.module) {
                    const layoutModule = layoutComponent.module;
                    layoutMeta = layoutModule.metadata || (layoutModule.default && layoutModule.default.metadata) || {};

                    const generateMeta = layoutModule.generateMetadata || (layoutModule.default && layoutModule.default.generateMetadata);
                    if (typeof generateMeta === 'function') {
                        const dynamicLayoutMeta = await generateMeta(match.params);
                        layoutMeta = { ...layoutMeta, ...dynamicLayoutMeta };
                    }
                }

                // 2. Resolve Metadata da Página acessando o loader real
                let pageMeta = match.metadata || {};
                if (routeData && routeData.loader) {
                    const pageModule = await routeData.loader();
                    pageMeta = { ...pageMeta, ...(pageModule.metadata || (pageModule.default && pageModule.default.metadata) || {}) };

                    const generateMeta = pageModule.generateMetadata || (pageModule.default && pageModule.default.generateMetadata);
                    if (typeof generateMeta === 'function') {
                        const dynamicPageMeta = await generateMeta(match.params);
                        if (dynamicPageMeta) pageMeta = { ...pageMeta, ...dynamicPageMeta };
                    }
                }

                // 3. Seta a união
                setCurrentMetadata({ ...layoutMeta, ...pageMeta });

            } catch (error) {
                console.error('[Vatts.js Metadata] ❌ Erro ao resolver metadata do módulo em React:', error);
            }

        } else {
            console.warn(`[Vatts.js] ⚠️ Rota não encontrada (404): ${currentPath}`);
            setCurrentPageComponent(null);
            setParams({});
            setCurrentMetadata(null);
        }
    }, [getMatch, componentMap, layoutComponent]);

    // Effect isolado pra atualizar o título
    useEffect(() => {
        if (currentMetadata && currentMetadata.title) {
            updateDocumentTitle(currentMetadata.title);
        }
    }, [currentMetadata]);

    // Roda a extração assíncrona logo no mount também para pegar o título inicial corretamente
    useEffect(() => {
        updateRoute();

        const handlePopState = () => updateRoute();
        window.addEventListener('popstate', handlePopState);
        const unsubscribe = router.subscribe(updateRoute);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            unsubscribe();
        };
    }, [updateRoute]);

    // Renderização
    // Extrai o componente real do layout, já que agora ele é um objeto { component, module }
    const LayoutComponentVisual = layoutComponent ? layoutComponent.component : null;

    let resolvedContent: React.ReactNode;
    if (!CurrentPageComponent || initialComponentPath === '__404__') {
        const NotFoundData = (window as any).__NYTLEX_NOT_FOUND__;
        let NotFoundContent;

        if (NotFoundData) {
            // Caso tenha componente de erro no mapa (seja default export ou obj literal)
            const NotFoundComp = NotFoundData.default || NotFoundData;
            NotFoundContent = <NotFoundComp />;
        } else {
            const { getDefaultNotFound } = (window as any).__NYTLEX_DEFAULT_NOT_FOUND__;
            NotFoundContent = <div dangerouslySetInnerHTML={{ __html: getDefaultNotFound() }} />;
        }

        resolvedContent = typeof LayoutComponentVisual === "function" || typeof LayoutComponentVisual === "object"
            ? React.createElement(LayoutComponentVisual, { children: NotFoundContent })
            : NotFoundContent;
    } else {
        const PageContent = <CurrentPageComponent key={`page-${hmrTimestamp}`} params={params} />;
        resolvedContent = typeof LayoutComponentVisual === "function" || typeof LayoutComponentVisual === "object"
            ? React.createElement(LayoutComponentVisual, { children: PageContent })
            : <div>{PageContent}</div>;
    }

    return (
        <>
            {resolvedContent}
            {process.env.NODE_ENV !== 'production' ? (
                <nytlex-dev-badge ref={devBadgeRef}></nytlex-dev-badge>
            ) : null}
            <nytlex-error-modal ref={errorModalRef}></nytlex-error-modal>
        </>
    );
}

// --- Inicialização do Cliente ---
function initializeClient() {
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
            console.warn('[Vatts.js] ⚠️ No components found in window.__NYTLEX_COMPONENTS__');
        }

        const container = document.getElementById('root');
        if (!container) throw new Error('Container #root not found.');

        if (window.__NYTLEX_ROOT__) {
            console.log('[Vatts.js] ♻️ HMR detectado: Limpando a root do React...');
            try {
                window.__NYTLEX_ROOT__.unmount();
                container.innerHTML = '';
            } catch (e) {
                console.warn('[Vatts.js] ⚠️ Warning during unmount:', e);
            }
        }

        const root = createRoot(container);
        window.__NYTLEX_ROOT__ = root;

        root.render(
            <App
                componentMap={componentMap}
                routes={routes}
                initialComponentPath={initialComponentPath}
                initialParams={initialParams}
                layoutComponent={(window as any).__NYTLEX_LAYOUT__}
            />
        );

    } catch (error: any) {
        renderCriticalError(error, 'React');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeClient);
} else {
    setTimeout(initializeClient, 0);
}