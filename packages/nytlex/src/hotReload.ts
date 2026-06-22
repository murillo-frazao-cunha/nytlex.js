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
import { IncomingMessage } from 'http';
import Console, { Colors, Levels } from "./api/console";
import { config } from "./helpers";

export class HotReloadManager {
    private wss: WebSocketServer | null = null;
    private watchers: chokidar.FSWatcher[] = [];
    private clients: Set<WebSocket> = new Set();

    private backendApiChangeCallback: (() => void) | null = null;
    private frontendChangeCallback: (() => void) | null = null;
    private customHotReloadListener: ((file: string) => Promise<void> | void) | null = null;
    private isShuttingDown: boolean = false;

    constructor(private projectDir: string) {}

    async start() {
        this.setupBackendWatcher();
    }

    handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
        if (this.isShuttingDown) {
            socket.destroy();
            return;
        }

        if (!this.wss) {
            this.wss = new WebSocketServer({ noServer: true });

            this.wss.on('connection', (ws: WebSocket) => {
                this.clients.add(ws);

                ws.on('message', (raw) => {
                    try {
                        const msg = JSON.parse(String(raw || ''));
                        if (msg?.type === 'status-request') {
                            ws.send(JSON.stringify({ type: 'build-complete', data: { success: true }, timestamp: Date.now() }));
                        }
                    } catch {}
                });

                ws.on('close', () => this.clients.delete(ws));
                ws.on('error', () => this.clients.delete(ws));
            });
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
        });
    }

    private notifyClients(type: string, data?: any) {
        if (this.isShuttingDown) return;
        const payload = JSON.stringify({ type, data, timestamp: Date.now() });
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }

    // --- ESBUILD EVENTS (Frontend HMR super rápido) ---
    onBuildStart() {
        Console.logWithout(Levels.INFO, undefined, `Frontend changes queued for HMR build.`);
        this.notifyClients('build-start');
    }

    onBuildComplete(success: boolean, error?: any, buildResult?: any) {
        if (success) {
            Console.dynamicLine(`Frontend build complete.`).end(`Batch processing completed.`);
            if (this.frontendChangeCallback) this.frontendChangeCallback();

            // Extrai as saídas do metafile do esbuild (quais chunks mudaram)
            // Se o buildResult vier null/undefined, envia payload vazio pra n dar pau
            const changedOutputs = buildResult?.metafile ? Object.keys(buildResult.metafile.outputs) : [];

            // Emitimos o evento de 'hmr-update' preparado pra injeção de Fast-Refresh
            // Em vez de dar hard reload ('frontend-reload')
            this.notifyClients('hmr-update', { files: changedOutputs });
        } else {
            Console.error("Captured Build Error:", error?.message || 'Unknown Esbuild error');
            // Repassa o objeto de erro (agora formatado em builder.js) diretamente pro frontend!
            this.notifyClients('build-error', error);
        }
    }

    // --- CHOKIDAR (Vigia Backend API e Mudanças Estruturais do Frontend) ---
    private setupBackendWatcher() {
        const watcher = chokidar.watch(path.join(this.projectDir, 'src'), {
            ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/.git/**', '**/dist/**'],
            persistent: true,
            ignoreInitial: true
        });

        let debounceTimer: NodeJS.Timeout;
        const pendingBackendFiles = new Set<string>();
        let frontendNeedsStructuralRebuild = false;

        watcher.on('all', async (event, filePath) => {
            // Dispara listener customizado se existir
            if (this.customHotReloadListener) {
                try { await this.customHotReloadListener(filePath); } catch (e: any) { Console.error(`Custom listener error:`, e.message); }
            }

            const isFrontend = filePath.includes(path.join('src', 'web'));
            const isBackend = filePath.includes(path.join('src', 'backend')) || (!isFrontend && filePath.endsWith('.ts'));

            // Se for Backend, adicionamos na fila para re-injetar
            if (isBackend) {
                pendingBackendFiles.add(filePath);
            }

            // Se for Frontend, o Esbuild cuida dos 'changes'. Mas se criar/deletar/mover ('add', 'unlink', etc)
            // o Esbuild não detecta sozinho. Precisamos forçar a reconstrução da árvore!
            if (isFrontend && event !== 'change') {
                frontendNeedsStructuralRebuild = true;
            }

            if (pendingBackendFiles.size > 0 || frontendNeedsStructuralRebuild) {
                clearTimeout(debounceTimer);

                debounceTimer = setTimeout(() => {
                    // Trata mudanças na estrutura do frontend (Novos arquivos ou arquivos removidos)
                    if (frontendNeedsStructuralRebuild) {
                        Console.logWithout(Levels.INFO, undefined, `Structural changes detected in frontend (file added/removed). Triggering router rebuild...`);
                        if (this.frontendChangeCallback) this.frontendChangeCallback();

                        // O framework de HMR no front vai precisar decidir se ele recarrega a pagina ou tenta injetar a nova rota.
                        // Pra ser seguro, se estruturalmente mudou, a gente manda um reload classico.
                        this.notifyClients('frontend-reload');
                        frontendNeedsStructuralRebuild = false;
                    }

                    // Trata as mudanças do backend
                    if (pendingBackendFiles.size > 0) {
                        Console.logWithout(Levels.INFO, undefined, `Reloading backend API...`);

                        // Limpa o cache do require para injetar o novo código backend
                        for (const file of pendingBackendFiles) {
                            try {
                                const resolved = require.resolve(path.resolve(file));
                                delete require.cache[resolved];
                            } catch {}
                        }
                        pendingBackendFiles.clear();

                        if (this.backendApiChangeCallback) this.backendApiChangeCallback();
                        this.notifyClients('backend-api-reload');
                    }
                }, 100);
            }
        });

        this.watchers.push(watcher);
    }

    onBackendApiChange(callback: () => void) { this.backendApiChangeCallback = callback; }
    onFrontendChange(callback: () => void) { this.frontendChangeCallback = callback; }
    setHotReloadListener(listener: (file: string) => Promise<void> | void) { this.customHotReloadListener = listener; }
    removeHotReloadListener() { this.customHotReloadListener = null; }

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
                                    
                                    // NOVO EVENTO PRA FAST-REFRESH E HMR
                                    case 'hmr-update':
                                        console.log('[nytlex] HMR Update received, propagating to framework...');
                                        window.__NYTLEX_HOT_RELOAD__ = { state: 'hmr', payload: message.data, ts: Date.now() };
                                        dispatch('nytlex:hotreload', window.__NYTLEX_HOT_RELOAD__);
                                        dispatch('nytlex:hmr-update', message.data);
                                        break;

                                    case 'frontend-reload':
                                    case 'backend-api-reload':
                                    case 'server-ready':
                                        console.log('[nytlex] Structural/Backend changes applied, full page reload...');
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
}