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
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const ts = require("typescript");
const sfc = require("@vue/compiler-sfc");

// =========================================================================
// 1. PLUGIN DO VUE CUSTOMIZADO (UNIFICADO E PORTADO PARA COMMONJS)
// =========================================================================

function getUrlParams(search) {
    let hashes = search.slice(search.indexOf('?') + 1).split('&');
    return hashes.reduce((params, hash) => {
        let [key, val] = hash.split('=');
        return Object.assign(params, { [key]: decodeURIComponent(val) });
    }, {});
}

async function fileExists(filePath) {
    try {
        const stat = await fs.promises.stat(filePath);
        return stat.isFile();
    } catch (err) {
        return false;
    }
}

function getFullPath(args) {
    return path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path);
}

async function tryAsync(fn, moduleName, requiredFor) {
    try {
        return await fn();
    } catch (err) {
        throw new Error(`Package "${moduleName}" is required for ${requiredFor}. Please run "npm i -D ${moduleName}" and try again.`);
    }
}

class AsyncCache {
    constructor(enabled = true) {
        this.enabled = enabled;
        this.store = new Map();
    }
    get(key, fn) {
        if (!this.enabled) {
            return fn();
        }
        let val = this.store.get(key);
        if (!val) {
            return fn().then(o => (this.store.set(key, o), o));
        }
        return val;
    }
}

function createRandomGenerator(seed = crypto.randomBytes(32)) {
    let currentSeed = seed;
    const next = (s) => crypto.createHash('sha256').update(s).digest();

    return function randomBytes(n) {
        const result = Buffer.allocUnsafe(n);
        let used = 0;
        while (used < result.length) {
            currentSeed = next(currentSeed);
            currentSeed.copy(result, used);
            used += currentSeed.length;
        }
        return result;
    };
}

const rules = [];
function replaceWildcard(str, repl) {
    return str.replace(/\*/g, repl);
}

async function loadRules(opts, tsconfigPath) {
    if (opts.pathAliases === false) {
        return false;
    }

    if (opts.pathAliases) {
        for (const p in opts.pathAliases) {
            const from = "^" + replaceWildcard(p, "(.*)") + "$";
            const to = replaceWildcard(opts.pathAliases[p], "$1");
            rules.push({ regex: new RegExp(from), replacement: to });
        }
    } else {
        if (await fileExists(tsconfigPath)) {
            const { config: tsconfig, error } = ts.parseConfigFileTextToJson(tsconfigPath, (await fs.promises.readFile(tsconfigPath)).toString());
            if (error) {
                throw new Error(`Failed to parse tsconfig.json: ${JSON.stringify(error)}`);
            }
            if (tsconfig?.compilerOptions?.paths) {
                for (const p in tsconfig.compilerOptions.paths) {
                    const dests = tsconfig.compilerOptions.paths[p];
                    if (dests.length === 0) continue;
                    const from = "^" + replaceWildcard(p, "(.*)") + "$";
                    const to = replaceWildcard(dests[0], "$1");
                    rules.push({ regex: new RegExp(from), replacement: to });
                }
            }
        }
    }
    return rules.length > 0;
}

function replaceRules(filePath) {
    for (const rule of rules) {
        filePath = filePath.replace(rule.regex, rule.replacement);
    }
    return filePath;
}

