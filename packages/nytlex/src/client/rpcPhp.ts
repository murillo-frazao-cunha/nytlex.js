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
import { RPC_ENDPOINT, RpcRequestPayload, RpcResponsePayload } from '../rpc/types';

// Detecta se estamos rodando no Node.js (caso seu front use SSR, tipo Next.js/Nuxt)
const isServer = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

function getRpcEndpoint(): string {
    if (isServer) {
        const port = process.env.PORT || 8000; // Porta do seu servidor PHP (Slim)
        return `http://127.0.0.1:${port}/api/prpc`;
    }
    // No browser
    return '/api/prpc';
}

function asErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
        return String(err);
    } catch {
        return 'Unknown error';
    }
}

/**
 * Mágica do TypeScript:
 * Pega a interface que você criar e garante que toda função retorne uma Promise.
 * Se a função PHP já retornar Promise (no TS), ele mantém. Se não, ele embrulha em Promise.
 */
export type PhpRpcClient<TApi> = {
    [K in keyof TApi]: TApi[K] extends (...args: infer A) => infer R
        ? (...args: A) => Promise<Awaited<R>>
        : never;
};

/**
 * Conecta com uma classe do PHP via RPC.
 * @param phpClassName O nome da classe ou caminho (ex: "TestActions" ou "Admin/Users")
 */
export function importPhpServer<TApi>(phpClassName: string): PhpRpcClient<TApi> {
    if (!phpClassName) {
        throw new Error('importPhpServer requer o nome da classe PHP');
    }

    const handler: ProxyHandler<any> = {
        get(_target, prop) {
            if (prop === 'then') return undefined; // Evita bugs de await no Proxy

            const fnName = String(prop);

            return async (...args: any[]) => {
                const payload: RpcRequestPayload = {
                    file: phpClassName,
                    fn: fnName,
                    args,
                };

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
                let text: string
                try {
                    text = await res.text()
                    data = JSON.parse(text);
                } catch {
                    // @ts-ignore
                    console.error('Invalid JSON response from RPC PHP', { cause: text });
                    return null
                }

                if (!data || typeof data !== 'object' || typeof (data as any).success !== 'boolean') {
                    console.error('Invalid RPC response shape');
                    return null
                }

                if (data.success) {
                    return (data as any).return;
                }

                throw new Error((data as any).error || 'RPC Error');
            };
        }
    };

    return new Proxy({}, handler) as PhpRpcClient<TApi>;
}