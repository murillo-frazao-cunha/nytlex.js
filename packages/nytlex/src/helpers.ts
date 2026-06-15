#!/usr/bin/env node

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

import nytlex, { FrameworkAdapterFactory } from './index.js';
import type { NytlexOptions } from './types';
import Console from "./api/console";
import { CoreGoManager } from './utils/core-go.js';

import { loadNytlexConfig, config, setConfig } from './config';
import { initNativeServer, NytlexApp } from './server/native';

// Registra loaders customizados para importar arquivos não-JS
const { registerLoaders } = require('./loaders');
registerLoaders({ projectDir: process.cwd() });

// Exportações re-mapeadas úteis para compatibilidade
export { config, setConfig };

export function app(options: NytlexOptions = { mode: "normal"}) {
    const framework = options.framework || 'native';
    FrameworkAdapterFactory.setFramework(framework);

    // Tipando a app principal do nytlex
    const nytlexApp: NytlexApp = nytlex(options);

    return {
        ...nytlexApp,

        /**
         * Integra com uma aplicação de qualquer framework (Express, Fastify, etc)
         * O 'serverApp: any' é mantido para flexibilidade, já que pode ser de tipos diferentes.
         */
        integrate: async (serverApp: any) => {
            await nytlexApp.prepare();
            const handler = nytlexApp.getRequestHandler();

            if (framework === 'express') {
                const express = require('express');
                try {
                    const cookieParser = require('cookie-parser');
                    serverApp.use(cookieParser());
                } catch (e) {
                    Console.error("Could not find cookie-parser");
                }
                serverApp.use(express.json());
                serverApp.use(express.urlencoded({ extended: true }));
                serverApp.use(handler);
                nytlexApp.setupWebSocket(serverApp);

            } else if (framework === 'fastify') {
                try {
                    await serverApp.register(require('@fastify/cookie'));
                } catch (e) {
                    Console.error("Could not find @fastify/cookie");
                }
                try {
                    await serverApp.register(require('@fastify/formbody'));
                } catch (e) {
                    Console.error("Could not find @fastify/formbody");
                }
                await serverApp.register(async (fastify: any) => {
                    fastify.all('*', handler);
                });
                nytlexApp.setupWebSocket(serverApp);

            } else {
                // Generic integration (assume Express-like)
                serverApp.use(handler);
                nytlexApp.setupWebSocket(serverApp);
            }

            nytlexApp.executeInstrumentation();
            return serverApp;
        },

        /**
         * Inicia um servidor Nytlex.js fechado (o usuário não tem acesso ao framework)
         */
        init: async () => {
            const projectDir = options.dir || process.cwd();
            const phase = options.dev ? 'development' : 'production';

            // Carrega e atualiza estado de configuração
            const loadedConfig = await loadNytlexConfig(projectDir, phase);
            setConfig(loadedConfig);

            const version = require("../package.json").version;
            const actualHostname = options.hostname || "0.0.0.0";

            if (framework !== 'native') {
                Console.warn(`The "${framework}" framework was selected, but the init() method only works with the "native" framework. Starting native server...`);
            }

            return await initNativeServer(nytlexApp, options, actualHostname, loadedConfig);
        }
    }
}

// Exporta a função 'app' como nomeada e também como padrão
export default app;