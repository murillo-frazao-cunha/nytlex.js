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
import { createApp, type App as VueApp } from 'vue';
import App from './App.vue';

// Importa a lógica centralizada (agora usando findRouteForPath ao invés de getInitialClientData)
import { findRouteForPath, renderCriticalError } from '../FrontCore';

declare global {
    interface Window {
        __NYTLEX_APP__?: VueApp;
    }
}

function initializeClient() {
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

        if (window.__NYTLEX_APP__) {
            try {
                window.__NYTLEX_APP__.unmount();
                container.innerHTML = '';
            } catch (e) {
                console.warn('[Nytlex] Warning during unmount:', e);
            }
        }

        const app = createApp(App, {
            componentMap,
            routes, // Passamos as rotas globais
            initialComponentPath, // Passamos o path resolvido
            initialParams, // Passamos os parâmetros da URL
            layoutComponent: (window as any).__NYTLEX_LAYOUT__
        });

        // Configuração para suportar os Web Components de desenvolvimento do Nytlex
        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('nytlex-');

        window.__NYTLEX_APP__ = app;
        app.mount(container);

    } catch (error: any) {
        renderCriticalError(error, 'Vue');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeClient);
} else {
    setTimeout(initializeClient, 0);
}