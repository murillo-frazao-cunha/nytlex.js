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
const esbuild = require('esbuild');
const path = require('path');
const Console = require("./api/console").default;
const fs = require('fs');
const { readdir, stat, rm, rename } = require("node:fs/promises");
const { config } = require("./helpers");

// Import Framework specific builders
const { createReactConfig } = require('./frameworks/builds/react.build');
const { createVueConfig } = require('./frameworks/builds/vue.build');
const { createSvelteConfig } = require('./frameworks/builds/svelte.build'); // Adicionado suporte ao Svelte
const routerModule = require("./router");

const excludedFiles = ['nytlex.sock'];

// --- Custom Plugin: Require Context (Adapted for Esbuild) ---
const requireContextPlugin = () => ({
    name: 'require-context',
    setup(build) {
        build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
            if (args.path.includes('node_modules')) return;

            let code = await fs.promises.readFile(args.path, 'utf8');
            if (!code.includes('require.context') && !code.includes('requireDynamic')) return null;

            const requireContextRegex = /(require\.context|requireDynamic)\s*\(\s*(['"])(.*?)\2\s*(?:,\s*(true|false)\s*)?(?:,\s*(\/(?:\\.|[^/])+\/[a-z]*|[^)]+)\s*)?\)/g;
            let hasContext = false;
            let importStatements = [];
            let contextId = 0;

            const replacedCode = code.replace(requireContextRegex, (fullMatch, callee, quote, dirPattern, useSubdirStr, regExpStr) => {
                hasContext = true;
                const useSubdirectories = useSubdirStr !== 'false';
                let regExp = /.*/;

                if (regExpStr) {
                    try {
                        const trimmedRegex = regExpStr.trim();
                        if (trimmedRegex.startsWith('/') && trimmedRegex.lastIndexOf('/') > 0) {
                            const lastSlash = trimmedRegex.lastIndexOf('/');
                            const pattern = trimmedRegex.substring(1, lastSlash);
                            const flags = trimmedRegex.substring(lastSlash + 1);
                            regExp = new RegExp(pattern, flags);
                        } else {
                            regExp = new RegExp(trimmedRegex);
                        }
                    } catch (e) {
                        Console.warn("Failed to parse regex in require.context:", regExpStr);
                    }
                }

                const baseDir = path.resolve(path.dirname(args.path), dirPattern);

                function walkSync(dir, filelist = []) {
                    let files;
                    try { files = fs.readdirSync(dir); } catch (e) { return filelist; }
                    files.forEach(function (file) {
                        // OTIMIZAÇÃO DE MEMÓRIA: Evitar varredura em diretórios pesados e desnecessários
                        if (file === 'node_modules' || file === '.git' || file === '.nytlex') return;

                        const filepath = path.join(dir, file);
                        const stat = fs.statSync(filepath);
                        if (stat.isDirectory()) {
                            if (useSubdirectories) filelist = walkSync(filepath, filelist);
                        } else {
                            filelist.push(filepath);
                        }
                    });
                    return filelist;
                }

                const files = walkSync(baseDir);
                const map = {};

                files.forEach(file => {
                    let relPath = './' + path.relative(baseDir, file).replace(/\\/g, '/');
                    if (regExp.test(relPath)) {
                        const importId = `__req_ctx_${contextId}_${Object.keys(map).length}`;
                        let importPath = path.relative(path.dirname(args.path), file).replace(/\\/g, '/');
                        if (!importPath.startsWith('.')) importPath = './' + importPath;
                        importStatements.push(`import * as ${importId} from '${importPath}'`);
                        map[relPath] = importId;
                    }
                });

                contextId++;
                let mapEntries = Object.keys(map).map(k => `'${k}': ${map[k]}`).join(', ');
                return `(function() { var map = { ${mapEntries} }; var req = function(key) { return map[key]; }; req.keys = function() { return Object.keys(map); }; req.resolve = function(key) { return key; }; return req; })()`;
            });

            if (hasContext) {
                const finalCode = replacedCode + '\n;' + importStatements.join(';') + ';';
                let loader = 'js';
                if (args.path.endsWith('.tsx')) loader = 'tsx';
                else if (args.path.endsWith('.jsx')) loader = 'jsx';
                else if (args.path.endsWith('.ts')) loader = 'ts';
                return { contents: finalCode, loader };
            }
        });
    }
});


// --- Virtual Entry Plugin (Adapted for Esbuild) ---
const virtualEntryPlugin = (options) => ({
    name: 'nytlex-virtual-entry',
    setup(build) {
        const virtualEntryId = 'virtual:nytlex-entry';
        const projectDir = options.projectDir || process.cwd();

        build.onResolve({ filter: /^virtual:nytlex-entry$/ }, () => {
            return { path: virtualEntryId, namespace: 'nytlex-virtual' };
        });

        // Touch sentinel to trigger custom framework reloads if needed
        build.onStart(() => {
            const nytlexDir = path.join(projectDir, '.nytlex');
            try { fs.mkdirSync(nytlexDir, { recursive: true }); } catch (e) { }
            const sentinelFile = path.join(nytlexDir, '.entry-sentinel');
            try { fs.writeFileSync(sentinelFile, Date.now().toString()); } catch (e) { }
        });

        build.onLoad({ filter: /.*/, namespace: 'nytlex-virtual' }, async () => {
            const routes = options.routes || [];
            const layout = options.layout;
            const notFound = options.notFound;
            const framework = options.framework;

            const formatPath = (p) => {
                const normalized = p.replace(/\\/g, '/');
                if (!normalized.startsWith('./') && !normalized.startsWith('../') && !path.isAbsolute(normalized)) {
                    return './' + normalized;
                }
                return normalized;
            };

            // MUDANÇA 1: Importamos usando * as Module para não perder os exports nomeados (metadata/generateMetadata)
            const layoutImport = layout ? `import * as LayoutModule from '${formatPath(layout.componentPath)}';` : '';
            const notFoundImport = notFound ? `import * as NotFoundModule from '${formatPath(notFound.componentPath)}';` : '';
            const defaultNotFoundPath = path.join(__dirname, 'frameworks', 'themes', 'DefaultNotFound.js').replace(/\\/g, '/');

            const reactImport = framework === 'react' ? `import React, { useState, useEffect } from 'react';` : '';
            const vueImport = framework === 'vue' ? `import { defineAsyncComponent } from 'vue';` : '';

            // Adaptamos o lazy para pegar apenas o default e prevenir erros de renderização
            const wrapperFunction = framework === 'react' ? `
const __nytlexLazy = (importFunc) => {
    return (props) => {
        const [Comp, setComp] = useState(null);
        useEffect(() => {
            importFunc().then(m => {
                setComp(() => m.default || Object.values(m)[0] || m);
            }).catch(err => console.error('[Vatts.js] Error loading chunk:', err));
        }, []);
        return Comp ? React.createElement(Comp, props) : null;
    };
};` : framework === 'vue' ? `
const __nytlexLazy = (importFunc) => defineAsyncComponent(() => importFunc().then(m => m.default || m));
` : `
const __nytlexLazy = (importFunc) => importFunc;
`;

            // MUDANÇA 2: Agora o mapa guarda um objeto com a 'component' pro framework e o 'loader' pra puxar dados extras
            let componentRegistration = routes
                .map((route) => {
                    const pathStr = formatPath(route.componentPath);
                    return `  '${pathStr}': {
    component: __nytlexLazy(() => import('${pathStr}')),
    loader: () => import('${pathStr}')
  },`;
                })
                .join('\n');

            // MUDANÇA 3: O Layout guarda o módulo inteiro
            const layoutRegistration = layout ? `window.__NYTLEX_LAYOUT__ = { component: LayoutModule.default || LayoutModule, module: LayoutModule };` : `window.__NYTLEX_LAYOUT__ = null;`;
            const notFoundRegistration = notFound ? `window.__NYTLEX_NOT_FOUND__ = NotFoundModule.default || NotFoundModule;` : `window.__NYTLEX_NOT_FOUND__ = null;`;

            const clientRoutes = routes.map(r => ({
                pattern: r.pattern,
                componentPath: formatPath(r.componentPath),
                metadata: r.metadata || {}
            }));

            const entryClientPath = path.join(__dirname, 'frameworks', framework, 'entry.client.js').replace(/\\/g, '/');

            const code = `
${reactImport}
${vueImport}
${wrapperFunction}

${layoutImport}
${notFoundImport}
import DefaultNotFound from '${defaultNotFoundPath}';

window.__NYTLEX_COMPONENTS__ = {
${componentRegistration}
};

window.__NYTLEX_ROUTES__ = ${JSON.stringify(clientRoutes)};

${layoutRegistration}
${notFoundRegistration}
window.__NYTLEX_DEFAULT_NOT_FOUND__ = DefaultNotFound;

import '${entryClientPath}';
`;

            return { contents: code, loader: 'js', resolveDir: projectDir };
        });
    }
});


// --- Plugins Adicionais: Node Stub e SVGs Especiais ---
const nodeBuiltinStubPlugin = () => ({
    name: 'nytlex-node-builtin-stub',
    setup(build) {
        const builtins = [
            'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'http2', 'net', 'os', 'path', 'punycode', 'querystring', 'readline', 'stream', 'string_decoder', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'module', 'worker_threads', 'perf_hooks', 'timers', 'console', 'sys', 'constants'
        ];
        const filter = new RegExp(`^(node:)?(${builtins.join('|')})$`);

        build.onResolve({ filter }, args => {
            if (args.importer) Console.warn(`\n[Nytlex Debug] O arquivo "${args.importer}" importou o módulo de backend Node: "${args.path}"`);
            return { path: args.path, namespace: 'node-stub' };
        });

        build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
            contents: `
                function noop() {}
                export const resolve = noop; export const join = noop; export const parse = () => ({});
                export const createHash = () => ({ update: () => ({ digest: () => '' }) });
                export class EventEmitter { on(){} emit(){} off(){} once(){} }
                export class Readable extends EventEmitter {} export class Writable extends EventEmitter {}
                export default Object.assign(noop, { resolve, join, parse, createHash, EventEmitter, Readable, Writable });
            `,
            loader: 'js'
        }));
    }
});

