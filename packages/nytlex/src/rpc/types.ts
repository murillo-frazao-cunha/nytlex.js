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

export const RPC_ENDPOINT = '/api/rpc' as const;

export type RpcArgs = unknown[];

export interface RpcRequestPayload {
    file: string;
    fn: string;
    args: RpcArgs;

    request?: {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        cookies?: Record<string, string>;
    };
}

export type RpcSuccessResponse = {
    success: true;
    return: unknown;
};

export type RpcErrorResponse = {
    success: false;
    error: string;
};

export type RpcResponsePayload = RpcSuccessResponse | RpcErrorResponse;
