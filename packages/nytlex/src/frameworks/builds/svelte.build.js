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
const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const { preprocess, compile, VERSION } = require("svelte/compiler");

// =========================================================================
// 1. PLUGIN DO SVELTE CUSTOMIZADO (NATIVO, SEM DEPENDÊNCIAS EXTRAS)
// =========================================================================

const SVELTE_VERSION = parseInt(VERSION.split(".")[0]);
const SVELTE_JAVASCRIPT_MODULE_FILTER = /\.svelte\.js$/;
const SVELTE_TYPESCRIPT_MODULE_FILTER = /\.svelte\.ts$/;
const SVELTE_MODULE_FILTER = new RegExp(`(${SVELTE_JAVASCRIPT_MODULE_FILTER.source})|(${SVELTE_TYPESCRIPT_MODULE_FILTER.source})`);
const SVELTE_FILE_FILTER = /\.svelte$/;
const SVELTE_FILTER = SVELTE_VERSION === 5
    ? new RegExp(`(${SVELTE_FILE_FILTER.source})|${SVELTE_MODULE_FILTER.source}`)
    : SVELTE_FILE_FILTER;
const FAKE_CSS_FILTER = /\.esbuild-svelte-fake-css$/;

const TS_MODULE_DISALLOWED_OPTIONS = [
    "absWorkingDir", "alias", "allowOverwrite", "analyze", "assetNames",
    "banner", "bundle", "chunkNames", "conditions", "entryNames", "entryPoints",
    "external", "footer", "inject", "mainFields", "mangeProps", "mangleQuoted",
    "metafile", "nodePaths", "outbase", "outdir", "outExtension", "outfile",
    "packages", "plugins", "preserveSymlinks", "publicPath", "resolveExtensions",
    "splitting", "stdin", "treeShaking", "tsconfig", "write", "minify", "format",
    "loader", "target"
];

function convertMessage({ message, start, end }, filename, source, sourcemap) {
    let location = {};
    if (start && end) {
        let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1];
        let lineEnd = start.line === end.line ? end.column : lineText.length;

        location = {
            file: filename,
            line: start.line,
            column: start.column,
            length: lineEnd - start.column,
            lineText,
        };
    }
    return { text: message, location };
}

