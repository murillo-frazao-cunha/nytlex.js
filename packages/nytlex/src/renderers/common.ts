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

import type { GenericRequest } from '../types/framework';
import { Metadata } from '../types';
import fs from 'fs';
import path from 'path';

/**
 * Common utility functions shared between React and Vue renderers
 */

// --- String/HTML Utilities ---

/**
 * Removes all script tags from HTML string
 */
export function stripScriptTags(html: string): string {
    if (!html) return '';
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/**
 * Extracts the request URL from generic request object
 */
export function getRequestUrl(req: GenericRequest): string | undefined {
    return (req as any)?.originalUrl || (req as any)?.url;
}

/**
 * Converts an unknown error to an Error instance
 */
export function toError(err: unknown): Error {
    if (err instanceof Error) return err;
    if (typeof err === 'string') return new Error(err);
    try {
        return new Error(JSON.stringify(err));
    } catch {
        return new Error(String(err));
    }
}

// --- Browser Environment Polyfills ---

/**
 * Creates a fake browser environment for server-side rendering
 * This prevents client-side libraries from breaking when used in Node.js
 */
export function createBrowserEnvironmentPolyfill(): any {
    return {
        document: {
            createElement: () => ({ style: {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } }),
            getElementById: () => null,
            getElementsByTagName: () => [],
            querySelector: () => null,
            querySelectorAll: () => [],
            head: {},
            body: { style: {} },
            addEventListener: () => {},
            removeEventListener: () => {},
            cookie: '',
            location: { href: '', origin: '' },
            scrollTo: () => {},
        },
        navigator: {
            userAgent: 'Node.js/NytlexSSR',
        },
        location: {
            href: 'http://localhost',
            origin: 'http://localhost',
            pathname: '/',
            search: '',
            hash: '',
            assign: () => {},
            replace: () => {},
            reload: () => {},
        },
        history: {
            pushState: () => {},
            replaceState: () => {},
        },
        screen: { width: 1920, height: 1080 },
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 0),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        },
        sessionStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        },
        console: {
            log: () => {},
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
            trace: () => {},
            dir: () => {},
        },
        Image: class { constructor() {} },
    };
}

/**
 * Sets up the global browser environment polyfill for SSR
 * Safely handles Node.js read-only properties
 */
export function polyfillBrowserEnv(): void {
    if (typeof window === 'undefined') {
        const win = createBrowserEnvironmentPolyfill();
        const globalAny = global as any;

        // Helper to safely set globals
        // Node 21+ has read-only globals like 'navigator', 'performance' etc
        const setGlobal = (key: string, value: any) => {
            try {
                if (typeof globalAny[key] === 'undefined') {
                    globalAny[key] = value;
                }
            } catch (e) {
                // If it fails (read-only property), silently ignore
            }
        };

        setGlobal('window', win);
        setGlobal('document', win.document);
        setGlobal('navigator', win.navigator);
        setGlobal('location', win.location);
        setGlobal('localStorage', win.localStorage);
        setGlobal('sessionStorage', win.sessionStorage);
        setGlobal('requestAnimationFrame', win.requestAnimationFrame);
        setGlobal('cancelAnimationFrame', win.cancelAnimationFrame);
    }
}

// --- Module Loading Utilities ---

/**
 * Imports a module while ignoring CSS and other style imports
 * Prevents style processing errors during SSR
 */
