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
import { RpcRequestPayload, RpcResponsePayload } from './types';
import { NytlexRequest } from '../api/http';
import type { GenericRequest } from '../types/framework';
// Importamos a chave para verificar a anotação de segurança
import { RPC_EXPOSED_KEY } from './annotations';

const DEFAULT_ALLOWED_SERVER_DIRS = ['src/backend'] as const;

function normalizeToPosix(p: string): string {
    return p.replace(/\\/g, '/');
}

function isDisallowedPathInput(file: string): boolean {
    if (!file) return true;
    if (file.includes('\u0000')) return true;
    // disallow protocol-like or absolute paths (Windows drive letters included)
    if (/^[a-zA-Z]+:/.test(file)) return true;
    if (file.startsWith('/') || file.startsWith('\\')) return true;
    return false;
}

function validatePayload(payload: any): payload is RpcRequestPayload {
    return (
        payload &&
        typeof payload === 'object' &&
        typeof payload.file === 'string' &&
        typeof payload.fn === 'string' &&
        Array.isArray(payload.args)
    );
}

export interface RpcExecutionContext {
    /** absolute project root (same as options.dir in start()) */
    projectDir: string;
    /** allow override for tests */
    allowedServerDirs?: string[];
    /** real incoming request (so cookies/headers/session work) */
    request?: GenericRequest;
}



function tryResolveWithinAllowedDirs(
    projectDir: string,
    allowedDirs: string[],
    requestedFile: string
): string | null {

    const req = requestedFile
        .replace(/\\/g, '/')
        .replace(/^\.(?:\/|\\)/, '');

    for (const d of allowedDirs) {
        const baseAbs = path.resolve(projectDir, d);

        // 🔥 FIX REAL: Removemos a dependência do caminho fixo "src/web" que quebrava por ter "../" demais.
        // Identificamos o nome da pasta de backend (ex: "backend" em "src/backend")
        const targetFolder = path.basename(d);
        let cleanReq = req;

        // Extraímos dinamicamente tudo que vem DEPOIS de "backend/"
        // Assim um import "../../../backend/Group" vira apenas "Group"
        const match = req.match(new RegExp(`(?:^|\\/)${targetFolder}\\/(.*)$`));
        if (match) {
            cleanReq = match[1];
        } else {
            // Se não tiver "backend/" (ex: chamada de dentro do próprio backend),
            // limpamos os "../" para não sair do diretório de segurança
            cleanReq = req.replace(/^(\.\.\/|\.\/)+/, '');
        }

        // Caminho final resolvido contra "src/backend"
        const candidateAbs = path.resolve(baseAbs, cleanReq);

        const baseWithSep = baseAbs.endsWith(path.sep)
            ? baseAbs
            : baseAbs + path.sep;

        // segurança rigorosa
        if (!candidateAbs.startsWith(baseWithSep) && candidateAbs !== baseAbs)
            continue;

        if (!fs.existsSync(baseAbs)) continue;

        // 🔥 FIX: resolver extensões
        const possibilities = [
            candidateAbs,
            candidateAbs + '.ts',
            candidateAbs + '.js',
            path.join(candidateAbs, 'index.ts'),
            path.join(candidateAbs, 'index.js'),
        ];

        for (const file of possibilities) {
            if (fs.existsSync(file)) {
                return file;
            }
        }
    }

    return null;
}

function toCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}

// Keep this for fallback when ctx.request isn't provided
function buildRpcRequestFromPayload(payload: RpcRequestPayload): NytlexRequest {
    const headers: Record<string, string | string[]> = {};
    const rawHeaders = payload.request?.headers || {};
    for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = v;
    }

    const cookieHeader = (headers['cookie'] as string | undefined) ?? undefined;

    const req: GenericRequest = {
        method: payload.request?.method || 'RPC',
        url: payload.request?.url || 'http://localhost/_rpc',
        headers,
        body: null,
        query: {},
        params: {},
        cookies: payload.request?.cookies || toCookies(cookieHeader),
        raw: null
    };

    return new NytlexRequest(req);
}

export async function executeRpc(ctx: RpcExecutionContext, payload: any): Promise<RpcResponsePayload> {
    try {
        if (!validatePayload(payload)) {
            return { success: false, error: 'Invalid RPC payload' };
        }

        const fileInput = payload.file;
        if (isDisallowedPathInput(fileInput)) {
            return { success: false, error: 'Invalid file path' };
        }

        const allowedDirs = (ctx.allowedServerDirs || [...DEFAULT_ALLOWED_SERVER_DIRS]).map(normalizeToPosix);
        const absFile = tryResolveWithinAllowedDirs(ctx.projectDir, allowedDirs, fileInput);
        if (!absFile) {
            return { success: false, error: 'File not allowed for RPC' };
        }

        if (!absFile.startsWith(path.resolve(ctx.projectDir) + path.sep)) {
            return { success: false, error: 'Invalid file path' };
        }

        // Ensure fresh code in dev
        try {
            const resolved = require.resolve(absFile);
            if (require.cache[resolved]) delete require.cache[resolved];
        } catch {
            // ignore
        }

        let mod: any;
        try {
            mod = require(absFile);
        } catch {
            // try again letting require do extension resolution from absFile without explicit extension
            try {
                mod = require(absFile);
            } catch {
                return { success: false, error: 'RPC file not found' };
            }
        }

        // Support multiple TS/CJS interop shapes:
        // - module.exports.fn
        // - exports.fn
        // - module.exports.default (function)
        // - module.exports.default.fn
        const fnName = payload.fn;
        const fnValue =
            (mod && typeof mod[fnName] === 'function' && mod[fnName]) ||
            (mod?.default && typeof mod.default === 'function' && fnName === 'default' && mod.default) ||
            (mod?.default && typeof mod.default[fnName] === 'function' && mod.default[fnName]) ||
            undefined;

        if (typeof fnValue !== 'function') {
            return { success: false, error: `RPC function not found: ${fnName}` };
        }

        // --- SECURITY CHECK (Expose Annotation or Allowlist) ---
        // 1. Verifica se a função possui o Symbol definido em annotations.ts (Via wrapper Expose())
        const isAnnotated = (fnValue as any)[RPC_EXPOSED_KEY];

        // 2. Verifica se o módulo exporta uma lista explícita chamada 'exposed' ou 'rpcMethods'
        //    Isso permite o uso de "export function" sem wrapper, listando os nomes no final do arquivo.
        const allowList = mod.exposed || mod.rpcMethods;
        const isListed = Array.isArray(allowList) && allowList.includes(fnName);

        if (!isAnnotated && !isListed) {
            return {
                success: false,
                error: `Function '${fnName}' is not exposed via RPC. Mark it with Expose() or add it to an exported 'exposed' array.`
            };
        }
        // ------------------------------------------

        const rpcRequest = ctx.request ? new NytlexRequest(ctx.request) : buildRpcRequestFromPayload(payload);

        // If the function declares a first parameter, we assume it's the injected request.
        // Otherwise, call it only with payload args.

        // it might be 0, so we treat length>=1 as "expects req".
        const expectsReq = fnValue.length >= 1;

        const result = expectsReq
            ? await fnValue(rpcRequest, ...payload.args)
            : await fnValue(...payload.args);

        return { success: true, return: result };
    } catch (err: any) {
        const message = typeof err?.message === 'string' ? err.message : 'Unknown RPC error';
        return { success: false, error: message };
    }
}