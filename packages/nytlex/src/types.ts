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
import type { GenericRequest } from './types/framework';
import {NytlexRequest, NytlexResponse} from "./api/http";
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

// Interface do contexto WebSocket simplificada
export interface WebSocketContext {
    ws: WebSocket;
    req: IncomingMessage;
    nytlexReq: NytlexRequest;
    url: URL;
    params: Record<string, string>;
    query: Record<string, string>;
    send: (data: any) => void;
    close: (code?: number, reason?: string) => void;
    broadcast: (data: any, exclude?: WebSocket[]) => void;
}

// --- Tipos do Frontend (sem alteração) ---
export interface NytlexOptions {
    dev?: boolean;
    hostname?: string;
    dir?: string;
    framework?: 'express' | 'fastify' | 'native';
    envFiles?: string[];
    skipBuild?: boolean;
    mode: 'normal' | 'exported';
}

// --- Tipos de Configuração ---

/**
 * Interface para as configurações avançadas do servidor Nytlex.js.
 * Essas configurações podem ser definidas no arquivo Nytlex.config.js
 */
export interface NytlexConfig {
    port: number
    ssl?: {
        http3Port?: number;
        redirectPort: number;
        key: string;
        cert: string;
        ca?: string;
    };


    /**
     * Limita o número máximo de headers HTTP permitidos por requisição.
     * Padrão: 100
     */
    maxHeadersCount?: number;

    /**
     * Timeout em milissegundos para receber os headers HTTP.
     * Padrão: 60000 (60 segundos)
     */
    headersTimeout?: number;

    /**
     * Timeout em milissegundos para uma requisição completa.
     * Padrão: 30000 (30 segundos)
     */
    requestTimeout?: number;

    /**
     * Timeout geral do servidor em milissegundos.
     * Padrão: 35000 (35 segundos)
     */
    serverTimeout?: number;

    /**
     * Timeout por requisição individual em milissegundos.
     * Padrão: 30000 (30 segundos)
     */
    individualRequestTimeout?: number;

    /**
     * Tamanho máximo permitido para a URL em caracteres.
     * Padrão: 2048
     */
    maxUrlLength?: number;

    /**
     * Habilita o log de acesso HTTP (ex: GET /api/users 200 15ms).
     * Padrão: false
     */
    accessLogging?: boolean;

    /**
     * Configurações de CORS (Cross-Origin Resource Sharing).
     * Define quais origens podem acessar seus recursos.
     */
    cors?: {
        /**
         * Origens permitidas. Pode ser:
         * - Uma string específica: 'https://exemplo.com'
         * - Um array de strings: ['https://exemplo.com', 'https://outro.com']
         * - Um wildcard: '*' (permite todas as origens - não recomendado em produção)
         * - Uma função que retorna boolean: (origin) => origin.endsWith('.exemplo.com')
         */
        origin?: string | string[] | ((origin: string) => boolean);

        /**
         * Métodos HTTP permitidos.
         * Padrão: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
         */
        methods?: string[];

        /**
         * Headers permitidos nas requisições.
         * Padrão: ['Content-Type', 'Authorization']
         */
        allowedHeaders?: string[];

        /**
         * Headers que serão expostos ao cliente.
         * Padrão: []
         */
        exposedHeaders?: string[];

        /**
         * Permite o envio de credenciais (cookies, headers de autenticação).
         * Padrão: false
         */
        credentials?: boolean;

        /**
         * Tempo em segundos que o navegador deve cachear a resposta preflight.
         * Padrão: 86400 (24 horas)
         */
        maxAge?: number;

        /**
         * Habilita ou desabilita completamente o CORS.
         * Padrão: false
         */
        enabled?: boolean;
    };

    /**
     * Configurações de segurança de headers HTTP.
     */
    security?: {
        /**
         * Content-Security-Policy: Define de onde o navegador pode carregar recursos.
         * Exemplo: "default-src 'self'; script-src 'self' 'unsafe-inline'"
         */
        contentSecurityPolicy?: string;

        /**
         * Permissions-Policy: Controla quais recursos e APIs o navegador pode usar.
         * Exemplo: "geolocation=(), microphone=()"
         */
        permissionsPolicy?: string;

        /**
         * Strict-Transport-Security: Força o uso de HTTPS.
         * Padrão (quando SSL ativo): "max-age=31536000; includeSubDomains"
         * Exemplo: "max-age=63072000; includeSubDomains; preload"
         */
        strictTransportSecurity?: string;
    };

    /**
     * Headers HTTP personalizados que serão adicionados a todas as respostas.
     * Exemplo: { 'X-Custom-Header': 'value', 'X-Powered-By': 'Nytlex.js' }
     */
    customHeaders?: Record<string, string>;

    /**
     * Arquivos .env adicionais para carregar. O .env padrão é sempre carregado.
     */
    envFiles?: string[];
}

/**
 * Tipo da função de configuração que pode ser exportada no nytlex.config.js
 */
export type NytlexConfigFunction = (
    phase: string,
    context: { defaultConfig: NytlexConfig }
) => NytlexConfig | Promise<NytlexConfig>;

export interface Metadata {
    // Basic metadata
    title?: string;
    description?: string;
    keywords?: string | string[];
    author?: string;
    favicon?: string;
    faviconDark?: string;


    // Viewport and mobile
    viewport?: string;
    themeColor?: string;

    // SEO
    canonical?: string;
    robots?: string;

    // Open Graph (Facebook, LinkedIn, etc.)
    openGraph?: {
        title?: string;
        description?: string;
        type?: string;
        url?: string;
        image?: string | {
            url: string;
            width?: number;
            height?: number;
            alt?: string;
        };
        siteName?: string;
        locale?: string;
    };

    // Twitter Card
    twitter?: {
        card?: 'summary' | 'summary_large_image' | 'app' | 'player';
        site?: string;
        creator?: string;
        title?: string;
        description?: string;
        image?: string;
        imageAlt?: string;
    };

    // Additional metadata
    language?: string;
    charset?: string;
    appleTouchIcon?: string;
    manifest?: string;

    // Custom meta tags
    other?: Record<string, string>;
    scripts?: Record<string, Record<string, string>>;
}


export interface RouteConfig {
    pattern: string;
    component?: any;
    generateMetadata?: (params: any, req: GenericRequest) => Promise<Metadata> | Metadata;
}
export type RequestHandler = (req: any, res: any) => Promise<void>;

// --- NOVO: Tipos do Backend ---

/**
 * Define o formato de uma função que manipula uma rota da API.
 */
export type BackendHandler = (
    request: NytlexRequest,
    params: { [key: string]: string }
) => Promise<NytlexResponse> | NytlexResponse;



export type NytlexMiddleware = (
    request: NytlexRequest,
    params: { [key: string]: string },
    next: () => Promise<NytlexResponse>
) => Promise<NytlexResponse> | NytlexResponse;


/**
 * Define o formato de uma função que manipula uma rota WebSocket.
 */
export type WebSocketHandler = (
    context: WebSocketContext
) => Promise<void> | void;

/**
 * Define a estrutura de cada rota da API, com suporte para métodos HTTP e WebSocket.
 */
export interface BackendRouteConfig {
    pattern: string;
    GET?: BackendHandler;
    POST?: BackendHandler;
    PUT?: BackendHandler;
    DELETE?: BackendHandler;
    WS?: WebSocketHandler; // Suporte para WebSocket
    middleware?: NytlexMiddleware[]; // Permite adicionar middlewares específicos à rota
}
