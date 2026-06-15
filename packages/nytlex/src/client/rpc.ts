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

import type { RpcRequestPayload, RpcResponsePayload } from '../rpc/types';
import { RPC_ENDPOINT } from '../rpc/types';

// Generic RPC function signature. Allows `fn<TReturn>(...args)` and returns `Promise<TReturn>`.
export type RpcClientFn = <TReturn = unknown>(...args: any[]) => Promise<TReturn>;

type DropFirst<T extends any[]> = T extends [any, ...infer R] ? R : T;


type ClientArgs<Fn> = Fn extends (...args: infer A) => any ? DropFirst<A> : any[];

type ClientReturn<Fn> = Fn extends (...args: any[]) => infer R ? Awaited<R> : unknown;

// Proxy return type: any property access yields an RPC function (plus a debug helper).
export type RpcClient<TApi extends Record<string, any> = Record<string, any>> = {
    /** Debug helper to inspect which file was passed to importServer() */
    __file: string;
} & {
    [K in keyof TApi]: TApi[K] extends (...args: any[]) => any
        ? <TReturn = ClientReturn<TApi[K]>>(...args: ClientArgs<TApi[K]>) => Promise<TReturn>
        : RpcClientFn;
} & {
    // fallback: allow calling unknown names (keeps it ergonomic)
    [key: string]: RpcClientFn;
};

function asErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
        return String(err);
    } catch {
        return 'Unknown error';
    }
}

// Detecta se estamos rodando no Node.js
const isServer = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

function getRpcEndpoint(): string {
    if (isServer) {
        // Tenta pegar a porta das variáveis de ambiente ou usa 3000 como fallback.
        // Nota: Se você usar uma porta customizada no nytlex.config.ts sem setar ENV,
        // precisará garantir que process.env.PORT esteja alinhado.
        const port = process.env.PORT || 3000;

        // Em SSR, sempre usamos HTTP e Loopback IP (127.0.0.1) para garantir
        // que a requisição chegue no próprio servidor localmente sem sair pra rede externa.
        return `http://127.0.0.1:${port}${RPC_ENDPOINT}`;
    }
    // No cliente (browser), URL relativa funciona perfeitamente
    return RPC_ENDPOINT;
}

/**
 * `importServer("src/backend/index.ts")` returns a Proxy where every property is
 * a function that performs a POST to `/api/rpc`.
 *
 * Typing:
 * - Without a generic: `const api = importServer('...')` -> `api.anyFn<MyReturn>()`
 * - With a generic: `importServer<typeof import('../../backend/helper')>('...')`
 * gives argument + default return types, while still allowing overrides.
 *
 * Note: server functions can be defined as `(req, ...args)`; the first arg is injected
 * by the server, so the client signature automatically drops that first parameter.
 *
 * Security note: the server will still validate allowlisted directories.
 * @param {string} file
 */
export function importServer<TApi extends Record<string, any> = Record<string, any>>(file: string): RpcClient<TApi> {
    if (!file) {
        throw new Error('importServer(file) requires a non-empty string');
    }

    const handler: ProxyHandler<any> = {
        get(_target, prop) {
            // allow tooling & debugging
            if (prop === '__file') return file;
            if (prop === 'then') return undefined; // prevent await Proxy issues

            const fnName = String(prop);

            const rpcFn: RpcClientFn = async (...args: any[]) => {
                const payload: RpcRequestPayload = {
                    file,
                    fn: fnName,
                    args,
                    request: {
                        url: typeof window !== 'undefined' ? window.location.href : undefined,
                        method: 'RPC',
                        headers: {
                            // useful for server-side auth/session logic
                            ...(typeof navigator !== 'undefined' ? { 'user-agent': navigator.userAgent } : {}),
                            // forward cookies so server can reconstruct request.cookies if needed
                            ...(typeof document !== 'undefined' ? { cookie: document.cookie } : {})
                        }
                    }
                };

                // Resolve a URL correta (Absoluta no server, Relativa no client)
                const endpoint = getRpcEndpoint();

                let res: Response;
                try {
                    res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });
                } catch (err) {
                    throw new Error(asErrorMessage(err));
                }

                let data: RpcResponsePayload;
                try {
                    data = (await res.json()) as RpcResponsePayload;
                } catch {
                    throw new Error('Invalid JSON response from RPC');
                }

                if (!data || typeof data !== 'object' || typeof (data as any).success !== 'boolean') {
                    throw new Error('Invalid RPC response shape');
                }

                if (data.success) {
                    return (data as any).return;
                }

                throw new Error((data as any).error || 'RPC Error');
            };

            return rpcFn;
        }
    };

    return new Proxy({}, handler) as RpcClient<TApi>;
}