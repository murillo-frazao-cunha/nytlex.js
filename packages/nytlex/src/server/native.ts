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
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { Duplex } from 'stream';
import Console, { Colors } from "../api/console";
import { NativeServer } from "../api/native-server";
import type { NytlexOptions, NytlexConfig } from '../types';
import { applyCors, parseBody } from './middlewares';
import { sendBox } from '../utils/logger';
import { setConfig } from '../config';

// --- Tipagem ---

export interface NytlexApp {
    prepare: (skipBuild?: boolean) => Promise<void>;
    getRequestHandler: () => (req: any, res: any, next?: any) => Promise<void> | void;
    setupWebSocket: (server: Server | any) => void;
    executeInstrumentation: () => void;
}

export interface NytlexIncomingMessage extends IncomingMessage {
    body?: object | string | null;
}

/**
 * Inicializa servidor nativo do Nytlex.js usando HTTP ou HTTPS
 */
export async function initNativeServer(nytlexApp: NytlexApp, options: NytlexOptions, hostname: string, nytlexConfig: NytlexConfig) {
    const time = Date.now();

    setConfig(nytlexConfig);
    // Passa envFiles da config para as opções do nytlex
    options.envFiles = nytlexConfig.envFiles;

    await nytlexApp.prepare(options.skipBuild || false);

    const handler = nytlexApp.getRequestHandler();
    const msg = Console.dynamicLine(`${Colors.Bright}Starting Nytlex.js on port ${nytlexConfig?.port}${Colors.Reset}`);

    // --- LÓGICA DO LISTENER (REUTILIZÁVEL) ---
    const requestListener = async (req: NytlexIncomingMessage, res: ServerResponse) => {
        const requestStartTime = Date.now();
        const method = req.method || 'GET';
        const url = req.url || '/';

        // Aplica CORS se configurado
        const corsHandled = applyCors(req, res, nytlexConfig.cors);
        if (corsHandled) {
            // Requisição OPTIONS foi respondida pelo CORS
            if (nytlexConfig.accessLogging) {
                const duration = Date.now() - requestStartTime;
                Console.logCustomLevel('OPTIONS', true, Colors.BgMagenta, `${url} ${Colors.FgGreen}204${Colors.Reset} ${Colors.FgGray}${duration}ms${Colors.Reset} ${Colors.FgCyan}[CORS]${Colors.Reset}`);
            }
            return;
        }

        // Configurações de segurança básicas
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

        // Aplica headers de segurança configurados
        if (nytlexConfig.security?.contentSecurityPolicy) {
            res.setHeader('Content-Security-Policy', nytlexConfig.security.contentSecurityPolicy);
        }

        if (nytlexConfig.security?.permissionsPolicy) {
            res.setHeader('Permissions-Policy', nytlexConfig.security.permissionsPolicy);
        }

        const hstsValue = nytlexConfig.security?.strictTransportSecurity || 'max-age=31536000; includeSubDomains';
        res.setHeader('Strict-Transport-Security', hstsValue);

        // Aplica headers personalizados
        if (nytlexConfig.customHeaders) {
            for (const [headerName, headerValue] of Object.entries(nytlexConfig.customHeaders)) {
                res.setHeader(headerName, headerValue);
            }
        }

        // Timeout por requisição
        if (!req.headers.upgrade) {
            req.setTimeout(nytlexConfig.individualRequestTimeout || 30000, () => {
                res.statusCode = 408; // Request Timeout
                res.end('Request timeout');

                // Log de timeout
                if (nytlexConfig.accessLogging) {
                    const duration = Date.now() - requestStartTime;
                    Console.info(`${Colors.FgYellow}${method}${Colors.Reset} ${url} ${Colors.FgRed}408${Colors.Reset} ${Colors.FgGray}${duration}ms${Colors.Reset}`);
                }
            });
        }

        // Intercepta o método end() para logar
        const originalEnd = res.end.bind(res);
        let hasEnded = false;

        res.end = function(this: ServerResponse, ...args: any[]): any {
            if (!hasEnded && nytlexConfig.accessLogging && !url.includes("/api/rpc") && (!url.includes("_nytlex/") && !url.includes(".js") && !url.includes(".css") && !url.includes("hotreload"))) {
                hasEnded = true;
                const duration = Date.now() - requestStartTime;
                const statusCode = res.statusCode || 200;

                // Define cor baseada no status code
                let statusColor = Colors.FgGreen;
                if (statusCode >= 500) statusColor = Colors.FgRed;
                else if (statusCode >= 400) statusColor = Colors.FgYellow;
                else if (statusCode >= 300) statusColor = Colors.FgCyan;

                // Formata o método com cor
                let methodColor = Colors.FgCyan;
                if (method === 'POST') methodColor = Colors.FgGreen;
                else if (method === 'PUT') methodColor = Colors.FgYellow;
                else if (method === 'DELETE') methodColor = Colors.FgRed;
                else if (method === 'PATCH') methodColor = Colors.FgMagenta;

                Console.logCustomLevel(method, true, methodColor, `${url} ${statusColor}${statusCode}${Colors.Reset} ${Colors.FgGray}${duration}ms${Colors.Reset}`);
            }
            // @ts-ignore
            return originalEnd.apply(this, args);
        } as any;

        try {
            // Validação básica de URL
            const maxUrlLength = nytlexConfig.maxUrlLength || 2048;
            if (url.length > maxUrlLength) {
                res.statusCode = 414; // URI Too Long
                res.end('URL too long');
                return;
            }

            // Parse do body com proteções
            req.body = await parseBody(req);

            // Adiciona host se não existir
            req.headers.host = req.headers.host || `localhost:${nytlexConfig?.port}`;

            await handler(req, res);

        } catch (error) {
            if (error instanceof Error) {
                Console.error(`Native server error: ${error.message}`);
            } else {
                Console.error('Unknown native server error:', error);
            }

            if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/plain');
                if (error instanceof Error) {
                    if (error.message.includes('too large')) {
                        res.statusCode = 413;
                        res.end('Request too large');
                    } else if (error.message.includes('timeout')) {
                        res.statusCode = 408;
                        res.end('Request timeout');
                    } else if (error.message.includes('Invalid JSON')) {
                        res.statusCode = 400;
                        res.end('Invalid JSON body');
                    } else {
                        res.statusCode = 500;
                        res.end('Internal server error');
                    }
                } else {
                    res.statusCode = 500;
                    res.end('Internal server error');
                }
            }
        }
    };
    // --- FIM DO LISTENER ---

    const server = http.createServer(requestListener as any);

    // Configurações de timeout
    server.setTimeout(nytlexConfig.serverTimeout || 35000);
    // @ts-ignore
    if (server.maxHeadersCount) server.maxHeadersCount = nytlexConfig.maxHeadersCount || 100;
    // @ts-ignore
    if (server.headersTimeout) server.headersTimeout = nytlexConfig.headersTimeout || 60000;
    // @ts-ignore
    if (server.requestTimeout) server.requestTimeout = nytlexConfig.requestTimeout || 30000;

    const isSSL = !!(nytlexConfig.ssl && nytlexConfig.ssl.key && nytlexConfig.ssl.cert);

    // --- NOVA ARQUITETURA: Native Bridge (Todos os SOs) ---
    const connections = new Map<number, Duplex>();

    class NativeBridge extends Duplex {
        constructor(public connId: number) {
            super({ allowHalfOpen: true });
        }

        remoteAddress = '127.0.0.1';
        remoteFamily = 'IPv4';
        remotePort = 0;
        localAddress = '127.0.0.1';
        localPort = 0;

        setNoDelay(noDelay?: boolean) { return this; }
        setKeepAlive(enable?: boolean, initialDelay?: number) { return this; }
        ref() { return this; }
        unref() { return this; }

        setTimeout(msecs: number, callback?: () => void) {
            if (msecs === 0) return this;
            if (callback) {
                this.once('timeout', callback);
            }
            return this;
        }

        _read(size: number) {}

        _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
            try {
                const buffer = typeof chunk === 'string'
                    ? Buffer.from(chunk, encoding)
                    : chunk;

                NativeServer.write(this.connId, buffer);
                callback();
            } catch (err: any) {
                callback(err);
            }
        }

        _final(callback: (error?: Error | null) => void) {
            NativeServer.closeConnection(this.connId);
            callback();
        }

        _destroy(error: Error | null, callback: (error: Error | null) => void) {
            NativeServer.closeConnection(this.connId);
            callback(error);
        }
    }

    // Alterado para let para poder atualizar depois do fallback do Go
    let publicPort = nytlexConfig.port || (isSSL ? 443 : 3000);
    let goHttpPort = "";
    let goHttpsPort = "";
    let certPath = "";
    let keyPath = "";

    if (isSSL) {
        const redirectPort = nytlexConfig.ssl?.redirectPort || 80;
        goHttpPort = `:${redirectPort}`;
        goHttpsPort = `:${publicPort}`;
        certPath = nytlexConfig?.ssl?.cert || "";
        keyPath = nytlexConfig?.ssl?.key || "";
    } else {
        goHttpPort = `:${publicPort}`;
    }

    try {
        const h3PortValue = nytlexConfig.ssl?.http3Port
            ? String(nytlexConfig.ssl.http3Port)
            : "";

        // Captura o resultado da execução nativa
        const result = NativeServer.start({
            httpPort: goHttpPort,
            httpsPort: goHttpsPort,
            certPath: certPath,
            keyPath: keyPath,
            http3Port: h3PortValue ? (h3PortValue.includes(':') ? h3PortValue : `:${h3PortValue}`) : "",
            devMode: options.dev ? "true" : "false",
            onData: (connId, data) => {
                let bridge = connections.get(connId);

                if (!bridge) {
                    bridge = new NativeBridge(connId);
                    connections.set(connId, bridge);
                    server.emit('connection', bridge);

                    bridge.on('close', () => {
                        connections.delete(connId);
                    });
                }
                bridge.push(data);
            },
            onClose: (connId) => {
                const bridge = connections.get(connId);
                if (bridge) {
                    bridge.push(null);
                    bridge.destroy();
                    connections.delete(connId);
                }
            }
        });

        // Atualiza a porta principal do config com os dados do fallback (caso as portas padrão estivessem ocupadas)
        if (result) {
            if (isSSL && result.httpsPort) {
                publicPort = parseInt(result.httpsPort.replace(':', ''));
            } else if (!isSSL && result.httpPort) {
                publicPort = parseInt(result.httpPort.replace(':', ''));
            }

            nytlexConfig.port = publicPort;

            // Atualiza portas secundárias se necessário
            if (isSSL && result.httpPort && nytlexConfig.ssl) {
                nytlexConfig.ssl.redirectPort = parseInt(result.httpPort.replace(':', ''));
            }
            if (result.http3Port && nytlexConfig.ssl) {
                nytlexConfig.ssl.http3Port = parseInt(result.http3Port.replace(':', ''));
            }
        }

        // Atualiza UI (enviando a configuração atualizada com as portas reais)
        sendBox({ ...options }, nytlexConfig);

        const httpLabel = nytlexConfig.ssl?.http3Port ? `HTTP/3 (${nytlexConfig.ssl?.http3Port || ''})` : "HTTP/2";
        const modeLabel = isSSL ? httpLabel : "HTTP (Shield active)";

        msg.end("end_clear");

        Console.success(
            `${Colors.Bright}Ready on port ${Colors.BgGreen} ${publicPort} (${modeLabel}) ${Colors.Reset}\n` +
            `${Colors.Dim} ↳ Engine running on Native Server in ${Date.now() - time}ms${Colors.Reset}\n`
        );

        setInterval(() => {}, 2147483647);

    } catch (e: any) {
        Console.error(`${Colors.FgRed}[Critical] Failed to start Native Server:`, e);
        console.log(`${Colors.FgGray}Shutting down gracefully...${Colors.Reset}`);
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    }

    nytlexApp.setupWebSocket(server);
    nytlexApp.executeInstrumentation();

    return server;
}