const smartSvgPlugin = () => ({
    name: 'smart-svg',
    setup(build) {
        build.onLoad({ filter: /\.svg$/ }, async args => {
            const buffer = await fs.promises.readFile(args.path);
            const base64 = buffer.toString('base64');
            const content = buffer.toString('utf8');
            return {
                contents: `
                    export default "data:image/svg+xml;base64,${base64}";
                    export const svgContent = ${JSON.stringify(content)};
                `,
                loader: 'js'
            };
        });
    }
});

const customPostCssPlugin = () => ({
    name: 'postcss-injector',
    setup(build) {
        let postcss, tailwindcss, autoprefixer, postcssLoadConfig;
        try {
            postcss = require('postcss');
            autoprefixer = require('autoprefixer');
            try { postcssLoadConfig = require('postcss-load-config'); } catch(e) {}
            try {
                tailwindcss = require('@tailwindcss/postcss');
            } catch (e) {
                tailwindcss = require('tailwindcss');
            }
        } catch (e) {
        }

        // OTIMIZAÇÃO DE MEMÓRIA: Carrega as configs UMA ÚNICA VEZ.
        let processor = null;
        let initialized = false;

        const initProcessor = async () => {
            if (initialized || !postcss) return;
            initialized = true;

            try {
                // 1. Tenta carregar o arquivo postcss.config.js se o pacote existir
                if (postcssLoadConfig) {
                    const { plugins } = await postcssLoadConfig();
                    processor = postcss(plugins);
                    return;
                }
            } catch (err) {
                // Se falhar (ex: não tem arquivo de config), cai no fallback abaixo
            }

            // 2. Fallback: Configura e lê o tailwind.config.js manualmente
            if (tailwindcss) {
                const tailwindConfigPath = path.join(process.cwd(), 'tailwind.config.js');
                const hasTailwindConfig = fs.existsSync(tailwindConfigPath);
                const plugins = hasTailwindConfig
                    ? [tailwindcss(tailwindConfigPath), autoprefixer && autoprefixer()].filter(Boolean)
                    : [tailwindcss(), autoprefixer && autoprefixer()].filter(Boolean);
                processor = postcss(plugins);
            }
        };

        build.onLoad({ filter: /\.css$/ }, async args => {
            if (!fs.existsSync(args.path)) return null;

            await initProcessor();

            let cssContent = await fs.promises.readFile(args.path, 'utf8');

            if (processor) {
                try {
                    const result = await processor.process(cssContent, {
                        from: args.path,
                        to: args.path
                    });
                    cssContent = result.css;
                } catch (err) {
                    Console.warn("Erro ao compilar Tailwind/PostCSS:", err.message);
                }
            }

            return { contents: cssContent, loader: 'css' };
        });
    }
});

