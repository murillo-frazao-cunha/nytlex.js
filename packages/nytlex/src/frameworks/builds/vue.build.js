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
const Console = require("../../api/console").default;

/**
 * Cria a configuração do Esbuild otimizada para Vue
 */
async function createVueConfig(entryPoint, outdir, isProduction, { prePlugins = [], postPlugins = [], isWatch = false } = {}) {
    let vuePlugin;
    const mode = process.env.NYTLEX_MODE || 'build'

    // --- CORREÇÃO: Avisando o compilador sobre as tags customizadas ---
    const vueCompilerOptions = {
        isCustomElement: (tag) => tag.startsWith('nytlex-')
    };

    // Suporte ao Vue no Esbuild. Necessário esbuild-plugin-vue3
    try {
        const vue = require('unplugin-vue/esbuild');
        vuePlugin = vue({
            template: {
                compilerOptions: vueCompilerOptions
            }
        });
    } catch (e) {
        try {
            const vue3 = require('esbuild-plugin-vue3');
            vuePlugin = vue3({
                compilerOptions: vueCompilerOptions
            });
        } catch (err) {
            Console.warn("Para buildar Vue nativamente com alta velocidade instale o plugin do esbuild:\n  npm install -D esbuild-plugin-vue3\n");
        }
    }

    return {
        entryPoints: [entryPoint],
        bundle: true,
        outdir: outdir,
        format: 'esm',
        platform: 'browser',
        target: 'esnext',

        splitting: true,
        chunkNames: 'chunks/[name]-[hash]',
        assetNames: 'assets/[name]-[hash]',

        minify: isProduction,
        sourcemap: !isProduction && !isWatch,
        // INJEÇÃO REAL: Isso cria a variável no objeto window do navegador de verdade
        banner: {
            js: `window.__NYTLEX_MODE__ = ${JSON.stringify(mode)};`
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.env.PORT': JSON.stringify(process.nytlex?.port || 3000),
            '__VUE_OPTIONS_API__': 'true',
            '__VUE_PROD_DEVTOOLS__': JSON.stringify(!isProduction),
            '__VERSION__': '"1.0.0"',
            'process.env.NYTLEX_MODE': JSON.stringify(mode),
            "window.__NYTLEX_MODE__": JSON.stringify(mode)
        },

        loader: {
            '.js': 'jsx',
            '.ts': 'ts',
            '.png': 'file',
            '.jpg': 'file',
            '.jpeg': 'file',
            '.gif': 'file',
            '.webp': 'file',
            '.woff': 'file',
            '.woff2': 'file',
            '.ttf': 'file'
        },

        plugins: [
            ...prePlugins,
            ...(vuePlugin ? [vuePlugin] : []),
            ...postPlugins
        ],

        logLevel: 'warning'
    };
}

module.exports = { createVueConfig };