const customVuePlugin = (opts = {}) => {
    return {
        name: "vue-custom",
        async setup({ initialOptions: buildOpts, ...build }) {
            buildOpts.define = {
                ...buildOpts.define,
                "__VUE_OPTIONS_API__": opts.disableOptionsApi ? "false" : "true",
                "__VUE_PROD_DEVTOOLS__": opts.enableDevTools ? "true" : "false",
                "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": opts.enableHydrationMismatchDetails ? "true" : "false",
            };

            const mustReplace = await loadRules(opts, buildOpts.tsconfig ?? "tsconfig.json");
            const random = createRandomGenerator(typeof opts.scopeId === "object" && typeof opts.scopeId.random === "string" ? opts.scopeId.random : undefined);
            const cache = new AsyncCache(!opts.disableCache);
            const projectRoot = process.env.npm_config_local_prefix || process.cwd();

            const transforms = {};
            if (opts.directiveTransforms) {
                for (const name in opts.directiveTransforms) {
                    if (Object.prototype.hasOwnProperty.call(opts.directiveTransforms, name)) {
                        const propName = opts.directiveTransforms[name];
                        const transformation = (dir, name) => ({
                            key: core.createSimpleExpression(JSON.stringify(name), false),
                            value: dir.exp ?? core.createSimpleExpression("void 0", false),
                            loc: dir.loc,
                            type: 16
                        });

                        if (typeof propName === "function") {
                            transforms[name] = (...args) => {
                                const ret = propName(args[0], args[1], args[2]);
                                return { props: ret === undefined ? [] : [transformation(args[0], ret)] };
                            };
                        } else {
                            transforms[name] = dir => ({ props: propName === false ? [] : [transformation(dir, propName)] });
                        }
                    }
                }
            }

            if (mustReplace) {
                build.onResolve({ filter: /.*/ }, async args => {
                    const aliased = replaceRules(args.path);
                    const fullPath = path.isAbsolute(aliased) ? aliased : path.join(process.cwd(), aliased);

                    if (!await fileExists(fullPath)) {
                        const possible = [".ts", "/index.ts", ".js", "/index.js"];
                        for (const postfix of possible) {
                            if (await fileExists(fullPath + postfix)) {
                                return { path: path.normalize(fullPath + postfix), namespace: "file" };
                            }
                        }
                    } else {
                        return { path: path.normalize(fullPath), namespace: "file" };
                    }
                });
            }

            build.onResolve({ filter: /\.vue/ }, async (args) => {
                const params = getUrlParams(args.path);
                return {
                    path: getFullPath(args),
                    namespace:
                        params.type === "script" ? "sfc-script" :
                            params.type === "template" ? "sfc-template" :
                                params.type === "style" ? "sfc-style" : "file",
                    pluginData: { ...args.pluginData, index: params.index }
                };
            });

            build.onLoad({ filter: /\.vue$/ }, (args) => cache.get([args.path, args.namespace], async () => {
                const encPath = args.path.replace(/\\/g, "\\\\");
                const source = await fs.promises.readFile(args.path, 'utf8');
                const filename = path.relative(process.cwd(), args.path);
                // Corrige o bug de duplicação do caminho ao forçar o caminho raiz a partir do root
                const sourceMapPath = "/" + filename.replace(/\\/g, '/');

                const id = !opts.scopeId || opts.scopeId === "hash"
                    ? crypto.createHash("md5").update(filename).digest().toString("hex").substring(0, 8)
                    : random(4).toString("hex");

                const { descriptor } = sfc.parse(source, { filename });

                // CORREÇÃO APLICADA: Passando templateOptions para o compileScript ter ciência dos elementos customizados
                const script = (descriptor.script || descriptor.scriptSetup) ? sfc.compileScript(descriptor, {
                    id,
                    fs: ts.sys,
                    sourceMap: !!buildOpts.sourcemap,
                    templateOptions: {
                        compilerOptions: opts.compilerOptions
                    }
                }) : undefined;

                const dataId = "data-v-" + id;

                let code = "";

                if (descriptor.script || descriptor.scriptSetup) {
                    const src = (descriptor.script && !descriptor.scriptSetup && descriptor.script.src) || encPath;
                    // Suporte aos exports nomeados coexistindo com o default
                    code += `export * from "${src}?type=script";\n`;
                    code += `import script from "${src}?type=script";\n`;
                } else {
                    code += "const script = {};\n";
                }

                for (const style in descriptor.styles) {
                    code += `import "${encPath}?type=style&index=${style}";\n`;
                }

                const renderFuncName = opts.renderSSR ? "ssrRender" : "render";
                if (descriptor.template) {
                    code += `import { ${renderFuncName} } from "${encPath}?type=template";\nscript.${renderFuncName} = ${renderFuncName};\n`;
                }

                code += `script.__file = ${JSON.stringify(filename)};\n`;
                if (descriptor.styles.some(o => o.scoped)) {
                    code += `script.__scopeId = ${JSON.stringify(dataId)};\n`;
                }
                if (opts.renderSSR) {
                    code += "script.__ssrInlineRender = true;\n";
                }

                code += "export default script;";

                // INJEÇÃO DO SOURCE MAP PARA O "CÓDIGO COLA"
                if (buildOpts.sourcemap) {
                    const lines = code.split('\n').length;
                    const map = {
                        version: 3,
                        sources: [sourceMapPath], // Usa o sourceMapPath com a / no começo
                        sourcesContent: [source],
                        // Mapeia todas as linhas geradas para o topo do arquivo original
                        mappings: Array(lines).fill('AAAA').join(';'),
                    };
                    const mapBase64 = Buffer.from(JSON.stringify(map)).toString("base64");
                    code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${mapBase64}`;
                }

                return {
                    contents: code,
                    resolveDir: path.dirname(args.path),
                    pluginData: { descriptor, id: dataId, script, source, sourceMapPath },
                    watchFiles: [ args.path ]
                };
            }));

            build.onLoad({ filter: /.*/, namespace: "sfc-script" }, (args) => cache.get([args.path, args.namespace], async () => {
                const { script, source, sourceMapPath } = args.pluginData;
                if (script) {
                    let code = script.content;
                    if (buildOpts.sourcemap && script.map) {
                        script.map.sources = [sourceMapPath]; // Usa o sourceMapPath absoluto
                        script.map.sourcesContent = [source];
                        const sourceMap = Buffer.from(JSON.stringify(script.map)).toString("base64");
                        code += "\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," + sourceMap;
                    }
                    return {
                        contents: code,
                        loader: script.lang === "ts" ? "ts" : "js",
                        resolveDir: path.dirname(args.path),
                    };
                }
            }));

            build.onLoad({ filter: /.*/, namespace: "sfc-template" }, (args) => cache.get([args.path, args.namespace], async () => {
                const { descriptor, id, script, source: rawSource, sourceMapPath } = args.pluginData;
                if (!descriptor.template) {
                    return { loader: "js", contents: "" };
                }

                let source = descriptor.template.content;
                if (descriptor.template.lang === "pug") {
                    const pug = await tryAsync(() => import("pug"), "pug", "Pug template rendering");
                    source = pug.render(descriptor.template.content);
                    source = source.replace(/(\B#.*?|\bv-.*?)="\1"/g, "$1");
                }

                const result = sfc.compileTemplate({
                    id,
                    source,
                    filename: args.path,
                    scoped: descriptor.styles.some(o => o.scoped),
                    slotted: descriptor.slotted,
                    ssr: opts.renderSSR,
                    ssrCssVars: [],
                    isProd: (process.env.NODE_ENV === "production") || buildOpts.minify,
                    sourceMap: !!buildOpts.sourcemap,
                    compilerOptions: {
                        inSSR: opts.renderSSR,
                        directiveTransforms: transforms,
                        bindingMetadata: script?.bindings,
                        ...opts.compilerOptions
                    }
                });

                if (result.errors.length > 0) {
                    return {
                        errors: result.errors.map(o => typeof o === "string" ? { text: o } : {
                            text: o.message,
                            location: o.loc && {
                                column: o.loc.start.column,
                                file: descriptor.filename,
                                line: o.loc.start.line + descriptor.template.loc.start.line + 1,
                                lineText: o.loc.source
                            }
                        })
                    };
                }

                let code = result.code;
                if (buildOpts.sourcemap && result.map) {
                    result.map.sources = [sourceMapPath]; // Usa o sourceMapPath absoluto
                    result.map.sourcesContent = [rawSource];
                    const sourceMap = Buffer.from(JSON.stringify(result.map)).toString("base64");
                    code += "\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," + sourceMap;
                }

                return {
                    contents: code,
                    warnings: result.tips.map(o => ({ text: o })),
                    loader: "ts",
                    resolveDir: path.dirname(args.path),
                };
            }));

            build.onLoad({ filter: /.*/, namespace: "sfc-style" }, (args) => cache.get([args.path, args.namespace], async () => {
                const { descriptor, index, id } = args.pluginData;
                const style = descriptor.styles[index];
                let includedFiles = [];

                const result = await sfc.compileStyleAsync({
                    filename: args.path,
                    id,
                    source: style.content,
                    postcssOptions: opts.postcss?.options,
                    postcssPlugins: opts.postcss?.plugins,
                    preprocessLang: style.lang,
                    preprocessOptions: Object.assign({
                        loadPaths: [
                            path.dirname(args.path),
                            path.resolve(projectRoot, "node_modules"),
                        ],
                    }, opts.preprocessorOptions),
                    scoped: style.scoped,
                });

                if (result.errors.length > 0) {
                    const errors = result.errors;
                    return {
                        errors: errors.map(o => ({
                            text: o.message,
                            location: {
                                column: o.column,
                                line: o.file === args.path ? style.loc.start.line + o.line - 1 : o.line,
                                file: o.file?.replace(/\?.*?$/, "") ?? "<unknown>",
                                namespace: "file"
                            }
                        }))
                    };
                }

                if (opts.cssInline) {
                    const cssText = result.code;
                    const contents = `{
                        const el = document.createElement("style");
                        el.textContent = ${JSON.stringify(cssText)};
                        document.head.append(el);
                    }`;
                    return {
                        contents,
                        loader: "js",
                        resolveDir: path.dirname(args.path),
                        watchFiles: includedFiles
                    };
                }

                return {
                    contents: result.code,
                    loader: "css",
                    resolveDir: path.dirname(args.path),
                    watchFiles: includedFiles
                };
            }));
        }
    };
};

// =========================================================================
// 2. CONFIGURAÇÃO DO ESBUILD DO NYTLEX
// =========================================================================

/**
 * Cria a configuração do Esbuild otimizada para Vue
 */
async function createVueConfig(entryPoint, outdir, isProduction, { prePlugins = [], postPlugins = [], isWatch = false } = {}) {
    const mode = process.env.NYTLEX_MODE || 'build';

    // CORREÇÃO APLICADA: isCustomElement agnóstico a Case Sensitivity (usa toLowerCase)
    const vueCompilerOptions = {
        isCustomElement: (tag) => tag.toLowerCase().includes('nytlex-')
    };

    // Usando o nosso próprio plugin customizado que corrige os exports nomeados e suporta as tags personalizadas
    const vuePlugin = customVuePlugin({
        compilerOptions: vueCompilerOptions,
        enableDevTools: !isProduction
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

        treeShaking: true,
        drop: isProduction ? ['debugger'] : [],
        pure: [],
        legalComments: isProduction ? 'none' : 'inline',

        minify: isProduction,
        sourcemap: !isProduction && !isWatch,
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
            vuePlugin, // Injeta diretamente o novo plugin corrigido
            ...postPlugins
        ],

        logLevel: 'warning'
    };
}

module.exports = { createVueConfig };