const markdownPlugin = () => ({
    name: 'markdown-loader',
    setup(build) {
        build.onLoad({ filter: /\.md$/ }, async args => {
            const text = await fs.promises.readFile(args.path, 'utf8');
            return { contents: `export default ${JSON.stringify(text)};`, loader: 'js' };
        });
    }
});

function detectFramework(projectDir = process.cwd()) {
    try {
        const pkgPath = path.join(projectDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.vue || deps['nuxt']) return 'vue';
            if (deps.svelte) return 'svelte'; // Adicionado suporte para detecção do Svelte
        }
    } catch (e) {}
    return 'react';
}

async function getFrameworkConfig(nytlexOptions, outdir, isProduction, isWatch = false) {
    const projectDir = nytlexOptions.projectDir || process.cwd();
    const framework = nytlexOptions.framework || detectFramework(projectDir);

    nytlexOptions.framework = framework;
    nytlexOptions.projectDir = projectDir;

    const prePlugins = [
        nodeBuiltinStubPlugin(),
        requireContextPlugin(),
        virtualEntryPlugin(nytlexOptions)
    ];

    const postPlugins = [
        markdownPlugin(),
        customPostCssPlugin(),
        smartSvgPlugin()
    ];

    const pluginConfig = { prePlugins, postPlugins, isWatch };
    const entryPoint = 'virtual:nytlex-entry';

    let config;
    if (framework === 'vue') {
        config = await createVueConfig(entryPoint, outdir, isProduction, pluginConfig);
    } else if (framework === 'svelte') {
        // Adicionado fallback para o construtor do Svelte
        config = await createSvelteConfig(entryPoint, outdir, isProduction, pluginConfig);
    } else {
        config = await createReactConfig(entryPoint, outdir, isProduction, pluginConfig);
    }

    // --- INÍCIO DA IMPLEMENTAÇÃO DE CHUNKS E OTIMIZAÇÃO MÁXIMA ---
    // MANTENHA APENAS A ENTRADA MAIN.
    // O erro do carregamento em massa acontecia pois todas as rotas eram declaradas
    // como "EntryPoints" manuais, forçando a tag <script> nelas na página.
    // O Esbuild faz code-splitting automático com base nos dynamic imports!
    const entryPoints = { 'main': entryPoint };

    config.entryPoints = entryPoints;
    config.format = 'esm';
    config.splitting = true;
    config.chunkNames = 'chunks/[name]-[hash]';
    config.assetNames = 'assets/[name]-[hash]';
    config.treeShaking = true;
    config.legalComments = 'none';

    config.define = {
        ...(config.define || {}),
        'process.env.NODE_ENV': isProduction ? '"production"' : '"development"'
    };

    if (isProduction) {
        config.minify = true;
        config.minifyWhitespace = true;
        config.minifyIdentifiers = true;
        config.minifySyntax = true;
        config.target = ['es2020'];
    }
    // --- FIM DA IMPLEMENTAÇÃO ---
    config.entryNames = '[name]-[hash]';
    return config;
}

