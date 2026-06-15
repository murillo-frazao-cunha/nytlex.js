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
import koffi from 'koffi';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../helpers';
import { coreGoManager } from '../index';

/**
 * Interface para as opções do otimizador.
 */
export interface OptimizerOptions {
    /** Diretório onde estão os arquivos a serem otimizados (ex: .nytlex/exported) */
    targetDir: string;
    /** (Opcional) Diretório de saída. Padrão: 'optimized' dentro do target */
    outputDir?: string;
    /** (Opcional) Lista de arquivos ou pastas a serem ignorados */
    ignoredPatterns?: string[];
    /** (Opcional) Sobrescreve o caminho da biblioteca manualmemte */
    customLibPath?: string;
    ssl?: boolean;
}

// Assinatura da função Go
// Alterado: agora retorna string | null. Se string, é o erro. Se null, sucesso.
type OptimizeFunc = (target: string, output: string, ignored: string, ssl: string) => string | null;

export class NativeOptimizer {
    private static instance: OptimizeFunc | null = null;

    /**
     * Detecta a plataforma e arquitetura para montar o nome do arquivo.
     * Padrão esperado: optimizer-{os}-{arch}.{ext}
     * Ex: optimizer-win-64.dll, optimizer-linux-arm64.so
     */
    public static getLibPath(): string {
        return coreGoManager.getFile();
    }

    /**
     * Carrega a biblioteca nativa usando Koffi.
     */
    private static loadLibrary(customPath?: string): OptimizeFunc {
        if (this.instance) return this.instance;

        const libPath = customPath || this.getLibPath();

        if (!fs.existsSync(libPath)) {
            throw new Error(
                `Biblioteca nativa não encontrada: ${libPath}.\n`
            );
        }

        try {
            const lib = koffi.load(libPath);
            // Mapeia a função Go: func Optimize(...) *C.char
            // Em Koffi, 'str' como retorno significa char* (string C)
            // Se o Go retornar nil, o Koffi converte para null no JS
            
            // CORREÇÃO: Adicionado o quarto 'str' para o argumento SSL
            this.instance = lib.func('Optimize', 'str', ['str', 'str', 'str', 'str']);
            
            return this.instance;
        } catch (error) {
            throw new Error(`Falha ao carregar a biblioteca nativa em ${libPath}: ${error}`);
        }
    }

    /**
     * Executa a otimização.
     */
    public static run(options: OptimizerOptions): void {
        const { targetDir, outputDir = '', ignoredPatterns = [], customLibPath } = options;
        
        let ssl = "false";
        // Verifica se ssl foi passado explicitamente, senão pega da config global
        if (options.ssl !== undefined && options.ssl !== null) {
             ssl = options.ssl ? 'true' : 'false';
        } else {
            // Garante que config existe antes de acessar propriedades profundas
            const isSSL = !!(config?.ssl?.key && config?.ssl?.cert);
            ssl = isSSL ? 'true' : 'false';
        }

        const optimize = this.loadLibrary(customLibPath);

        const absTarget = path.resolve(targetDir);
        const absOutput = outputDir ? path.resolve(outputDir) : '';
        const ignoredStr = ignoredPatterns.join(',');

        // Validação básica
        if (!fs.existsSync(absTarget)) {
            return;
        }

        const errorMsg = optimize(absTarget, absOutput, ignoredStr, ssl);
        if (errorMsg) {
            throw new Error(errorMsg);
        }
    }
}

/**
 * API Pública
 */
export const runOptimizer = (options: OptimizerOptions) => {
    return NativeOptimizer.run(options);
};

// Export padrão também para facilitar imports
export default runOptimizer;