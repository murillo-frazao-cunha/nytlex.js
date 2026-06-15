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
import { WebSocket, WebSocketServer } from 'ws';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import ts from 'typescript';
import { IncomingMessage } from 'http';
import { clearFileCache } from './router';
import Console, {Colors, Levels} from "./api/console"
import {config} from "./helpers";

// Chaves para persistência global para sobreviver a reloads do backend
const GLOBAL_ERROR_KEY = '__NYTLEX_LAST_BUILD_ERROR__';
const GLOBAL_ACTIVE_MANAGER_KEY = '__NYTLEX_ACTIVE_HOT_RELOAD_MANAGER__';

interface ClientConnection {
    ws: WebSocket;
    pingTimer: NodeJS.Timeout;
    lastPong: number;
}

// Interface para o estado composto de erro
interface BuildState {
    frontend: any | null;
    backend: any | null;
}

function sanitizeCompilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
    const sanitized = { ...options, noEmit: true };
    delete (sanitized as any).ignoreDeprecations;
    return sanitized;
}

function isIgnorableDiagnostic(diagnostic: ts.Diagnostic): boolean {
    return diagnostic.code === 5103;
}

export class HotReloadManager {
    private wss: WebSocketServer | null = null;
    private watchers: chokidar.FSWatcher[] = [];
    private projectDir: string;
    private clients: Map<WebSocket, ClientConnection> = new Map();
    private backendApiChangeCallback: (() => void) | null = null;
    private frontendChangeCallback: (() => void) | null = null;
    private isShuttingDown: boolean = false;
    private customHotReloadListener: ((file: string) => Promise<void> | void) | null = null;
    private isBuilding: boolean = false;
    private buildCompleteResolve: (() => void) | null = null;

    // Gerenciamento de Fila de Reload e Estados (Correção da Race Condition)
    private pendingFilesToProcess: Set<string> = new Set();
    private globalDebounceTimer: NodeJS.Timeout | null = null;
    private pendingFrontendFiles: Set<string> = new Set();
    private oldProgram: ts.Program | undefined;
    private esbuildStatus: 'building' | 'idle' | 'error' = 'idle';

    // Impede que um "success" fora de ordem limpe um erro real de frontend.
    private lastFrontendErrorBuildId: number = 0;

    private get buildState(): BuildState {
        const state = (global as any)[GLOBAL_ERROR_KEY];
        if (!state) {
            return { frontend: null, backend: null };
        }
        return state;
    }

    private set buildState(value: BuildState) {
        (global as any)[GLOBAL_ERROR_KEY] = value;
    }

    constructor(projectDir: string) {
        this.projectDir = projectDir;
        (global as any)[GLOBAL_ACTIVE_MANAGER_KEY] = this;

        if (!(global as any)[GLOBAL_ERROR_KEY]) {
            this.buildState = { frontend: null, backend: null };
        }
    }

    async start() {
        this.setupWatchers();
    }

    handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
        if (this.isShuttingDown) {
            socket.destroy();
            return;
        }

