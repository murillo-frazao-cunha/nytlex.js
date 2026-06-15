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

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { default: Console } = require("./api/console");

// Tenta carregar o compilador do Vue e o esbuild
let sfcCompiler;
let esbuild;
let svelteCompiler;

try {
    sfcCompiler = require('vue/compiler-sfc');
} catch (e) {
    // Vue não instalado ou não encontrado
}

try {
    esbuild = require('esbuild');
} catch (e) {
    // Esbuild não instalado
}

try {
    svelteCompiler = require('svelte/compiler');
} catch (e) {
    // Svelte não instalado
}

const {
    loadTsConfigPaths,
    resolveTsConfigAlias,
    resolveWithNodeStyleExtensions
} = require('./tsconfigPaths');

/**
 * Carrega e processa o tsconfig.json para obter os aliases
 */
function loadTsConfigAliases(projectDir = process.cwd()) {
    const info = loadTsConfigPaths(projectDir);

    const aliases = {};
    for (const m of info.mappings || []) {
        // Garante que temos uma base de resolução válida (compatibilidade com versões anteriores e atual do resolver)
        const base = m.baseUrl || m.baseDir || info.projectDir;

        if (m.hasStar && m.keySuffix === '' && m.targetHasStar && m.targetSuffix === '') {
            const cleanAlias = m.keyPrefix.replace(/\/$/, '');
            const cleanTarget = path.resolve(base, m.targetPrefix.replace(/\/$/, ''));
            if (cleanAlias) aliases[cleanAlias] = cleanTarget;
        } else if (!m.hasStar) {
            aliases[m.key] = path.resolve(base, m.target);
        }
    }

    return { aliases, info };
}

/**
 * Registra loaders customizados para Node.js
 */
