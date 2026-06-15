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
import fs from 'fs';
import path from 'path';
import { RouteConfig, BackendRouteConfig, NytlexMiddleware, WebSocketHandler, WebSocketContext } from './types';
import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import Console from "./api/console"
import { FrameworkAdapterFactory } from "./adapters/factory";
import { NytlexRequest } from "./api/http";

// --- Tipos Internos Otimizados ---

interface CompiledRoute {
    config: RouteConfig;
    componentPath: string;
    regex: RegExp; // Regex pré-compilada para performance
    paramNames: string[]; // Nomes dos parâmetros extraídos para evitar re-parse
}

interface CompiledBackendRoute {
    config: BackendRouteConfig;
    regex: RegExp;
    paramNames: string[];
}

// --- Estado Global ---

export let allRoutes: CompiledRoute[] = [];
export let allBackendRoutes: CompiledBackendRoute[] = [];
export let allWebSocketRoutes: { regex: RegExp; handler: WebSocketHandler; middleware?: NytlexMiddleware[]; config: BackendRouteConfig }[] = [];

// Cache de arquivos para Hot Reload
const loadedFiles = new Set<string>();

// Componentes Especiais
let layoutComponent: { componentPath: string; metadata?: any } | null = null;
let notFoundComponent: { componentPath: string } | null = null;

// Conexões ativas
let wsConnections: Set<WebSocket> = new Set();


// --- Otimização de Inicialização (Lazy Loading & Cache) ---

const IGNORED_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
let extensionsPatched = false;

function applyRequireExtensionsPatch() {
    if (extensionsPatched) return;
    IGNORED_EXTENSIONS.forEach(ext => {
        require.extensions[ext] = (m: NodeModule, _filename: string) => {
            // Retorna um objeto vazio silenciosamente para arquivos de estilo/mídia
            // Evita do Node.js tentar executar CSS como código síncrono no SSR.
            (m as any).exports = {};
        };
    });
    extensionsPatched = true;
}

// Função rápida para requerer módulos que aplica o ignore global invés de fazer attach/detach do cache
function requireOptimized<T>(modulePath: string): T {
    applyRequireExtensionsPatch();
    return require(modulePath);
}

// --- Helpers de Regex ---

function compileRoutePatternWithGroups(pattern: string): RegExp {
    const regexPattern = pattern
        .replace(/\[\[\.\.\.(\w+)\]\]/g, '(?<$1>.+)?')
        .replace(/\[\.\.\.(\w+)\]/g, '(?<$1>.+)')
        .replace(/\/\[\[(\w+)\]\]/g, '(?:/(?<$1>[^/]+))?')
        .replace(/\[\[(\w+)\]\]/g, '(?<$1>[^/]+)?')
        .replace(/\[(\w+)\]/g, '(?<$1>[^/]+)');

    return new RegExp(`^${regexPattern}/?$`);
}


// --- Gerenciamento de Cache ---

function safeClearCache(filePath: string) {
    try {
        if (require.cache[filePath]) {
            delete require.cache[filePath];
            return;
        }

        const resolved = require.resolve(filePath);
        if (require.cache[resolved]) {
            delete require.cache[resolved];
        }
    } catch (e) {
        // Ignora erro se arquivo não for resolvível
    }
}