        if (!this.wss) {
            this.wss = new WebSocketServer({
                noServer: true,
                perMessageDeflate: false,
                maxPayload: 1024 * 1024
            });
            this.setupWebSocketServer();
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
        });
    }

    private setupWebSocketServer() {
        if (!this.wss) return;

        this.wss.on('connection', (ws: WebSocket) => {
            if (this.isShuttingDown) {
                ws.close();
                return;
            }

            const pingTimer = setInterval(() => {
                const client = this.clients.get(ws);
                if (client && ws.readyState === WebSocket.OPEN) {
                    if (Date.now() - client.lastPong > 60000) {
                        ws.terminate();
                        return;
                    }
                    ws.ping();
                }
            }, 30000);

            const clientConnection: ClientConnection = {
                ws,
                pingTimer,
                lastPong: Date.now()
            };

            this.clients.set(ws, clientConnection);

            setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) return;
                this.broadcastCurrentState(ws);
            }, 0);

            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(String(raw || ''));
                    if (msg?.type === 'status-request') {
                        this.broadcastCurrentState(ws);
                    }
                } catch {
                    // ignore
                }
            });

            ws.on('pong', () => {
                const client = this.clients.get(ws);
                if (client) {
                    client.lastPong = Date.now();
                }
            });

            ws.on('close', () => {
                this.cleanupClient(ws);
            });

            ws.on('error', (error) => {
                Console.logWithout(Levels.ERROR, Colors.BgRed,`WebSocket error: ${error.message}`);
                this.cleanupClient(ws);
            });
        });
    }

    private broadcastCurrentState(ws: WebSocket) {
        const state = this.buildState;
        const activeError = state.backend || state.frontend;

        if (activeError) {
            try {
                ws.send(JSON.stringify({ type: 'build-error', data: activeError, timestamp: Date.now() }));
            } catch {}
        } else {
            try {
                ws.send(JSON.stringify({ type: 'build-complete', data: { success: true }, timestamp: Date.now() }));
            } catch {}
        }
    }

    private cleanupClient(ws: WebSocket) {
        const client = this.clients.get(ws);
        if (client) {
            clearInterval(client.pingTimer);
            this.clients.delete(ws);
        }
    }

    private setupWatchers() {
        const watcher = chokidar.watch([
            path.join(this.projectDir, 'src/**/*'),
        ], {
            ignored: [
                /(^|[\/\\])\../,
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**'
            ],
            persistent: true,
            ignoreInitial: true,
            usePolling: false,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });

        const queueChange = (filePath: string) => {
            this.pendingFilesToProcess.add(filePath);

            if (this.globalDebounceTimer) {
                clearTimeout(this.globalDebounceTimer);
            }

            // Reduzido para 75ms para reagir instantaneamente
            this.globalDebounceTimer = setTimeout(() => {
                this.processBatchedChanges();
            }, 75);
        };

        watcher.on('change', queueChange);
        watcher.on('add', queueChange);
        watcher.on('unlink', (filePath) => {
            Console.info(`File removed: ${path.basename(filePath)}`);
            clearFileCache(filePath);
            this.clearBackendCache(filePath);
            queueChange(filePath);
        });

        this.watchers.push(watcher);
    }

    private setBackendError(error: any) {
        const currentState = this.buildState;

        const errorData = {
            message: error?.message || 'Unknown Backend Error',
            stack: error?.stack,
            type: 'BackendError',
            ts: Date.now()
        };

        const isTypeScriptCompileError =
            typeof errorData.message === 'string' &&
            (errorData.message.includes('Unable to compile TypeScript') ||
                errorData.message.includes('TSError') ||
                errorData.message.includes('TS2304') ||
                errorData.message.includes('TS1005') ||
                errorData.message.includes('TS17002'));

        Console.error("Captured Backend Error:", errorData.message);

        this.buildState = {
            ...currentState,
            backend: errorData,
            frontend: isTypeScriptCompileError ? (currentState.frontend || errorData) : currentState.frontend
        };

        this.notifyStatusChange();
    }

    private async processBatchedChanges() {
        if (this.pendingFilesToProcess.size === 0) return;

        const files = Array.from(this.pendingFilesToProcess);
        this.pendingFilesToProcess.clear();

        const fileNames = files.map(f => path.basename(f)).join(', ');
        const dm = Console.dynamicLine(`Changes detected in ${files.length} file(s) (${fileNames}), processing batch...`);

        this.notifyClients('build-start', { files });

        let hasBackendError = false;
        let requiresFrontendBuild = false;
        let requiresBackendReinit = false;

        for (const filePath of files) {
            clearFileCache(filePath);
            this.clearBackendCache(filePath);

            const isFrontendFile = filePath.includes(path.join('src', 'web', 'routes')) ||
                filePath.includes(path.join('src', 'web'));

            const isBackendFile = filePath.includes(path.join('src', 'backend')) && !isFrontendFile;

            if (isFrontendFile) {
                requiresFrontendBuild = true;
                this.pendingFrontendFiles.add(filePath);
            }
            if (isBackendFile) requiresBackendReinit = true;

            if (!isFrontendFile && !isBackendFile) {
                requiresFrontendBuild = true;
                requiresBackendReinit = true;
                this.pendingFrontendFiles.add(filePath);
            }
        }

        if (requiresBackendReinit) {
            Console.logWithout(Levels.INFO, undefined, `Reloading backend API...`);
            try {
                this.backendApiChangeCallback?.();
                const s = this.buildState;
                if (s.backend) {
                    this.buildState = { ...s, backend: null };
                    this.notifyStatusChange();
                }
            } catch (e) {
                this.setBackendError(e);
                hasBackendError = true;
            }
        }

        if (requiresFrontendBuild) {
            Console.logWithout(Levels.INFO, undefined, `Frontend changes queued for HMR build.`);
            try {
                this.frontendChangeCallback?.();
            } catch (e) {
                this.setBackendError(e);
                hasBackendError = true;
            }
            // Tenta engatilhar o reload do front. Se o esbuild ainda não terminou, ele para e espera.
            this.tryTriggerFrontendReload();
        } else if (requiresBackendReinit && !hasBackendError) {
            this.notifyClients('backend-api-reload', { files, event: 'batch-change' });
        }

        for (const filePath of files) {
            if (this.customHotReloadListener) {
                try {
                    await this.customHotReloadListener(filePath);
                } catch (error: any) {
                    Console.logWithout(Levels.ERROR, undefined, `Error in custom listener: ${error.message}`);
                }
            }
        }

        dm.end(`Batch processing completed.`);
    }

    // --- Sincronizador Esbuild x Chokidar ---

    onBuildStart() {
        this.esbuildStatus = 'building';
        this.notifyClients('build-start', { files: [] });
    }

    onBuildComplete(success: boolean, error?: any) {
        this.traceBuildComplete(success, error);

        const activeManager = (global as any)[GLOBAL_ACTIVE_MANAGER_KEY];
        if (activeManager && activeManager !== this) {
            activeManager.onBuildComplete(success, error);
            return;
        }

        if (this.buildCompleteResolve) {
            this.buildCompleteResolve();
            this.buildCompleteResolve = null;
        }

        this.isBuilding = false;
        this.esbuildStatus = success ? 'idle' : 'error';

        const currentState = this.buildState;
        const buildId = typeof (error as any)?.buildId === 'number' ? (error as any).buildId : undefined;

        if (success) {
            if (currentState.frontend && currentState.frontend.message?.includes('Transform failed')) {
                this.buildState = { ...currentState, frontend: null };
            }

            if (buildId !== undefined && buildId < this.lastFrontendErrorBuildId) {
                this.buildState = { ...currentState };
                this.notifyStatusChange();
                return;
            }

            // O Esbuild terminou, agora ele tenta disparar o reload se o Chokidar já tiver colocado os arquivos na fila.
            this.tryTriggerFrontendReload();
            return;
        }

        const errData = error || { message: 'Build failed', ts: Date.now() };
        if (buildId !== undefined) this.lastFrontendErrorBuildId = Math.max(this.lastFrontendErrorBuildId, buildId);
        this.buildState = { ...currentState, frontend: errData };

        this.notifyStatusChange();
    }

    private tryTriggerFrontendReload() {
        if (this.esbuildStatus === 'building') return; // Espera o Esbuild terminar
        if (this.esbuildStatus === 'error') return;    // Não recarrega se o Esbuild falhou
        if (this.pendingFrontendFiles.size === 0) return; // Espera o Chokidar descobrir o que mudou

        // Quando AMBOS finalizarem, essa linha executa:
        const changedFiles = Array.from(this.pendingFrontendFiles);
        this.pendingFrontendFiles.clear();

        if (!this.shouldTypecheckFrontend(changedFiles)) {
            this.buildState = { ...this.buildState, frontend: null };
            this.notifyClients('frontend-reload', { files: changedFiles });
            return;
        }

        const tc = this.typecheckFrontend(changedFiles);
        if (!tc.ok) {
            this.buildState = { ...this.buildState, frontend: tc.error };
            this.notifyStatusChange();
            return;
        }

        this.buildState = { ...this.buildState, frontend: null };
        this.notifyClients('frontend-reload', { files: changedFiles });
    }

    private notifyStatusChange() {
        const state = this.buildState;
        const activeError = state.backend || state.frontend;

        if (activeError) {
            this.notifyClients('build-error', activeError);
        } else {
            this.notifyClients('build-complete', { success: true });
        }
    }

    private notifyClients(type: string, data?: any) {
        if (this.isShuttingDown) return;

        if (this.clients.size === 0) {
            const activeManager = (global as any)[GLOBAL_ACTIVE_MANAGER_KEY];
            if (activeManager && activeManager !== this) {
                // @ts-ignore
                activeManager.notifyClients(type, data);
                return;
            }
        }

        const message = JSON.stringify({ type, data, timestamp: Date.now() });
        const deadClients: WebSocket[] = [];

        this.clients.forEach((client, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                } catch (error) {
                    deadClients.push(ws);
                }
            } else {
                deadClients.push(ws);
            }
        });

        deadClients.forEach(ws => this.cleanupClient(ws));
    }

    getClientScript(): string {
        return `
        <script>
        (function() {
            if (typeof window !== 'undefined') {
                let ws;
                let reconnectAttempts = 0;
                let isConnected = false;

                function dispatch(name, detail) {
                    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch(e) {}
                }

                function connect() {
                    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                    const port = protocol === "wss:" ? "${config?.ssl?.http3Port}" : "${config?.port}"
                    const wsUrl = protocol + '//' + window.location.hostname + ':' + port + '/hweb-hotreload/';
                    
                    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

                    try {
                        ws = new WebSocket(wsUrl);
                        ws.onopen = function() {
                            console.log('\\u001b[32m[nytlex]\\u001b[0m Hot-reload connected');
                            isConnected = true;
                            reconnectAttempts = 0;
                            ws.send(JSON.stringify({ type: 'status-request', ts: Date.now() }));
                        };
                        
                        ws.onmessage = function(event) {
                            try {
                                const message = JSON.parse(event.data);
                                switch(message.type) {
                                    case 'build-start':
                                        window.__NYTLEX_HOT_RELOAD__ = { state: 'reloading', payload: message.data, ts: Date.now() };
                                        dispatch('nytlex:hotreload', window.__NYTLEX_HOT_RELOAD__);
                                        break;
                                    case 'frontend-reload':
                                    case 'backend-api-reload':
                                    case 'server-ready':
                                        console.log('[nytlex] Changes applied, reloading page...');
                                        dispatch('nytlex:hmr-ready', { files: message.data?.files });
                                        
                                        window.__NYTLEX_HOT_RELOAD__ = { state: 'idle', payload: { success: true }, ts: Date.now() };
                                        dispatch('nytlex:hotreload', window.__NYTLEX_HOT_RELOAD__);
                                        
                                        setTimeout(() => window.location.reload(), 150);
                                        break;
                                    case 'build-error':
                                        window.__NYTLEX_HOT_RELOAD__ = { state: 'build-error', payload: message.data, ts: Date.now() };
                                        dispatch('nytlex:hotreload', window.__NYTLEX_HOT_RELOAD__);
                                        dispatch('nytlex:build-error', message.data);
                                        console.error('[nytlex] Build Error:', message.data);
                                        break;
                                    case 'build-complete':
                                        window.__NYTLEX_HOT_RELOAD__ = { state: 'idle', payload: { build: 'ok' }, ts: Date.now() };
                                        dispatch('nytlex:hotreload', window.__NYTLEX_HOT_RELOAD__);
                                        dispatch('nytlex:build-ok', { ts: Date.now() });
                                        break;
                                }
                            } catch (e) {
                                console.error('[nytlex] Error processing msg:', e);
                            }
                        };
                        
                        ws.onclose = function(event) {
                            isConnected = false;
                            if (event.code === 1000) return;
                            setTimeout(connect, Math.min(1000 * Math.pow(1.5, reconnectAttempts++), 30000));
                        };
                    } catch (error) { setTimeout(connect, 1000); }
                }
                
                document.addEventListener('visibilitychange', function() { if (!document.hidden && !isConnected) { reconnectAttempts = 0; connect(); } });
                connect();
            }
        })();
        </script>
        `;
    }

    private clearBackendCache(filePath: string) {
        const absolutePath = path.resolve(filePath);
        try {
            delete require.cache[absolutePath];
        } catch {}

        try {
            const resolved = require.resolve(absolutePath);
            delete require.cache[resolved];
        } catch {}
    }

    onBackendApiChange(callback: () => void) { this.backendApiChangeCallback = callback; }
    onFrontendChange(callback: () => void) { this.frontendChangeCallback = callback; }
    setHotReloadListener(listener: (file: string) => Promise<void> | void) {
        this.customHotReloadListener = listener;
        Console.info('Hot reload custom listener registered');
    }
    removeHotReloadListener() { this.customHotReloadListener = null; }

    private lastBuildCompleteTraceAt: number = 0;
    private traceBuildComplete(success: boolean, error?: any) {
        try {
            const now = Date.now();
            if (now - this.lastBuildCompleteTraceAt < 500) return;
            this.lastBuildCompleteTraceAt = now;
        } catch {}
    }

    private checkVueFiles(): { ok: boolean; error?: any } | null {
        try {
            let compiler: any;
            try {
                compiler = require('vue/compiler-sfc');
            } catch {
                try {
                    compiler = require('@vue/compiler-sfc');
                } catch {
                    return null;
                }
            }

            const findVueFiles = (dir: string): string[] => {
                let results: string[] = [];
                if (!fs.existsSync(dir)) return results;
                const list = fs.readdirSync(dir);
                list.forEach(file => {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat && stat.isDirectory()) {
                        if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
                            results = results.concat(findVueFiles(filePath));
                        }
                    } else if (file.endsWith('.vue')) {
                        results.push(filePath);
                    }
                });
                return results;
            };

            const webSrc = path.join(this.projectDir, 'src');
            const vueFiles = findVueFiles(webSrc);

            if (vueFiles.length === 0) return { ok: true };

            for (const file of vueFiles) {
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    const parsed = compiler.parse(content, {
                        filename: file,
                        sourceMap: false
                    });

                    if (parsed.errors && parsed.errors.length > 0) {
                        const firstError = parsed.errors[0];
                        const loc = firstError.loc ? {
                            file: file,
                            line: firstError.loc.start.line,
                            column: firstError.loc.start.column
                        } : undefined;

                        const syntheticStack = `SyntaxError: ${firstError.message}\n    at ${file}:${loc?.line}:${loc?.column}`;

                        return {
                            ok: false,
                            error: {
                                message: `Vue Error: ${firstError.message}`,
                                type: 'VueCompilerError',
                                loc,
                                stack: syntheticStack,
                                ts: Date.now()
                            }
                        };
                    }
                } catch (readError) {}
            }
        } catch (e) {}
        return { ok: true };
    }

    private shouldTypecheckFrontend(changedFiles: string[]): boolean {
        return changedFiles.some(file => {
            const lower = file.toLowerCase();
            return lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.vue');
        });
    }

    private typecheckFrontend(changedFiles: string[]): { ok: boolean; error?: any } {
        try {
            const shouldCheckVue = changedFiles.some(file => file.toLowerCase().endsWith('.vue'));
            if (shouldCheckVue) {
                const vueResult = this.checkVueFiles();
                if (vueResult && !vueResult.ok) {
                    return vueResult;
                }
            }

            const projectDir = this.projectDir;
            const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
            if (!configPath) {
                return { ok: true };
            }

            const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
            if (configFile.error) {
                const msg = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');
                const err = { message: `tsconfig read error: ${msg}`, type: 'TypeScriptConfigError', ts: Date.now() };
                return { ok: false, error: err };
            }

            const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
            const configDiagnostics = (parsed.errors || []).filter(d => !isIgnorableDiagnostic(d));
            if (configDiagnostics.length > 0) {
                const firstConfigError = configDiagnostics[0];
                const msg = ts.flattenDiagnosticMessageText(firstConfigError.messageText, '\n');
                const err = {
                    message: `tsconfig error: ${msg}`,
                    type: 'TypeScriptConfigError',
                    ts: Date.now()
                };
                return { ok: false, error: err };
            }

            const options: ts.CompilerOptions = sanitizeCompilerOptions(parsed.options);

            const rootNames = parsed.fileNames;
            const webRoot = path.resolve(projectDir, 'src', 'web') + path.sep;
            const filteredRoots = rootNames.filter(f => f.startsWith(webRoot));

            const filesToCheck = filteredRoots.length ? filteredRoots : rootNames;

            if (filesToCheck.length === 0) {
                return { ok: true };
            }

            const host = ts.createCompilerHost(options);
            const program = ts.createProgram(filesToCheck, options, host, this.oldProgram);
            this.oldProgram = program;

            const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => !isIgnorableDiagnostic(d));

            if (!diagnostics.length) {
                return { ok: true };
            }

            const first = diagnostics[0];
            const message = ts.flattenDiagnosticMessageText(first.messageText, '\n');
            const code = typeof first.code === 'number' ? `TS${first.code}` : undefined;

            const loc = first.file && typeof first.start === 'number'
                ? (() => {
                    const pos = first.file!.getLineAndCharacterOfPosition(first.start!);
                    return { file: first.file!.fileName, line: pos.line + 1, column: pos.character + 1 };
                })()
                : undefined;

            const lines: string[] = [];
            lines.push(`TypeScript check failed${code ? ` (${code})` : ''}: ${message}`);
            if (loc?.file) lines.push(`at ${loc.file}:${loc.line}:${loc.column}`);

            const syntheticStack = ['Error: ' + lines[0], ...(loc?.file ? [lines[1]] : [])].join('\n');

            const err = {
                message: lines[0],
                type: 'TypeScriptError',
                code,
                loc,
                stack: syntheticStack,
                ts: Date.now()
            };

            return { ok: false, error: err };
        } catch (e: any) {
            const err = { message: e?.message || 'TypeScript check failed', stack: e?.stack, type: 'TypeScriptError', ts: Date.now() };
            return { ok: false, error: err };
        }
    }
}