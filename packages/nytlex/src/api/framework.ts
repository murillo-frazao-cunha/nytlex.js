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
import path from "path";
import fs from "fs";

// Variável para armazenar o resultado em memória
export let cachedFramework: 'react' | 'vue' | 'svelte' | null = null;

export default function detectFramework(projectDir = process.cwd()) {
    // Se já tivermos um resultado, retorna ele direto sem ler o disco
    if (cachedFramework) return cachedFramework;

    try {
        const pkgPath = path.join(projectDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            if(deps.svelte) {
                cachedFramework = 'svelte';
                return cachedFramework;
            }


            if (deps.react || deps['react-dom']) {
                cachedFramework = 'react';
                return cachedFramework;
            }
            if (deps.vue || deps['nuxt']) {
                cachedFramework = 'vue';
                return cachedFramework;
            }
        }
    } catch (e) {
        // Ignora erro de leitura
    }

    // Salva o fallback no cache para evitar re-execução em caso de falha
    cachedFramework = 'react';
    return cachedFramework;
}