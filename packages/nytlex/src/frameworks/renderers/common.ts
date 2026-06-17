/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 *
 * MANTENHA AQUI SUAS OUTRAS FUNÇÕES EXISTENTES
 * (getRequestUrl, obfuscateData, generateMetaTags, extractComponentPreloads, getBuildAssets, etc.)
 * Substitua apenas as funções abaixo e adicione o buildShellDocument.
 */

/**
 * Previne erros de SSR mockando variáveis exclusivas do Browser.
 * Resolve erros como "localStorage is not a function" ou "window is not defined".
 */
export function polyfillBrowserEnv() {
    if (typeof global !== 'undefined') {
        const noop = () => {};
        const noopStorage = {
            getItem: () => null,
            setItem: noop,
            removeItem: noop,
            clear: noop,
            length: 0,
            key: () => null
        };

        if (!global.window) {
            (global as any).window = global;
        }
        if (!global.document) {
            (global as any).document = {
                createElement: () => ({}),
                getElementById: () => null,
                getElementsByTagName: () => [],
                head: { appendChild: noop },
                body: { appendChild: noop },
                querySelector: () => null,
                querySelectorAll: () => [],
            };
        }
        if (!global.localStorage || typeof global.localStorage.getItem !== 'function') {
            (global as any).localStorage = noopStorage;
        }
        if (!global.sessionStorage || typeof global.sessionStorage.getItem !== 'function') {
            (global as any).sessionStorage = noopStorage;
        }
        if (!global.navigator) {
            (global as any).navigator = { userAgent: 'node-ssr' };
        }
        if (!global.location) {
            (global as any).location = { href: 'http://localhost', pathname: '/', search: '' };
        }
    }
}

export interface ShellOptions {
    lang?: string;
    title?: string;
    metaTagsHtml?: string;
    headInnerHtml?: string; // Svelte <svelte:head>
    scriptPreloadsHtml?: string;
    componentPreloadsHtml?: string;
    stylesHtml?: string;
    cssInnerHtml?: string; // Svelte CSS injection
    obfuscatedData?: string;
    scriptsHtml?: string;
    hotReloadScript?: string;
    bodyInnerHtml?: string;
}

/**
 * Função universal para renderizar o Shell (esqueleto HTML) em todos os frameworks,
 * evitando repetição de código no React, Vue e Svelte.
 */
export function buildShellDocument(options: ShellOptions): string {
    return `<!DOCTYPE html>
<html lang="${options.lang || 'pt-BR'}">
<head>
    <meta charset="utf-8" />
    <title>${options.title || 'Nytlex App'}</title>
    ${options.metaTagsHtml || ''}
    ${options.headInnerHtml || ''}
    ${options.scriptPreloadsHtml || ''}
    ${options.componentPreloadsHtml || ''}
    ${options.stylesHtml || ''}
    ${options.cssInnerHtml || ''}
</head>
<body>
    <div id="root">${options.bodyInnerHtml || ''}</div>
    ${options.obfuscatedData || ''}
    ${options.scriptsHtml || ''}
    ${options.hotReloadScript ? `<div style="display:none">${options.hotReloadScript}</div>` : ''}
</body>
</html>`;
}