function clearCacheGraph(filePath: string, visited: Set<string> = new Set()) {
    const absolutePath = path.resolve(filePath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    let moduleEntry = require.cache[absolutePath];
    if (!moduleEntry) {
        try {
            const resolved = require.resolve(absolutePath);
            moduleEntry = require.cache[resolved];
        } catch {
            moduleEntry = undefined as any;
        }
    }

    const moduleId = moduleEntry?.id || absolutePath;

    const parents = Object.values(require.cache).filter(parent => {
        if (!parent || !parent.children) return false;
        return parent.children.some(child => path.resolve(child.id) === absolutePath);
    });

    for (const parent of parents) {
        if (!parent?.id || parent.id.includes('node_modules')) continue;
        clearCacheGraph(parent.id, visited);
    }

    safeClearCache(moduleId);
    loadedFiles.delete(absolutePath);
    loadedFiles.delete(moduleId);
}

export function clearAllRouteCache() {
    loadedFiles.forEach(file => safeClearCache(file));
    loadedFiles.clear();
}

export function clearFileCache(changedFilePath: string) {
    clearCacheGraph(changedFilePath);
}


// --- Carregamento de Layout (Otimizado) ---

export function loadLayout(webDir: string): { componentPath: string; metadata?: any } | null {
    const extensions = ['layout.tsx', 'layout.jsx', 'layout.vue', 'layout.svelte'];
    let layoutFile: string | null = null;

    for (const ext of extensions) {
        const fullPath = path.join(webDir, ext);
        if (fs.existsSync(fullPath)) {
            layoutFile = fullPath;
            break;
        }
    }

    if (layoutFile) {
        const absolutePath = path.resolve(layoutFile);
        const componentPath = path.relative(process.cwd(), layoutFile).replace(/\\/g, '/');

        if (loadedFiles.has(absolutePath)) {
            safeClearCache(absolutePath);
        }
        loadedFiles.add(absolutePath);

        // OTIMIZAÇÃO: Em vez de importar o layout no boot, criamos um Getter
        layoutComponent = {
            componentPath,
            get metadata() {
                try {
                    return requireOptimized<any>(absolutePath).metadata || null;
                } catch (e) {
                    return null;
                }
            }
        };
        return layoutComponent;
    }

    layoutComponent = null;
    return null;
}

export function getLayout() { return layoutComponent; }


// --- Carregamento de Rotas Frontend ---

function convertPathToRoutePattern(absolutePath: string, routesDir: string): string {
    let relPath = path.relative(routesDir, absolutePath).replace(/\\/g, '/');
    relPath = relPath.replace(/\/?page\.(?:tsx|ts|jsx|js|vue|svelte)$/, '');
    relPath = relPath.replace(/\/\([^)]+\)/g, '').replace(/^\([^)]+\)\/?/, '');
    if (!relPath) return '/';
    return '/' + relPath;
}

export function loadPathRoutes(routesDir: string): (RouteConfig & { componentPath: string })[] {
    if (!fs.existsSync(routesDir)) {
        allRoutes = [];
        return [];
    }

    const loaded: CompiledRoute[] = [];
    const cwdPath = process.cwd();

    const scanAndLoad = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const name = entry.name;
            if (name.startsWith('.') || name.startsWith('_')) continue;

            const fullPath = path.join(dir, name);

            if (entry.isDirectory()) {
                if (name === 'backend' || name === 'api') continue;
                scanAndLoad(fullPath);
            } else if (entry.isFile() && (name === 'page.tsx' || name === 'page.ts' || name === 'page.jsx' || name === 'page.js' || name === 'page.vue' || name === 'page.svelte')) {
                const absolutePath = path.resolve(fullPath);

                if (loadedFiles.has(absolutePath)) {
                    safeClearCache(absolutePath);
                }
                loadedFiles.add(absolutePath);

                const componentPath = path.relative(cwdPath, fullPath).replace(/\\/g, '/');
                const pattern = convertPathToRoutePattern(absolutePath, routesDir);

                // OTIMIZAÇÃO MASSIVA: Lazy Loading dos Componentes
                // O transpile/require pesado só vai ocorrer de verdade se alguém acessar a rota
                const generatedConfig: RouteConfig = {
                    pattern,
                    get component() {
                        return requireOptimized<any>(absolutePath).default;
                    },
                    get generateMetadata() {
                        return requireOptimized<any>(absolutePath).generateMetadata || (() => ({}));
                    }
                };

                const regex = compileRoutePatternWithGroups(pattern);

                loaded.push({
                    config: generatedConfig,
                    componentPath,
                    regex,
                    paramNames: []
                });
            }
        }
    };

    scanAndLoad(routesDir);

    loaded.sort((a, b) => {
        const aDynamic = a.config.pattern.includes('[');
        const bDynamic = b.config.pattern.includes('[');
        if (aDynamic && !bDynamic) return 1;
        if (!aDynamic && bDynamic) return -1;
        return b.config.pattern.length - a.config.pattern.length;
    });

    allRoutes = loaded;

    // Retornamos os configs mantendo os Getters isolados (Não espalhar via Spread Object)
    return allRoutes.map(r => ({
        pattern: r.config.pattern,
        get component() { return r.config.component; },
        get generateMetadata() { return r.config.generateMetadata; },
        componentPath: r.componentPath
    }));
}


