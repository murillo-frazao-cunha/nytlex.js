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

export interface NytlexBuildError {
    message?: string;
    name?: string;
    stack?: string;
    frame?: string;
    id?: string;
    plugin?: string;
    pluginCode?: string;
    loc?: any;
    watchFiles?: any;
    cause?: any;
    ts?: number;
}

export interface RouteConfig {
    pattern: string;
    componentPath: string;
    metadata?: any;
}

// --- Funções de Dados e Inicialização ---

export function renderCriticalError(error: any, framework: string) {
    console.error(`[Nytlex] ❌ Critical Error rendering application (${framework}):`, error);
    if (typeof document !== 'undefined') {
        document.body.innerHTML = `
            <div style="font-family: monospace; padding: 20px; color: #ff4444; background: #000000; min-height: 100vh;">
                <h1>Nytlex Client Error (${framework})</h1>
                <p>A critical error occurred while initializing the application.</p>
                <pre style="background: #0a0a0a; padding: 15px; border-radius: 5px; overflow: auto;">${error?.message || error}</pre>
                <pre style="color: #666; font-size: 12px; margin-top: 10px;">${error?.stack || ''}</pre>
            </div>
        `;
    }
}

// --- Roteamento e Utils ---

export function findRouteForPath(path: string, routes: RouteConfig[]) {
    for (const route of routes) {
        const regexPattern = route.pattern
            .replace(/\[\[\.\.\.(\w+)\]\]/g, '(?<$1>.+)?')
            .replace(/\[\.\.\.(\w+)\]/g, '(?<$1>.+)')
            .replace(/\/\[\[(\w+)\]\]/g, '(?:/(?<$1>[^/]+))?')
            .replace(/\[\[(\w+)\]\]/g, '(?<$1>[^/]+)?')
            .replace(/\[(\w+)\]/g, '(?<$1>[^/]+)');
        const regex = new RegExp(`^${regexPattern}/?$`);
        const match = path.match(regex);
        if (match) {
            return {
                componentPath: route.componentPath,
                params: match.groups || {},
                metadata: route.metadata
            };
        }
    }
    return null;
}

export function updateDocumentTitle(title?: string) {
    if (title != null) {
        try {
            window.document.title = decodeURIComponent(escape(title));
        } catch (e) {
            window.document.title = title;
        }
    }
}

export async function copyBuildError(error: NytlexBuildError | null) {
    try {
        if (!error) return;
        const payload = JSON.stringify(error, null, 2);
        await navigator.clipboard.writeText(payload);
    } catch {
        console.error('[Nytlex] ❌ Falha ao copiar o erro.');
    }
}

// --- Gerenciadores de Eventos (HMR & Errors) ---

export function setupBuildErrorEvents(
    onErr: (error: NytlexBuildError) => void,
    onOk: () => void
) {
    const handleErr = (ev: any) => {
        const e = ev?.detail as NytlexBuildError;
        console.error('[Nytlex] 🛑 Erro de build (nytlex:build-error):', e);
        (window as any).__NYTLEX_HAD_BUILD_ERROR__ = true;
        onErr(e);
    };

    const handleOk = () => {
        const hadError = (window as any).__NYTLEX_HAD_BUILD_ERROR__;
        onOk();

        if (hadError) {
            (window as any).__NYTLEX_HAD_BUILD_ERROR__ = false;
            console.log('[Nytlex] 🔄 Erro foi corrigido! Sincronizando dados de rotas com servidor...');
            setTimeout(() => {
                window.location.reload();
            }, 300);
        }
    };

    window.addEventListener('nytlex:build-error' as any, handleErr);
    window.addEventListener('nytlex:build-ok' as any, handleOk);

    return () => {
        window.removeEventListener('nytlex:build-error' as any, handleErr);
        window.removeEventListener('nytlex:build-ok' as any, handleOk);
    };
}

export function setupHMREvents(
    onComponentUpdate: (file: string | null, timestamp: number) => void
) {
    (window as any).__HWEB_HMR__ = true;

    const handleHMRUpdate = (event: CustomEvent) => {
        const { file, timestamp } = event.detail;
        const fileName = file ? file.split('/').pop()?.split('\\').pop() : 'unknown';

        try {
            const fileLower = (file || '').toLowerCase();
            const isPageFile = fileLower.includes('page.tsx') || fileLower.includes('page.jsx') ||
                fileLower.includes('page.ts') || fileLower.includes('page.js') ||
                fileLower.includes('page.vue');

            if (isPageFile) {
                console.log('[Nytlex] 📄 Page file HMR detected, reloading to sync route data...');
                setTimeout(() => window.location.reload(), 300);
                return;
            }

            console.log(`[Nytlex] ⚡ HMR Update Triggered: ${fileName}`);
            onComponentUpdate(file || null, timestamp);
        } catch (error) {
            console.error('[Nytlex] ❌ HMR Error:', error);
        }
    };

    window.addEventListener('hmr:component-update' as any, handleHMRUpdate);

    return () => window.removeEventListener('hmr:component-update' as any, handleHMRUpdate);
}

export function dispatchHmrReady(pending: { file: string | null; timestamp: number } | null) {
    if (!pending) return;
    window.dispatchEvent(new CustomEvent('nytlex:hmr-ready', { detail: pending }));
}