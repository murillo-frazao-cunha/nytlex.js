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

/**
 * Cria a configuração do Esbuild otimizada para React
 */
async function createReactConfig(entryPoint, outdir, isProduction, { prePlugins = [], postPlugins = [], isWatch = false } = {}) {
    const mode = process.env.NYTLEX_MODE || 'build'

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

        jsx: 'automatic',

        // INJEÇÃO REAL: Isso cria a variável no objeto window do navegador de verdade
        banner: {
            js: `window.__NYTLEX_MODE__ = ${JSON.stringify(mode)};`
        },

        define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.env.PORT': JSON.stringify(process.nytlex?.port || 3000),
            '__VERSION__': '"1.0.0"',
            'process.env.NYTLEX_MODE': JSON.stringify(mode)
            // Removido o window.__NYTLEX_MODE__ daqui, pois o banner já resolve
        },

        loader: {
            '.js': 'jsx',
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
            ...postPlugins
        ],

        logLevel: 'warning'
    };
}

module.exports = { createReactConfig };