export function requireWithoutStyles<T>(modulePath: string): T {
    const extensions = ['.css', '.scss', '.sass', '.less', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
    const originalHandlers: Record<string, any> = {};

    extensions.forEach(ext => {
        originalHandlers[ext] = require.extensions[ext];
        require.extensions[ext] = (m: any, filename: string) => {
            m.exports = {};
        };
    });

    try {
        const resolved = require.resolve(modulePath);
        if (require.cache[resolved]) delete require.cache[resolved];
        return require(modulePath);
    } catch (e) {
        return require(modulePath);
    } finally {
        extensions.forEach(ext => {
            if (originalHandlers[ext]) {
                require.extensions[ext] = originalHandlers[ext];
            } else {
                delete require.extensions[ext];
            }
        });
    }
}

// --- Data Obfuscation ---

/**
 * Obfuscates data for client-side hydration
 * Uses base64 encoding with a timestamp hash
 */
export function obfuscateData(data: any): string {
    const jsonStr = JSON.stringify(data);
    const base64 = Buffer.from(jsonStr).toString('base64');
    const hash = Buffer.from(Date.now().toString()).toString('base64').substring(0, 8);
    return `${hash}.${base64}`;
}

// --- Metadata Generation ---

/**
 * Generates HTML meta tags from metadata object
 */
export function generateMetaTags(metadata: Metadata): string {
    const tags: string[] = [];
    tags.push(`<meta charset="${metadata.charset || 'UTF-8'}">`);
    tags.push(`<meta name="viewport" content="${metadata.viewport || 'width=device-width, initial-scale=1.0'}">`);

    if (metadata.description) tags.push(`<meta name="description" content="${metadata.description}">`);

    if (metadata.keywords) {
        const keywordsStr = Array.isArray(metadata.keywords) ? metadata.keywords.join(', ') : metadata.keywords;
        tags.push(`<meta name="keywords" content="${keywordsStr}">`);
    }

    if (metadata.author) tags.push(`<meta name="author" content="${metadata.author}">`);
    if (metadata.themeColor) tags.push(`<meta name="theme-color" content="${metadata.themeColor}">`);
    if (metadata.robots) tags.push(`<meta name="robots" content="${metadata.robots}">`);
    if (metadata.canonical) tags.push(`<link rel="canonical" href="${metadata.canonical}">`);
    if (metadata.faviconDark) {
        tags.push(`
        <link rel="icon" href="${metadata.favicon}" media="(prefers-color-scheme: light)">
        <link rel="icon" href="${metadata.faviconDark}" media="(prefers-color-scheme: dark)">
    `);
    } else if (metadata.favicon) {
        tags.push(`<link rel="icon" href="${metadata.favicon}">`);
    }

    // Apple & Manifest
    if (metadata.appleTouchIcon) tags.push(`<link rel="apple-touch-icon" href="${metadata.appleTouchIcon}">`);
    if (metadata.manifest) tags.push(`<link rel="manifest" href="${metadata.manifest}">`);

    // Open Graph
    if (metadata.openGraph) {
        const og = metadata.openGraph;
        if (og.title) tags.push(`<meta property="og:title" content="${og.title}">`);
        if (og.description) tags.push(`<meta property="og:description" content="${og.description}">`);
        if (og.type) tags.push(`<meta property="og:type" content="${og.type}">`);
        if (og.url) tags.push(`<meta property="og:url" content="${og.url}">`);
        if (og.siteName) tags.push(`<meta property="og:site_name" content="${og.siteName}">`);
        if (og.locale) tags.push(`<meta property="og:locale" content="${og.locale}">`);

        if (og.image) {
            const imgUrl = typeof og.image === 'string' ? og.image : og.image.url;
            tags.push(`<meta property="og:image" content="${imgUrl}">`);

            if (typeof og.image !== 'string') {
                if (og.image.width) tags.push(`<meta property="og:image:width" content="${og.image.width}">`);
                if (og.image.height) tags.push(`<meta property="og:image:height" content="${og.image.height}">`);
                if (og.image.alt) tags.push(`<meta property="og:image:alt" content="${og.image.alt}">`);
            }
        }
    }

    // Twitter Card
    if (metadata.twitter) {
        const tw = metadata.twitter;
        if (tw.card) tags.push(`<meta name="twitter:card" content="${tw.card}">`);
        if (tw.site) tags.push(`<meta name="twitter:site" content="${tw.site}">`);
        if (tw.creator) tags.push(`<meta name="twitter:creator" content="${tw.creator}">`);
        if (tw.title) tags.push(`<meta name="twitter:title" content="${tw.title}">`);
        if (tw.description) tags.push(`<meta name="twitter:description" content="${tw.description}">`);
        if (tw.image) tags.push(`<meta name="twitter:image" content="${tw.image}">`);
        if (tw.imageAlt) tags.push(`<meta name="twitter:image:alt" content="${tw.imageAlt}">`);
    }

    // Custom Meta Tags
    if (metadata.other) {
        for (const [key, value] of Object.entries(metadata.other)) {
            tags.push(`<meta name="${key}" content="${value}">`);
        }
    }

    if (metadata.scripts) {
        for (const [key, value] of Object.entries(metadata.scripts)) {
            const rest = Object.entries(value).map((r) => {
                return '' + r[0] + '="' + r[1] + '"'
            })
            tags.push(`<script src="${key}" ${rest.join(" ")}></script>`)
        }
    }


    return tags.join('\n');
}

// --- Asset Management ---

/**
 * Interface for build assets (scripts and styles)
 */
export interface BuildAssets {
    scripts: string[];
    styles: string[];
}

/**
 * Retrieves compiled assets from .nytlex build directory
 */
export function getBuildAssets(): BuildAssets | null {
    const projectDir = process.cwd();
    const distDir = path.join(projectDir, '.nytlex');
    const assetsDir = path.join(distDir, 'assets');
    const chunksDir = path.join(distDir, 'chunks');
    if (!fs.existsSync(distDir)) return null;

    const scripts: string[] = [];
    const styles: string[] = [];

    // Helper to process directories
    const processDirectory = (directory: string, urlPrefix: string) => {
        if (!fs.existsSync(directory)) return;

        const files = fs.readdirSync(directory);
        files.forEach(file => {
            if (file.endsWith('.map')) return; // Skip sourcemaps

            const url = `${urlPrefix}/${file.replace(".br", '').replace(".gz", '')}`;

            // Support .js, .js.br, .js.gz
            if (file.endsWith('.js') || file.endsWith('.js.br') || file.endsWith('.js.gz')) {
                scripts.push(url);
            } else if (file.endsWith('.css')) {
                styles.push(url);
            }
        });
    };

    // Read assets from .nytlex/
    processDirectory(distDir, '/_nytlex');

    // Read assets from .nytlex/assets
    processDirectory(assetsDir, '/_nytlex/assets');

    // Read chunks from .nytlex/chunks
    processDirectory(chunksDir, '/_nytlex/chunks');

    return { scripts, styles };
}

/**
 * Analyzes component source code to extract static asset imports
 * and generate preload links for injection into the head
 */
export function extractComponentPreloads(componentPath: string): string[] {
    if (!componentPath || !fs.existsSync(componentPath)) return [];

    const assetsDir = path.join(process.cwd(), '.nytlex', 'assets');
    let availableAssets: string[] = [];
    try {
        if (fs.existsSync(assetsDir)) {
            availableAssets = fs.readdirSync(assetsDir);
        }
    } catch (e) {
        // Silently fail if assets dir not found
    }

    const findHashedAsset = (filename: string): string | null => {
        if (availableAssets.includes(filename)) return filename;

        const ext = path.extname(filename);
        const base = path.basename(filename, ext);

        const match = availableAssets.find(asset =>
            asset.endsWith(ext) && asset.includes(base)
        );

        return match || null;
    };

    try {
        const content = fs.readFileSync(componentPath, 'utf8');
        const tags: Set<string> = new Set();

        const processPath = (fullPath: string) => {
            const filename = path.basename(fullPath);
            const realFilename = findHashedAsset(filename);

            if (!realFilename) {
                return;
            }

            const ext = path.extname(realFilename).toLowerCase();
            const publicUrl = `/_nytlex/assets/${realFilename}`;

            if (['.mp4', '.webm'].includes(ext)) {
                tags.add(`<link rel="preload" as="video" href="${publicUrl}">`);
            } else if (['.css'].includes(ext)) {
                tags.add(`<link rel="preload" as="style" href="${publicUrl}">`);
                tags.add(`<link rel="stylesheet" href="${publicUrl}">`);
            } else if (['.js', '.js.br', '.js.gz'].includes(ext)) {
                tags.add(`<link rel="preload" as="script" href="${publicUrl.replace(".br", '').replace(".gz", '')}">`);
            } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif'].includes(ext)) {
                tags.add(`<link rel="preload" as="image" href="${publicUrl}">`);
            }
        };

        const importRegex = /(?:import(?:\s+[^;'"]+\s+from)?\s+|require\(\s*)['"]([^'"]+\.(png|jpg|jpeg|gif|svg|webp|avif|mp4|webm|css|js))['"]/g;

        let match;
        while ((match = importRegex.exec(content)) !== null) {
            processPath(match[1]);
        }

        const imgTagRegex = /<img\s+[^>]*src=['"]([^'"]+\.(png|jpg|jpeg|gif|svg|webp|avif))['"]/g;
        while ((match = imgTagRegex.exec(content)) !== null) {
            const src = match[1];
            processPath(src);
        }

        return Array.from(tags);
    } catch (e) {
        console.warn(`Failed to extract preloads for ${componentPath}:`, e);
        return [];
    }
}