export function loadRoutes(routesDir: string): (RouteConfig & { componentPath: string })[] {
    return loadPathRoutes(path.join(routesDir, "../"))
}

export function findMatchingRoute(pathname: string) {
    for (const route of allRoutes) {
        const match = pathname.match(route.regex);
        if (match) {
            return {
                route: {
                    pattern: route.config.pattern,
                    get component() { return route.config.component; },
                    get generateMetadata() { return route.config.generateMetadata; },
                    componentPath: route.componentPath
                },
                params: match.groups || {}
            };
        }
    }
    return null;
}


// --- Carregamento de Rotas Backend ---

const middlewareCache = new Map<string, NytlexMiddleware[]>();

function getMiddlewaresForDir(dir: string): NytlexMiddleware[] {
    if (middlewareCache.has(dir)) return middlewareCache.get(dir)!;

    const files = ['middleware.ts', 'middleware.js'];
    let middlewares: NytlexMiddleware[] = [];

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.existsSync(fullPath)) {
            try {
                const absolutePath = path.resolve(fullPath);
                if (loadedFiles.has(absolutePath)) {
                    safeClearCache(absolutePath);
                }

                const mod = require(fullPath);
                loadedFiles.add(absolutePath);

                if (typeof mod.default === 'function') middlewares.push(mod.default);
                else if (Array.isArray(mod.default)) middlewares.push(...mod.default);

                Object.keys(mod).forEach(key => {
                    if (key !== 'default' && typeof mod[key] === 'function') {
                        middlewares.push(mod[key]);
                    }
                });

                break;
            } catch (e) {
                Console.error(`Error loading middleware ${fullPath}`, e);
            }
        }
    }

    middlewareCache.set(dir, middlewares);
    return middlewares;
}

export function loadBackendRoutes(backendRoutesDir: string) {
    if (!fs.existsSync(backendRoutesDir)) {
        allBackendRoutes = [];
        return;
    }

    middlewareCache.clear();
    const loaded: CompiledBackendRoute[] = [];

    const scanAndLoadAPI = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        getMiddlewaresForDir(dir);

        for (const entry of entries) {
            const name = entry.name;
            if (name.startsWith('.') || name.startsWith('_')) continue;

            const fullPath = path.join(dir, name);

            if (entry.isDirectory()) {
                scanAndLoadAPI(fullPath);
            } else if (entry.isFile() && (name.endsWith('.ts') || name.endsWith(".js"))) {
                if (name.startsWith('middleware')) continue;

                try {
                    const absolutePath = path.resolve(fullPath);
                    if (loadedFiles.has(absolutePath)) {
                        safeClearCache(absolutePath);
                    }

                    // Backend routes dependem de ler config.pattern no boot
                    const mod = requireOptimized<any>(absolutePath);
                    loadedFiles.add(absolutePath);

                    const config = mod.default;

                    if (config?.pattern) {
                        if (!config.middleware) {
                            const dirMiddlewares = getMiddlewaresForDir(dir);
                            if (dirMiddlewares.length > 0) {
                                config.middleware = dirMiddlewares;
                            }
                        }

                        loaded.push({
                            config,
                            regex: compileRoutePatternWithGroups(config.pattern),
                            paramNames: []
                        });
                    }
                } catch (e) {
                    Console.error(`Error loading API route ${fullPath}`, e);
                }
            }
        }
    };

    scanAndLoadAPI(backendRoutesDir);
    allBackendRoutes = loaded;

    processWebSocketRoutes();
}

export function findMatchingBackendRoute(pathname: string, method: string) {
    const methodUpper = method.toUpperCase();

    for (const route of allBackendRoutes) {
        // @ts-ignore
        if (!route.config[methodUpper]) continue;

        const match = pathname.match(route.regex);
        if (match) {
            return {
                route: route.config,
                params: match.groups || {}
            };
        }
    }
    return null;
}


// --- 404 Not Found ---