function customSveltePlugin(opts = {}) {
    const svelteFilter = opts.include ?? SVELTE_FILTER;

    return {
        name: "svelte-custom",
        setup(build) {
            // Leitura segura do sourcemap direto do Esbuild
            const isSourcemapEnabled = !!build.initialOptions.sourcemap;

            const transformOptions = opts.esbuildTsTransformOptions ??
                Object.fromEntries(
                    Object.entries(build.initialOptions).filter(
                        ([key]) => !TS_MODULE_DISALLOWED_OPTIONS.includes(key)
                    )
                );

            const cssCode = new Map();
            const fileCache = new Map();

            build.onLoad({ filter: svelteFilter }, async (args) => {
                let cachedFile = null;
                let previousWatchFiles = [];

                if (opts.cache === true && fileCache.has(args.path)) {
                    cachedFile = fileCache.get(args.path) || { dependencies: new Map(), data: null };
                    let cacheValid = true;

                    try {
                        cachedFile.dependencies.forEach((time, depPath) => {
                            if (fs.statSync(depPath).mtime > time) {
                                cacheValid = false;
                            }
                        });
                    } catch {
                        cacheValid = false;
                    }

                    if (cacheValid) return cachedFile.data;
                    fileCache.delete(args.path);
                }

                let originalSource = await promisify(fs.readFile)(args.path, "utf8");
                let filename = path.relative(process.cwd(), args.path);
                let sourceMapPath = "/" + filename.replace(/\\/g, '/'); // Previne caminhos duplicados
                let source = originalSource;

                if (SVELTE_TYPESCRIPT_MODULE_FILTER.test(filename)) {
                    try {
                        const result = await build.esbuild.transform(originalSource, {
                            loader: "ts",
                            ...transformOptions,
                        });
                        source = result.code;
                    } catch (e) {
                        return {
                            errors: [convertMessage(e, args.path, originalSource, opts.compilerOptions?.sourcemap)],
                            watchFiles: previousWatchFiles
                        };
                    }
                }

                const dependencyModificationTimes = new Map();
                dependencyModificationTimes.set(args.path, fs.statSync(args.path).mtime);

                // Revertido para "injected" ou o que foi passado. Quando é "external", a renderização de componentes Svelte pode dar tela branca.
                let compilerOptions = {
                    css: "injected",
                    ...opts.compilerOptions
                };
                let moduleCompilerOptions = { ...opts.moduleCompilerOptions };

                try {
                    if (opts.preprocess && !SVELTE_MODULE_FILTER.test(filename)) {
                        let preprocessResult;
                        try {
                            preprocessResult = await preprocess(source, opts.preprocess, { filename });
                        } catch (e) {
                            if (cachedFile) previousWatchFiles = Array.from(cachedFile.dependencies.keys());
                            throw e;
                        }

                        // Proteção extra: ?.map para evitar crash se o preprocessor não retornar map
                        if (preprocessResult && preprocessResult.map) {
                            let fixedMap = preprocessResult.map;
                            const idx = fixedMap.sources.findIndex((val) => val === filename);
                            if (idx !== -1) {
                                fixedMap.sources[idx] = path.basename(filename);
                            }
                            compilerOptions.sourcemap = fixedMap;
                        }
                        source = preprocessResult.code;

                        if (opts.cache === true && preprocessResult.dependencies) {
                            preprocessResult.dependencies.forEach((entry) => {
                                dependencyModificationTimes.set(entry, fs.statSync(entry).mtime);
                            });
                        }
                    }

                    let { js, css, warnings } = await (async () => {
                        if (SVELTE_VERSION === 5 && SVELTE_MODULE_FILTER.test(filename)) {
                            const { compileModule } = await import("svelte/compiler");
                            return compileModule(source, { ...moduleCompilerOptions, filename });
                        }
                        return compile(source, { ...compilerOptions, filename });
                    })();

                    let contents = js?.code || "";

                    if (isSourcemapEnabled && js?.map) {
                        js.map.sources = [sourceMapPath];
                        js.map.sourcesContent = [originalSource];

                        const mapBase64 = Buffer.from(JSON.stringify(js.map)).toString("base64");
                        contents += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${mapBase64}`;
                    }

                    if (compilerOptions.css === "external" && css?.code) {
                        let cssPath = args.path.replace(".svelte", ".esbuild-svelte-fake-css").replace(/\\/g, "/");
                        let cssMapBase64 = (isSourcemapEnabled && css?.map) ? Buffer.from(JSON.stringify(css.map)).toString("base64") : "";
                        cssCode.set(cssPath, css.code + (cssMapBase64 ? `\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,${cssMapBase64} */` : ""));
                        contents += `\nimport "${cssPath}";`;
                    }

                    // Proteção garantindo que warnings seja sempre um array antes de usar o .map
                    const safeWarnings = Array.isArray(warnings) ? warnings : [];
                    let filteredWarnings = safeWarnings;

                    if (opts.filterWarnings) {
                        filteredWarnings = filteredWarnings.filter(opts.filterWarnings);
                    } else {
                        filteredWarnings = filteredWarnings.filter((w) => !w.code || !w.code.startsWith('a11y-'));
                    }

                    const result = {
                        contents,
                        loader: "js",
                        warnings: filteredWarnings.map((e) => convertMessage(e, args.path, source, compilerOptions.sourcemap)),
                        watchFiles: Array.from(dependencyModificationTimes.keys())
                    };

                    if (opts.cache === true) {
                        fileCache.set(args.path, { data: result, dependencies: dependencyModificationTimes });
                    }

                    return result;
                } catch (e) {
                    return {
                        errors: [convertMessage(e, args.path, originalSource, compilerOptions.sourcemap)],
                        watchFiles: previousWatchFiles
                    };
                }
            });

            build.onResolve({ filter: FAKE_CSS_FILTER }, ({ path }) => ({ path, namespace: "fakecss" }));

            build.onLoad({ filter: FAKE_CSS_FILTER, namespace: "fakecss" }, ({ path: cssPath }) => {
                const css = cssCode.get(cssPath);
                return css ? { contents: css, loader: "css", resolveDir: path.dirname(cssPath) } : null;
            });

            build.onEnd(() => {
                if (opts.cache === undefined) opts.cache = true;
            });
        },
    };
}

// =========================================================================
// 2. CONFIGURAÇÃO DO ESBUILD DO NYTLEX (SVELTE)
// =========================================================================

/**
 * Cria a configuração do Esbuild otimizada para Svelte
 */
async function createSvelteConfig(entryPoint, outdir, isProduction, { prePlugins = [], postPlugins = [], isWatch = false } = {}) {
    const mode = process.env.NYTLEX_MODE || 'build';

    const sveltePlugin = customSveltePlugin({
        compilerOptions: {
            dev: !isProduction,
            // Revertido para injected, external causa bugs visuais e "tela branca" sem o pipeline correto
            css: 'injected',
        }
    });

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

        mainFields: ['svelte', 'browser', 'module', 'main'],

        treeShaking: true,
        drop: isProduction ? ['debugger'] : [],
        pure: [],
        legalComments: isProduction ? 'none' : 'inline',

        minify: isProduction,
        sourcemap: !isProduction && !isWatch ? false : true,

        banner: {
            js: `window.__NYTLEX_MODE__ = ${JSON.stringify(mode)};`
        },

        define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.env.PORT': JSON.stringify(process.nytlex?.port || 3000),
            '__VERSION__': '"1.0.0"',
            'process.env.NYTLEX_MODE': JSON.stringify(mode),
            "window.__NYTLEX_MODE__": JSON.stringify(mode)
        },

        loader: {
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
            sveltePlugin,
            ...postPlugins
        ],

        logLevel: 'warning'
    };
}

module.exports = { createSvelteConfig };