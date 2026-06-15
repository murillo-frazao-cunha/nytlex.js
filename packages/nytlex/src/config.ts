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
import path from 'path';
import fs from 'fs';
import Console, { Colors } from "./api/console";
import type { NytlexConfig, NytlexConfigFunction } from './types';

export let config: NytlexConfig | undefined;

export function setConfig(newConfig: NytlexConfig) {
    config = newConfig;
}

/**
 * Carrega o arquivo de configuração nytlex.config.ts ou nytlex.config.js do projeto
 * @param projectDir Diretório raiz do projeto
 * @param phase Fase de execução ('development' ou 'production')
 * @returns Configuração mesclada com os valores padrão
 */
export async function loadNytlexConfig(projectDir: string, phase: string): Promise<NytlexConfig> {
    const defaultConfig: NytlexConfig = {
        maxHeadersCount: 100,
        headersTimeout: 60000,
        requestTimeout: 30000,
        serverTimeout: 35000,
        individualRequestTimeout: 30000,
        maxUrlLength: 2048,
        accessLogging: true,
        envFiles: [],
        port: 3000,
        // backendPort removido do padrão lógico, mas mantido na tipagem se necessário para compatibilidade retroativa
    };

    try {
        // Tenta primeiro .ts, depois .js
        const possiblePaths = [
            path.join(projectDir, 'nytlex.config.ts'),
            path.join(projectDir, 'nytlex.config.js'),
        ];

        let configPath: string | null = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                configPath = p;
                break;
            }
        }

        if (!configPath) {
            return defaultConfig;
        }

        // Remove do cache para permitir hot reload da configuração em dev
        delete require.cache[require.resolve(configPath)];

        const configModule = require(configPath);
        const configExport = configModule.default || configModule;

        let userConfig: NytlexConfig;

        if (typeof configExport === 'function') {
            // Suporta tanto função síncrona quanto assíncrona
            userConfig = await (configExport as NytlexConfigFunction)(phase, {defaultConfig});
        } else {
            userConfig = configExport;
        }

        // Mescla a configuração do usuário com a padrão
        const mergedConfig = { ...defaultConfig, ...userConfig };

        return mergedConfig;
    } catch (error) {
        if (error instanceof Error) {
            Console.warn(`${Colors.FgYellow}[Config]${Colors.Reset} Error loading nytlex.config: ${error.message}`);
            Console.warn(`${Colors.FgYellow}[Config]${Colors.Reset} Using default configuration`);
        }
        return defaultConfig;
    }
}