export function loadNotFound(webDir: string): { componentPath: string } | null {
    const files = ['notFound.tsx', 'notFound.jsx', 'notFound.vue', 'notFound.svelte'];

    for (const file of files) {
        const fullPath = path.join(webDir, file);
        if (fs.existsSync(fullPath)) {
            const absolutePath = path.resolve(fullPath);
            const componentPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');

            if (loadedFiles.has(absolutePath)) {
                safeClearCache(absolutePath);
            }
            loadedFiles.add(absolutePath);

            // OTIMIZAÇÃO: Sem requirer() agressivo imediato, envia só os metadados do local
            notFoundComponent = { componentPath };
            return notFoundComponent;
        }
    }

    notFoundComponent = null;
    return null;
}

export function getNotFound() { return notFoundComponent; }


// --- WebSocket ---

export function processWebSocketRoutes() {
    allWebSocketRoutes = allBackendRoutes
        .filter(r => r.config.WS)
        .map(r => ({
            config: r.config,
            regex: r.regex,
            handler: r.config.WS!,
            middleware: r.config.middleware
        }));
}

export function findMatchingWebSocketRoute(pathname: string) {
    for (const wsRoute of allWebSocketRoutes) {
        const match = pathname.match(wsRoute.regex);
        if (match) {
            return {
                route: {
                    pattern: wsRoute.config.pattern,
                    handler: wsRoute.handler,
                    middleware: wsRoute.middleware
                },
                params: match.groups || {}
            };
        }
    }
    return null;
}

function handleWebSocketConnection(ws: WebSocket, req: IncomingMessage, hwebReq: NytlexRequest) {
    if (!req.url) return;
    const url = new URL(req.url, `http://${req.headers.host}`);

    const match = findMatchingWebSocketRoute(url.pathname);
    if (!match) {
        ws.close(1000, 'Route not found');
        return;
    }

    const originalOn = ws.on.bind(ws);
    // @ts-ignore
    ws.on = function (event: string | symbol, listener: (...args: any[]) => void) {
        if (event === 'message') {
            const wrappedListener = (data: any, isBinary: boolean) => {
                const payload = Buffer.isBuffer(data) ? data.toString() : data;
                listener(payload, isBinary);
            };
            return originalOn(event, wrappedListener);
        }
        return originalOn(event, listener);
    };
    // @ts-ignore
    ws.addListener = ws.on;

    const context: WebSocketContext = {
        nytlexReq: hwebReq,
        ws,
        req,
        url,
        params: match.params,
        query: Object.fromEntries(url.searchParams.entries()),
        send: (data: any) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(typeof data === 'string' ? data : JSON.stringify(data));
            }
        },
        close: (code, reason) => ws.close(code || 1000, reason),
        broadcast: (data, exclude) => {
            const msg = typeof data === 'string' ? data : JSON.stringify(data);
            const excludeSet = new Set(exclude || []);
            for (const conn of wsConnections) {
                if (conn.readyState === WebSocket.OPEN && !excludeSet.has(conn)) {
                    conn.send(msg);
                }
            }
        }
    };

    try {
        match.route.handler(context);
    } catch (error) {
        console.error('Error in WebSocket handler:', error);
        ws.close(1011, 'Internal server error');
    }
}

export function setupWebSocketUpgrade(server: any, hotReloadManager?: any) {
    if (server.listeners('upgrade').length > 0) return;

    server.on('upgrade', (request: any, socket: any, head: Buffer) => {
        const adapter = FrameworkAdapterFactory.getCurrentAdapter();
        if (!adapter) {
            socket.destroy();
            return;
        }

        const { pathname } = new URL(request.url, `http://${request.headers.host}`);

        // Prioridade 1: Hot Reload
        if (pathname === '/hweb-hotreload/') {
            if (hotReloadManager) hotReloadManager.handleUpgrade(request, socket, head);
            else socket.destroy();
            return;
        }

        // Prioridade 2: Rotas App
        const match = findMatchingWebSocketRoute(pathname);
        if (match) {
            const wss = new WSServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 });

            wss.handleUpgrade(request, socket, head, (ws) => {
                wsConnections.add(ws);
                ws.on('close', () => wsConnections.delete(ws));
                ws.on('error', () => wsConnections.delete(ws));

                const hwebReq = new NytlexRequest(adapter.parseRequest(request));
                handleWebSocketConnection(ws, request, hwebReq);
            });
            return;
        }

        socket.destroy();
    });
}