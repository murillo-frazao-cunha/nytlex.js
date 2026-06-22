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
import { createApp, createSSRApp, type App as VueApp } from 'vue';
import App from './App.vue';

// Importa a lógica centralizada (agora usando findRouteForPath ao invés de getInitialClientData)
import { findRouteForPath, renderCriticalError } from '../FrontCore';

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    // PREVINE QUE O HMR REGISTRE O EVENTO MÚLTIPLAS VEZES
    if (!(window as any).__NYTLEX_HMR_SETUP__) {
        (window as any).__NYTLEX_HMR_SETUP__ = true;

        // Escutando o nosso novo evento de HMR
        window.addEventListener('nytlex:hmr-update', async (e: any) => {
            console.log('[Nytlex] 🟢 HMR Recebido! Sincronizando módulos...');
            try {
                const files = e.detail?.files || [];
                // Filtra os arquivos de script modificados
                const jsFiles = files.filter((f: string) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts'));

                if (jsFiles.length > 0) {
                    for (const file of jsFiles) {
                        let publicPath = '';
                        const parts = file.replace(/\\/g, '/').split('/');
                        const rootDirs = ['chunks', 'assets', 'pages'];
                        const idx = parts.findIndex((p: string) => rootDirs.includes(p) || p.includes('entry.client'));

                        if (idx !== -1) {
                            publicPath = '/_nytlex/' + parts.slice(idx).join('/');
                        } else {
                            publicPath = '/_nytlex/' + parts[parts.length - 1];
                        }

                        try {
                            await import(publicPath + '?hmr=' + Date.now());
                        } catch (err) {
                            console.warn(`[Nytlex] Falha ao injetar ${publicPath}`, err);
                        }
                    }

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
        __NYTLEX_APP__?: VueApp;
    }
}

async function initializeClient() {
    try {
        // Resolve a rota e params inicial calculando diretamente no lado do cliente
        // a partir da injeção global do esbuild
        const routes = (window as any).__NYTLEX_ROUTES__ || [];
        const currentPath = window.location.pathname.replace("index.html", '');
        const match = findRouteForPath(currentPath, routes);

        const initialComponentPath = match ? match.componentPath : '__404__';
        const initialParams = match ? match.params : {};

        const componentMap: Record<string, any> = {};
        if ((window as any).__NYTLEX_COMPONENTS__) {
            Object.assign(componentMap, (window as any).__NYTLEX_COMPONENTS__);
        } else {
            console.warn('[Nytlex] No components found in window.__NYTLEX_COMPONENTS__');
        }

        const container = document.getElementById('root');
        if (!container) throw new Error('Container #root not found.');

        // PRELOAD DO CHUNK INICIAL PARA NÃO PISCAR A TELA NO SSR
        let resolvedInitialComponent = null;
        if (initialComponentPath !== '__404__') {
            const wrapper = componentMap[initialComponentPath];
            // Verifica se é uma Promise (import assíncrono do esbuild)
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

        if (window.__NYTLEX_APP__) {
            console.log('[Nytlex] ♻️ HMR detectado: Limpando a root do Vue...');
            try {
                window.__NYTLEX_APP__.unmount();
                container.innerHTML = '';
            } catch (e) {
                console.warn('[Nytlex] Warning during unmount:', e);
            }

            const app = createApp(App, {
                componentMap,
                routes,
                initialComponentPath,
                initialParams,
                layoutComponent: (window as any).__NYTLEX_LAYOUT__,
                initialResolvedComponent: resolvedInitialComponent
            });

            app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('nytlex-');
            window.__NYTLEX_APP__ = app;
            app.mount(container);

        } else {
            // SE O CONTAINER JÁ TEM FILHOS (SSR FUNCIONOU), USAMOS O SSR APP DO VUE.
            // Isso funde o Vue com o HTML existente suavemente, bloqueando a piscada branca.
            if (container.hasChildNodes()) {
                const app = createSSRApp(App, {
                    componentMap,
                    routes,
                    initialComponentPath,
                    initialParams,
                    layoutComponent: (window as any).__NYTLEX_LAYOUT__,
                    initialResolvedComponent: resolvedInitialComponent
                });

                app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('nytlex-');
                window.__NYTLEX_APP__ = app;
                app.mount(container);
            } else {
                const app = createApp(App, {
                    componentMap,
                    routes,
                    initialComponentPath,
                    initialParams,
                    layoutComponent: (window as any).__NYTLEX_LAYOUT__,
                    initialResolvedComponent: resolvedInitialComponent
                });

                app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('nytlex-');
                window.__NYTLEX_APP__ = app;
                app.mount(container);
            }
        }

    } catch (error: any) {
        renderCriticalError(error, 'Vue');
    }
}

// TRAVA DE SEGURANÇA MÁXIMA: Garante que o App só vai dar mount 1 ÚNICA VEZ.
// Evitando unmounts repentinos na tela caso haja uma re-execução fantasma de scripts no frontend
if (!(window as any).__NYTLEX_INITIALIZED__) {
    (window as any).__NYTLEX_INITIALIZED__ = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeClient);
    } else {
        setTimeout(initializeClient, 0);
    }
}