function registerLoaders(options = {}) {
    const projectDir = options.projectDir || process.cwd();
    const { aliases, info: tsconfigInfo } = loadTsConfigAliases(projectDir);
    // Flag para indicar se estamos gerando um export estático (static export)
    // ou se estamos em modo de server-render (SSR). Pode ser passado via
    // options.isExport ou options.mode === 'export', ou detectado via env.
    const isExport = Boolean(options.isExport || options.mode === 'export' || process.env.NYTLEX_EXPORT === 'true');
    const isServerRender = typeof window === 'undefined';

    // --- Alias Resolution (Path Mapping) ---
    if (Object.keys(aliases).length > 0 || (tsconfigInfo.mappings && tsconfigInfo.mappings.length > 0)) {
        const originalResolveFilename = Module._resolveFilename;

        Module._resolveFilename = function(request, parent, isMain, options) {
            const aliasCandidate = resolveTsConfigAlias(request, tsconfigInfo);
            if (aliasCandidate) {
                const resolved = resolveWithNodeStyleExtensions(aliasCandidate);
                if (resolved) {
                    request = resolved;
                    return originalResolveFilename.call(this, request, parent, isMain, options);
                }
            }

            for (const [alias, aliasPath] of Object.entries(aliases)) {
                if (request === alias || request.startsWith(alias + '/')) {
                    const relativePath = request.slice(alias.length);
                    const resolvedPath = path.join(aliasPath, relativePath);

                    const resolved = resolveWithNodeStyleExtensions(resolvedPath);
                    if (resolved) {
                        request = resolved;
                        break;
                    }
                }
            }
            return originalResolveFilename.call(this, request, parent, isMain, options);
        };
    }

    // --- File Handlers ---

    require.extensions['.md'] = function(module, filename) {
        const content = fs.readFileSync(filename, 'utf8');
        module.exports = content;
    };

    require.extensions['.txt'] = function(module, filename) {
        const content = fs.readFileSync(filename, 'utf8');
        module.exports = content;
    };

    const styleExtensions = ['.css', '.scss', '.sass', '.less'];
    styleExtensions.forEach(ext => {
        require.extensions[ext] = function(module, filename) {
            module.exports = filename;
        };
    });

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.svg'];
    imageExtensions.forEach(ext => {
        require.extensions[ext] = function(module, filename) {
            // Normaliza o comportamento de imports de imagens para que tanto
            // require(...) quanto import default (ESM interop) retornem a URL
            // em string. Isso evita que, em alguns transformadores, chegue
            // um objeto ou função para o template e apareça como
            // <img src="[object Object]">.

            const url = filename;

            // Em SSR / export estático normalmente queremos apenas a string
            // com o caminho; mantemos compatibilidade definindo também
            // propriedades comuns (__esModule, default, src) e um toString.
            module.exports = url;
            try {
                // define propriedades auxiliares de forma segura
                Object.defineProperty(module.exports, 'default', {
                    enumerable: true,
                    configurable: true,
                    value: url
                });
                Object.defineProperty(module.exports, 'src', {
                    enumerable: true,
                    configurable: true,
                    value: url
                });
                Object.defineProperty(module.exports, '__esModule', {
                    value: true
                });
            } catch (e) {
                // Em alguns ambientes module.exports pode ser primitivo; se
                // falhar ao definir propriedades, substituímos por um objeto
                // que também implementa toString para preservar compatibilidade.
                module.exports = {
                    default: url,
                    src: url,
                    toString() { return url; },
                    __esModule: true
                };
            }
            // Garante que chamadas como String(module.exports) retornem a URL
            if (typeof module.exports.toString !== 'function') {
                module.exports.toString = function() { return url; };
            }
        };
    });

    // --- Loader Robusto para .vue (SSR Support) ---
    require.extensions['.vue'] = function(module, filename) {
        if (!sfcCompiler || !esbuild) {
            throw new Error('Para carregar arquivos .vue no servidor, você precisa instalar "vue" e "esbuild".');
        }

        const source = fs.readFileSync(filename, 'utf8');
        // Variável para armazenar o código final para fins de debug
        let finalEsm = '';

        try {
            // 1. Parse do SFC
            const { descriptor, errors } = sfcCompiler.parse(source, {
                filename,
                sourceMap: false
            });

            if (errors.length > 0) {
                console.error(`Erro ao parsear ${filename}:`, errors);
            }

            // 2. Compilação do Script (<script> ou <script setup>)
            // Padrão: Se não houver script, definimos um objeto vazio
            let scriptContent = 'const _sfc_main = {};';
            let bindings = undefined;

            if (descriptor.script || descriptor.scriptSetup) {
                try {
                    const compiledScript = sfcCompiler.compileScript(descriptor, {
                        id: filename,
                        isProd: false,
                        inlineTemplate: false
                    });

                    // Lógica de substituição corrigida para evitar dupla declaração
                    if (compiledScript.content.includes('const _sfc_main =')) {
                        // O compilador do Vue já declarou o _sfc_main (comum no script setup)
                        scriptContent = compiledScript.content;
                    } else if (compiledScript.content.match(/export\s+default/)) {
                        // Substitui export default tradicional
                        scriptContent = compiledScript.content.replace(/export\s+default/, 'const _sfc_main =');
                    } else {
                        // Se não achou export default e o Vue não declarou o _sfc_main, nós criamos um vazio
                        scriptContent = compiledScript.content + '\nconst _sfc_main = {};';
                    }

                    bindings = compiledScript.bindings;
                } catch (e) {
                    console.error(`Erro ao compilar script Vue em ${filename}:`, e.message);
                    throw e;
                }
            }

            // 3. Compilação do Template para SSR
            let templateContent = '';
            if (descriptor.template) {
                try {
                    const templateResult = sfcCompiler.compileTemplate({
                        source: descriptor.template.content,
                        filename: filename,
                        id: filename,
                        ssr: true,
                        compilerOptions: {
                            bindingMetadata: bindings
                        },
                        ssrCssVars: descriptor.cssVars || []
                    });
                    templateContent = templateResult.code;
                } catch (e) {
                    console.error(`Erro ao compilar template Vue em ${filename}:`, e.message);
                }
            }

            // 4. Montagem do Código Final (ESM Virtual)
            finalEsm = `
                ${scriptContent}
                ${templateContent}
                
                // Anexa a função de renderização SSR ao componente principal
                if (typeof _sfc_main !== 'undefined') {
                    if (typeof ssrRender !== 'undefined') {
                        _sfc_main.ssrRender = ssrRender;
                    }
                    if (typeof render !== 'undefined') {
                        _sfc_main.render = render;
                    }
                }
                
                export default _sfc_main;
            `;

            // 5. Transformação final para CommonJS (Node.js) via Esbuild
            const result = esbuild.transformSync(finalEsm, {
                loader: 'ts',
                format: 'cjs',
                target: 'node16',
                sourcefile: filename
            });

            // 6. Execução no Node
            module._compile(result.code, filename);

        } catch (err) {
            console.error(`\n--- Nytlex Loader Debug ---`);
            console.error(`Falha fatal ao carregar: ${filename}`);
            console.error(`Erro original: ${err.message}`);
            if (finalEsm) {
                console.error(`\n[DEBUG] Código gerado (Snippet):`);
                console.error(finalEsm.split('\n').slice(0, 30).join('\n') + '\n...');
            }
            console.error(`--------------------------\n`);
            throw err;
        }
    };

    // --- Loader Robusto para .svelte (Svelte 4 e Svelte 5 SSR Support) ---
    require.extensions['.svelte'] = function(module, filename) {
        if (!svelteCompiler || !esbuild) {
            throw new Error('Para carregar arquivos .svelte no servidor, você precisa instalar "svelte" e "esbuild".');
        }

        const source = fs.readFileSync(filename, 'utf8');

        try {
            // Detecta a versão do Svelte (Svelte 5 muda drasticamente a engine SSR)
            const isSvelte5 = svelteCompiler.VERSION && svelteCompiler.VERSION.startsWith('5');

            const compileOptions = {
                filename: filename,
                generate: isSvelte5 ? 'server' : 'ssr',
                // Svelte 5 deprecates css: 'injected' na compilação do Server, usa external pra evitar exceptions
                css: isSvelte5 ? 'external' : 'injected',
                dev: false // Garante output limpo e determinístico para SSR
            };

            const result = svelteCompiler.compile(source, compileOptions);

            // Usa o esbuild para transformar o ESM nativo do Svelte em CommonJS (Node.js)
            const transformed = esbuild.transformSync(result.js.code, {
                loader: 'js',
                format: 'cjs',
                target: 'node16',
                sourcefile: filename
            });

            let cjsCode = transformed.code;

            // --- A MÁGICA DE COMPATIBILIDADE DO SVELTE 5 ---
            // Svelte 5 SSR é super estrito sobre o formato de 'snippets' passados em props.
            // Para garantir que o Router do Nytlex.js consiga renderizar a "Page" dentro do "Layout",
            // envelopamos o Componente e corrigimos qualquer discrepância de API no envio do snippet.
            if (isSvelte5) {
                cjsCode += `\n
                if (module.exports && typeof module.exports.default === 'function') {
                    const _OriginalComponent = module.exports.default;
                    module.exports.default = function NytlexSvelte5Wrapper($$payload, $$props) {
                        // Bridge para Snippets: Transforma o retorno (HTML da Página) diretamente no payload.out
                        if ($$props && typeof $$props.children === 'function') {
                            const _originalChild = $$props.children;
                            $$props.children = function NytlexSnippetBridge($$payload_inner) {
                                const res = _originalChild($$payload_inner);
                                // Fallback blindado: se retornar uma string, concatena com o buffer nativo de forma correta
                                if (typeof res === 'string' && $$payload_inner && typeof $$payload_inner.out !== 'undefined') {
                                    $$payload_inner.out += res;
                                }
                                return res;
                            };
                        }
                        return _OriginalComponent($$payload, $$props);
                    };
                }
                `;
            }

            // LIMPEZA DE CACHE DO NODE: A causa de muitas frustrações!
            // Node.js faz cache infinito do arquivo após o primeiro `require()`.
            // Deletamos a cache logo após a compilação. Assim, na próxima recarga/request (HMR),
            // ele OBRIGA a passar por este Loader e recompilar o código mais novo!
            if (require.cache[filename]) {
                delete require.cache[filename];
            }

            // Executa o código CJS compilado dentro do ambiente Node
            module._compile(cjsCode, filename);

        } catch (err) {
            console.error(`\n--- Nytlex Loader Debug ---`);
            console.error(`Falha fatal ao carregar/compilar SSR: ${filename}`);
            console.error(`Erro original: ${err.message}`);
            console.error(`--------------------------\n`);
            throw err;
        }
    };
}

module.exports = { registerLoaders };