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

const fs = require("fs");

/**
 * Plugin customizado para registrar metadados e Fast Refresh em componentes React
 */
const customReactPlugin = () => {
    return {
        name: "nytlex-react-metadata",
        setup(build) {
            build.onLoad({ filter: /\.(jsx|tsx|js|ts)$/ }, async (args) => {
                // Ignora arquivos do node_modules
                if (args.path.includes("node_modules")) return;

                const contents = await fs.promises.readFile(args.path, "utf8");

                // Verifica se o arquivo expõe funções de metadata
                const hasGenerateMetadata = /export\s+(async\s+)?function\s+generateMetadata/.test(contents) || /export\s+const\s+generateMetadata/.test(contents);
                const hasGetMetadata = /export\s+(async\s+)?function\s+getMetadata/.test(contents) || /export\s+const\s+getMetadata/.test(contents);

                if (!hasGenerateMetadata && !hasGetMetadata) return;

                let transformedCode = contents;

                // Anexa a função de metadata diretamente ao export default do componente
                if (hasGenerateMetadata) {
                    transformedCode += `\nif (typeof exports !== 'undefined' && exports.default) { exports.default.generateMetadata = generateMetadata; }`;
                    transformedCode += `\nif (typeof module !== 'undefined' && module.exports && module.exports.default) { module.exports.default.generateMetadata = generateMetadata; }`;
                }
                if (hasGetMetadata) {
                    transformedCode += `\nif (typeof exports !== 'undefined' && exports.default) { exports.default.getMetadata = getMetadata; }`;
                    transformedCode += `\nif (typeof module !== 'undefined' && module.exports && module.exports.default) { module.exports.default.getMetadata = getMetadata; }`;
                }

                return {
                    contents: transformedCode,
                    loader: args.path.endsWith("tsx") ? "tsx" : args.path.endsWith("ts") ? "ts" : "jsx",
                };
            });
        }
    };
};

/**
 * Cria a configuração do Esbuild otimizada para React
 */
async function createReactConfig(entryPoint, outdir, isProduction, { prePlugins = [], postPlugins = [], isWatch = false } = {}) {
    const mode = process.env.NYTLEX_MODE || 'build';

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

        banner: {
            js: `window.__NYTLEX_MODE__ = ${JSON.stringify(mode)};`
        },

        define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.env.PORT': JSON.stringify(process.nytlex?.port || 3000),
            '__VERSION__': '"1.0.0"',
            'process.env.NYTLEX_MODE': JSON.stringify(mode)
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
            customReactPlugin(), // Injeta a captura de metadata no React
            ...postPlugins
        ],

        logLevel: 'warning'
    };
}

module.exports = { createReactConfig };
