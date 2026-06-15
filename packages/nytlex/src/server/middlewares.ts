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
import { IncomingMessage, ServerResponse } from 'http';
import { URLSearchParams } from 'url';
import Console, { Colors } from "../api/console";
import type { NytlexConfig } from '../types';

/**
 * Aplica headers CORS na resposta baseado na configuração.
 * @param req Requisição HTTP
 * @param res Resposta HTTP
 * @param corsConfig Configuração de CORS
 * @returns true se a requisição foi finalizada (OPTIONS), false caso contrário
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, corsConfig?: NytlexConfig['cors']): boolean {
    if (!corsConfig || !corsConfig.enabled) {
        return false;
    }

    const origin = req.headers.origin || req.headers.referer;

    // Verifica se a origem é permitida
    let allowOrigin = false;
    if (corsConfig.origin === '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        allowOrigin = true;
    } else if (typeof corsConfig.origin === 'string' && origin === corsConfig.origin) {
        res.setHeader('Access-Control-Allow-Origin', corsConfig.origin);
        allowOrigin = true;
    } else if (Array.isArray(corsConfig.origin) && origin && corsConfig.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        allowOrigin = true;
    } else if (typeof corsConfig.origin === 'function' && origin) {
        try {
            if (corsConfig.origin(origin)) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                allowOrigin = true;
            }
        } catch (error) {
            Console.warn(`${Colors.FgYellow}[CORS]${Colors.Reset} Error validating origin: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Se a origem não for permitida e não for wildcard, não aplica outros headers
    if (!allowOrigin && corsConfig.origin !== '*') {
        return false;
    }

    // Credenciais (não pode ser usado com origin: '*')
    if (corsConfig.credentials && corsConfig.origin !== '*') {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Métodos permitidos
    const methods = corsConfig.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
    res.setHeader('Access-Control-Allow-Methods', methods.join(', '));

    // Headers permitidos
    const allowedHeaders = corsConfig.allowedHeaders || ['Content-Type', 'Authorization'];
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));

    // Headers expostos
    if (corsConfig.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
        res.setHeader('Access-Control-Expose-Headers', corsConfig.exposedHeaders.join(', '));
    }

    // Max age para cache de preflight
    const maxAge = corsConfig.maxAge !== undefined ? corsConfig.maxAge : 86400;
    res.setHeader('Access-Control-Max-Age', maxAge.toString());

    // Responde requisições OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.statusCode = 204; // No Content
        res.end();
        return true;
    }

    return false;
}

/**
 * Middleware para parsing do body com proteções de segurança (versão melhorada).
 */
export const parseBody = (req: IncomingMessage): Promise<object | string | null> => {
    // Constantes para limites de segurança
    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limite total
    const MAX_JSON_SIZE = 1 * 1024 * 1024; // 1MB limite para JSON
    const BODY_TIMEOUT = 30000; // 30 segundos

    return new Promise((resolve, reject) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.headers.upgrade) {
            resolve(null);
            return;
        }

        let body = '';
        let totalSize = 0;

        // Timeout para requisições lentas
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error('Request body timeout'));
        }, BODY_TIMEOUT);

        req.on('data', (chunk: Buffer) => {
            totalSize += chunk.length;

            // Proteção contra DoS (Payload Too Large)
            if (totalSize > MAX_BODY_SIZE) {
                clearTimeout(timeout);
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            body += chunk.toString();
        });

        req.on('end', () => {
            clearTimeout(timeout);

            if (!body) {
                resolve(null);
                return;
            }

            try {
                const contentType = req.headers['content-type'] || '';

                if (contentType.includes('application/json')) {
                    if (body.length > MAX_JSON_SIZE) {
                        reject(new Error('JSON body too large'));
                        return;
                    }
                    // Rejeita promise se o JSON for inválido
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error('Invalid JSON body'));
                    }
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    // Usa API moderna URLSearchParams (segura contra prototype pollution)
                    resolve(Object.fromEntries(new URLSearchParams(body)));
                } else {
                    resolve(body); // Fallback para texto plano
                }
            } catch (error) {
                // Pega qualquer outro erro síncrono
                reject(error);
            }
        });

        req.on('error', (error: Error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};