async function buildWithChunks(nytlexOptions, outdir, isProduction = false) {
    await cleanDirectoryExcept(outdir, excludedFiles);

    try {
        const config = await getFrameworkConfig(nytlexOptions, outdir, isProduction, false);

        config.sourcemap = !isProduction;

        await esbuild.build(config);

        if (isProduction) {
            try {
                const { runOptimizer } = require('./api/optimizer');
                const optimizedDir = path.join(outdir, 'optimized');

                runOptimizer({ targetDir: outdir, outputDir: optimizedDir, ignoredPatterns: ['assets', 'chunks', 'pages'] });

                if (fs.existsSync(optimizedDir)) {
                    const optFiles = await readdir(optimizedDir);
                    for (const file of optFiles) {
                        const srcPath = path.join(optimizedDir, file);
                        const destPath = path.join(outdir, file);
                        await rm(destPath, { recursive: true, force: true }).catch(()=>{});
                        await rename(srcPath, destPath);
                    }
                    await rm(optimizedDir, { recursive: true, force: true }).catch(()=>{});
                }
                Console.log("✅ Build successfully optimized with heavy chunking enabled.");
            } catch (err) {
                Console.error('Native optimization failed:', err);
            }
        }
    } catch (error) {
        Console.error('An error occurred while building with Esbuild:', error);
        process.exit(1);
    }
}

async function watchWithChunks(nytlexOptions, outdir, hotReloadManager = null) {
    await cleanDirectoryExcept(outdir, excludedFiles);
    try {
        const config = await getFrameworkConfig(nytlexOptions, outdir, false, true);
        let buildSeq = 0;

        // RESOLVENDO O PROBLEMA DOS SOURCEMAPS
        // 'inline' atrapalha as DevTools do Chrome a mapear chunks dinâmicos corretamente.
        // True gera arquivos .map que o Chrome usa para mostrar os erros no .tsx, .vue e .svelte originais.
        config.sourcemap = true;

        config.plugins.push({
            name: 'watch-notifier',
            setup(build) {
                build.onStart(() => {
                    if (hotReloadManager && typeof hotReloadManager.onBuildStart === 'function') {
                        hotReloadManager.onBuildStart();
                    }
                });
                build.onEnd(result => {
                    if (result.errors.length > 0) {
                        if (hotReloadManager) hotReloadManager.onBuildComplete(false, { message: result.errors[0].text });
                        else Console.error("Build Error:", result.errors[0].text);
                    } else {
                        if (hotReloadManager) hotReloadManager.onBuildComplete(true, { buildId: ++buildSeq });
                    }
                });
            }
        });

        const ctx = await esbuild.context(config);
        await ctx.watch();
        return ctx;
    } catch (error) {
        Console.error('Error starting esbuild watch mode:', error);
        if (hotReloadManager) hotReloadManager.onBuildComplete(false, { message: error.message });
        throw error;
    }
}

async function cleanDirectoryExcept(dirPath, excludeItems) {
    try {
        if (!fs.existsSync(dirPath)) return;
        const excludes = Array.isArray(excludeItems) ? excludeItems : [excludeItems];
        const items = await readdir(dirPath);

        for (const item of items) {
            if (excludes.includes(item)) continue;
            const itemPath = path.join(dirPath, item);
            try {
                const info = await stat(itemPath);
                await rm(itemPath, { recursive: info.isDirectory(), force: true });
            } catch (e) {}
        }
    } catch (e) {
        Console.warn(`Warning cleaning directory: ${e.message}`);
    }
}

module.exports = { buildWithChunks, watchWithChunks };