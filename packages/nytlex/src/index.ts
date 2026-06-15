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
import fsp from "fs/promises"
import crypto from 'crypto'; // Adicionado para gerar hash do cache
import {ExpressAdapter} from './adapters/express';
import {buildWithChunks, watchWithChunks} from './builder';
import {
    BackendHandler,
    BackendRouteConfig,
    NytlexOptions,
    NytlexMiddleware,
    RequestHandler,
    RouteConfig
} from './types';
import {
    findMatchingBackendRoute,
    findMatchingRoute,
    getLayout,
    getNotFound,
    loadBackendRoutes,
    loadLayout,
    loadNotFound,
    loadRoutes,
    processWebSocketRoutes,
    setupWebSocketUpgrade
} from './router';

import {NytlexRequest, NytlexResponse} from './api/http';
import {HotReloadManager} from './hotReload';
import {FrameworkAdapterFactory} from './adapters/factory';
import {GenericRequest, GenericResponse} from './types/framework';
import Console, {Colors} from "./api/console"
import { loadEnv } from './env/env';

// RPC
import { executeRpc } from './rpc/server';
import { RPC_ENDPOINT } from './rpc/types';
import {config} from "./helpers";
import detectFramework from "./api/framework";


// Helpers de segurança para servir arquivos estáticos sem path traversal
function isSuspiciousPathname(p: string): boolean {
    try {
        const decoded = decodeURIComponent(p);
        return decoded.includes('\0') || decoded.includes('..');
    } catch {
        return true;
    }
}

function resolveWithin(baseDir: string, unsafePath: string): string | null {
    const rel = unsafePath.replace(/^\/+/, '');
    const absBase = path.resolve(baseDir);
    const abs = path.resolve(absBase, rel);
    const baseWithSep = absBase.endsWith(path.sep) ? absBase : absBase + path.sep;
    if (abs !== absBase && !abs.startsWith(baseWithSep)) return null;
    return abs;
}

// Handler de Otimização de Imagem
async function handleImageOptimization(req: GenericRequest, res: GenericResponse, projectDir: string) {
    const urlObj = new URL(req.url, `http://localhost`);
    const params = urlObj.searchParams;

    const imageUrl = params.get('url');
    const widthStr = params.get('w');
    const heightStr = params.get('h');
    const qualityStr = params.get('q');

    if (!imageUrl) {
        res.status(400).text('Missing "url" parameter');
        return;
    }

    if (isSuspiciousPathname(imageUrl)) {
        res.status(400).text('Invalid path');
        return;
    }

    // Resolve o caminho do arquivo no disco
    let filePath: string | null = null;

    if (imageUrl.startsWith('/_nytlex/')) {
        // Arquivos de build (assets gerados pelo Rollup)
        const relPath = imageUrl.replace('/_nytlex/', '');
        filePath = resolveWithin(path.join(projectDir, '.nytlex'), relPath);
    } else {
        // Arquivos públicos
        filePath = resolveWithin(path.join(projectDir, 'public'), imageUrl);
    }

    if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).text('Image not found');
        return;
    }

    // Cache headers agressivos (o navegador deve cachear isso por muito tempo)
    res.header('Cache-Control', 'public, max-age=31536000, immutable');
    res.header('Vary', 'Accept');

    // Tenta carregar o sharp
    let sharp: any;
    try {
        // @ts-ignore
        sharp = require('sharp');
    } catch (e) {
        // Se não tiver sharp, avisa uma vez e serve o arquivo original
        if (!(global as any).__nytlex_sharp_warned) {
            Console.warn('Package "sharp" not found. Image optimization is disabled. Install it with: npm install sharp');
            (global as any).__nytlex_sharp_warned = true;
        }
    }

    // Se não tiver Sharp ou parâmetros, serve original
    if (!sharp || (!widthStr && !heightStr && !qualityStr)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        };
        res.header('Content-Type', contentTypes[ext] || 'application/octet-stream');
        const fileBuffer = await fs.promises.readFile(filePath);
        res.send(fileBuffer);
        return;
    }

    try {
        // --- SISTEMA DE CACHE EM DISCO (TEMPORÁRIO EM .nytlex) ---
        const cacheDir = path.join(projectDir, '.nytlex', 'cache', 'images');

        // Garante que a pasta existe (síncrono na primeira vez é ok, ou async)
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const width = widthStr ? parseInt(widthStr, 10) : undefined;
        const height = heightStr ? parseInt(heightStr, 10) : undefined;
        const quality = qualityStr ? parseInt(qualityStr, 10) : 75;

        // Gera um hash único baseado em TODOS os parâmetros
        // Ex: /img.png?w=100&h=200&q=80 -> hash unico
        const cacheKey = `${imageUrl}?w=${width}&h=${height}&q=${quality}`;
        const hash = crypto.createHash('md5').update(cacheKey).digest('hex');

        // Define a extensão do arquivo de cache
        const extOriginal = path.extname(filePath).toLowerCase();
        let extOutput = '.webp'; // Padrão é converter para WebP

        // Exceções que não viram WebP
        if (extOriginal === '.svg' || extOriginal === '.gif') {
            extOutput = extOriginal;
        }

        const cachedFilePath = path.join(cacheDir, `${hash}${extOutput}`);

        // 1. VERIFICA SE JÁ EXISTE NO CACHE
        if (fs.existsSync(cachedFilePath)) {
            // Serve direto do cache (Disco)
            // console.log(`[Nytlex] Serving cached image: ${imageUrl}`);

            const contentTypes: Record<string, string> = {
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.gif': 'image/gif'
            };
            res.header('Content-Type', contentTypes[extOutput] || 'application/octet-stream');

            const cachedBuffer = await fs.promises.readFile(cachedFilePath);
            res.send(cachedBuffer);
            return;
        }

        // 2. SE NÃO EXISTIR, PROCESSA COM SHARP
        // console.log(`[Nytlex] Processing image: ${imageUrl}`);

        const transformer = sharp(filePath);
        transformer.rotate();

        const isValidWidth = width && !isNaN(width);
        const isValidHeight = height && !isNaN(height);

        if (isValidWidth || isValidHeight) {
            transformer.resize(isValidWidth ? width : null, isValidHeight ? height : null, { withoutEnlargement: true });
        }

        if (extOriginal === '.png' || extOriginal === '.jpg' || extOriginal === '.jpeg' || extOriginal === '.webp') {
            transformer.webp({ quality });
            res.header('Content-Type', 'image/webp');
        } else {
            // Outros tipos mantêm original
            // 3. SALVA NO CACHE PARA A PRÓXIMA VEZ
            const contentTypes: Record<string, string> = {
                '.svg': 'image/svg+xml',
                '.gif': 'image/gif'
            };
            res.header('Content-Type', contentTypes[extOriginal] || 'application/octet-stream');
        }

        const optimizedBuffer = await transformer.toBuffer();

        // 3. SALVA NO CACHE PARA A PRÓXIMA VEZ
        // Escreve em background para não bloquear totalmente, mas aguarda para segurança
        try {
            await fs.promises.writeFile(cachedFilePath, optimizedBuffer);
        } catch (writeErr) {
            Console.error('Failed to write image cache:', writeErr);
        }

        res.send(optimizedBuffer);

    } catch (error) {
        Console.error('Error optimizing image:', error);
        res.status(500).text('Image optimization failed');
    }
}
import zlib from 'node:zlib'; // Certifique-se de ter este import no topo
import { CoreGoManager } from './utils/core-go';

export async function printTotalStats(outDir: string, https: boolean) {
    let totalOrig = 0;
    let totalGzip = 0;
    let totalBr = 0;

    // REMOVIDO: O loop que lia 'entries' para somar originais foi apagado.

    // Walk recursivo no outDir pra somar .gz e .br e calcular o original reverso
    async function walk(dir: string) {
        let dirents: fs.Dirent[];
        try {
            dirents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const d of dirents) {
            const full = path.join(dir, d.name);
            if (d.isDirectory()) {
                await walk(full);
                continue;
            }
            if (!d.isFile()) continue;

            let st: fs.Stats;
            try {
                st = await fsp.stat(full);
            } catch {
                continue;
            }

            const name = d.name;
            const isGz = name.endsWith(".gz");
            const isBr = name.endsWith(".br");

            if (isGz) totalGzip += st.size;
            else if (isBr) totalBr += st.size;

            // Lógica nova: Se o arquivo for do tipo que estamos priorizando (https = br, !https = gz),
            // descomprimimos para pegar o tamanho original.
            if ((https && isBr) || (!https && isGz)) {
                try {
                    const content = await fsp.readFile(full);
                    if (isBr) {
                        // Descomprime Brotli síncrono para pegar tamanho
                        totalOrig += zlib.brotliDecompressSync(content).length;
                    } else {
                        // Descomprime Gzip síncrono para pegar tamanho
                        totalOrig += zlib.gunzipSync(content).length;
                    }
                } catch (e) {
                    // Ignora erro de descompressão se houver
                }
            }
        }
    }

    await walk(outDir);

    // O totalOrig agora é calculado baseado na descompressão, se for 0 não tem o que mostrar
    if (totalOrig <= 0) return;

    const finalSize = https ? totalBr : totalGzip;
    if (finalSize <= 0) return;

    const diff = totalOrig - finalSize;
    const pct = (diff / totalOrig) * 100;

    const original = `  Original : ${Colors.Bright}${Colors.FgGreen}${(totalOrig / 1024).toFixed(2)} KB`;
    const finalStr = `  Final    : ${Colors.Bright}${Colors.FgGreen}${(finalSize / 1024).toFixed(2)} KB`;
    const saved = `  Saved    : ${Colors.Bright}${Colors.FgGreen}${(diff / 1024).toFixed(2)} KB ${Colors.Reset}${Colors.FgGray}(${pct.toFixed(
        2
    )}%)${Colors.Reset} \n`;

    Console.logCustomLevel("", false, undefined, "",
        `${Colors.FgBlue}${Colors.Bright}Optimization summary:${Colors.Reset}`, original, finalStr, saved
    );
}
// Exporta apenas os tipos e classes para o backend
export { NytlexRequest, NytlexResponse };
export type { BackendRouteConfig, BackendHandler };

// Exporta os adapters para uso manual se necessário
export { ExpressAdapter } from './adapters/express';
export { FastifyAdapter } from './adapters/fastify';
export { FrameworkAdapterFactory } from './adapters/factory';
export type { GenericRequest, GenericResponse, CookieOptions } from './types/framework';

// Exporta os helpers para facilitar integração
export { app } from './helpers';

// Exporta o sistema de WebSocket
export type { WebSocketContext, WebSocketHandler } from './types';

// Exporta os tipos de configuração
export type { NytlexConfig, NytlexConfigFunction } from './types';

export const coreGoManager = new CoreGoManager(require("../package.json").version);

export default function nytlex(options: NytlexOptions) {
    const { dev = true, dir = process.cwd(), envFiles } = options;
    loadEnv({ dir, dev, envFiles });

    // @ts-ignore
    process.nytlex = options;
    // @ts-ignore
    process.env.PORT = options.port
    const userWebDir = path.join(dir, 'src', 'web');
    const userWebRoutesDir = path.join(userWebDir, 'routes');
    const userBackendRoutesDir = path.join(dir, 'src', 'backend', 'routes');

    // --- DETECÇÃO DO FRAMEWORK ---
    const framework = detectFramework(dir);

    // --- CARREGAMENTO DO RENDERER ---
    let renderAsStream = require("./renderer").renderAsStream;

    async function executeMiddlewareChain(
        middlewares: NytlexMiddleware[] | undefined,
        finalHandler: BackendHandler,
        request: NytlexRequest,
        params: { [key: string]: string }
    ): Promise<NytlexResponse> {
        if (!middlewares || middlewares.length === 0) {
            return await finalHandler(request, params);
        }

        let currentIndex = 0;

        const next = async (): Promise<NytlexResponse> => {
            if (currentIndex < middlewares.length) {
                const currentMiddleware = middlewares[currentIndex];
                currentIndex++;
                return await currentMiddleware(request, params, next);
            } else {
                return await finalHandler(request, params);
            }
        };

        return await next();
    }

    let frontendRoutes: (RouteConfig & { componentPath: string })[] = [];
    let hotReloadManager: HotReloadManager | null = null;

    // Objeto de configuração para o builder (substitui o entryPoint físico)
    const nytlexBuilderOptions: any = {
        routes: [],
        layout: null,
        notFound: null,
        framework: framework,
        projectDir: dir,
        mode: options.mode
    };

    const updateBuilderOptions = (): boolean => {
        const newFrontendRoutes = loadRoutes(userWebRoutesDir);
        const newLayout = loadLayout(userWebDir);
        const newNotFound = loadNotFound(userWebDir);

        const oldKey = frontendRoutes.map(r => `${(r as any).pattern ?? ''}:${r.componentPath}`).join('|');
        const newKey = newFrontendRoutes.map(r => `${(r as any).pattern ?? ''}:${r.componentPath}`).join('|');
        const oldLayoutKey = nytlexBuilderOptions.layout?.componentPath ?? '';
        const newLayoutKey = newLayout?.componentPath ?? '';
        const oldNotFoundKey = nytlexBuilderOptions.notFound?.componentPath ?? '';
        const newNotFoundKey = newNotFound?.componentPath ?? '';
        const changed = oldKey !== newKey || oldLayoutKey !== newLayoutKey || oldNotFoundKey !== newNotFoundKey;

        frontendRoutes = newFrontendRoutes;

        // Atualiza as opções passadas para o builder
        nytlexBuilderOptions.routes = frontendRoutes;
        nytlexBuilderOptions.layout = newLayout;
        nytlexBuilderOptions.notFound = newNotFound;
        return changed;
    };

    return {
        prepare: async (skipBuild = false) => {
            await coreGoManager.update();
            const isProduction = !dev;

            if (!isProduction) {
                hotReloadManager = new HotReloadManager(dir);
                await hotReloadManager.start();

                hotReloadManager.onBackendApiChange(() => {
                    loadBackendRoutes(userBackendRoutesDir);
                    processWebSocketRoutes();
                });

                hotReloadManager.onFrontendChange(() => {
                    updateBuilderOptions();
                });
            }
            const now = Date.now();
            const timee = Console.dynamicLine(`Loading routes and components`);
            const spinnerFrames1 = ['|', '/', '-', '\\'];
            let frameIndex1 = 0;

            const spinner1 = setInterval(() => {
                timee.update(`   ${Colors.FgYellow}${spinnerFrames1[frameIndex1]}${Colors.Reset}  Loading routes and components...`);
                frameIndex1 = (frameIndex1 + 1) % spinnerFrames1.length;
            }, 100);

            frontendRoutes = loadRoutes(userWebRoutesDir);
            loadBackendRoutes(userBackendRoutesDir);

            processWebSocketRoutes();

            const layout = loadLayout(userWebDir);
            const notFound = loadNotFound(userWebDir);

            const outDir = path.join(dir, '.nytlex');
            fs.mkdirSync(outDir, {recursive: true});

            // Inicializa as opções do builder
            nytlexBuilderOptions.routes = frontendRoutes;
            nytlexBuilderOptions.layout = layout;
            nytlexBuilderOptions.notFound = notFound;

            clearInterval(spinner1)
            timee.end(`Routes and components loaded in ${Date.now() - now}ms`);


            if (isProduction) {
                // Pula o build se skipBuild for true (usado quando já existe build)
                if (!skipBuild) {
                    const time = Console.dynamicLine(`Starting client build`);
                    const spinnerFrames = ['|', '/', '-', '\\'];
                    let frameIndex = 0;

                    const spinner = setInterval(() => {
                        time.update(`    ${Colors.FgGreen}${spinnerFrames[frameIndex]}${Colors.Reset}  Building...`);
                        frameIndex = (frameIndex + 1) % spinnerFrames.length;
                    }, 100);

                    const now = Date.now();

                    // Passa o objeto de opções ao invés do caminho do arquivo
                    await buildWithChunks(nytlexBuilderOptions, outDir, isProduction);
                    const elapsed = Date.now() - now;

                    clearInterval(spinner);
                    time.update("");

                    await printTotalStats(outDir, config?.ssl !== undefined && config.ssl !== null);
                    time.end(`Client build completed in ${elapsed}ms`);

                    if (hotReloadManager) {
                        hotReloadManager.onBuildComplete(true);
                    }
                }

            } else {
                const time = Console.dynamicLine(`  ${Colors.BgYellow} watcher ${Colors.Reset}  Building initial assets`);
                const spinnerFrames = ['|', '/', '-', '\\'];
                let frameIndex = 0;

                const spinner = setInterval(() => {
                    time.update(`    ${Colors.FgYellow}${spinnerFrames[frameIndex]}${Colors.Reset}  Building initial assets...`);
                    frameIndex = (frameIndex + 1) % spinnerFrames.length;
                }, 100);

                const buildStart = Date.now();
                // @ts-ignore
                // Passa o objeto de opções ao invés do caminho do arquivo
                // Aguarda o primeiro build completar para evitar lentidão na primeira requisição
                await watchWithChunks(nytlexBuilderOptions, outDir, hotReloadManager!).catch(err => {
                    Console.error(`Error starting watch`, err);
                });

                clearInterval(spinner);
                time.end(`Initial build complete in ${Date.now() - buildStart}ms - watching for changes...`);
            }

        },

        executeInstrumentation: () => {
            const instrumentationFile = fs.readdirSync(path.join(dir, 'src')).find(file => /^nytlex\.(js|ts)$/.test(file));
            if (instrumentationFile) {
                const instrumentationPath = path.join(dir, 'src', instrumentationFile);
                const instrumentation = require(instrumentationPath);

                if (instrumentation.hotReloadListener && typeof instrumentation.hotReloadListener === 'function') {
                    if (hotReloadManager) {
                        hotReloadManager.setHotReloadListener(instrumentation.hotReloadListener);
                    }
                }

                if (typeof instrumentation === 'function') {
                    instrumentation();
                } else if (typeof instrumentation.default === 'function') {
                    instrumentation.default();
                } else {
                    Console.warn(`The instrumentation file ${instrumentationFile} does not export a default function.`);
                }
            }
        },
        getRequestHandler: (): RequestHandler => {
            return async (req: any, res: any) => {
                const adapter = FrameworkAdapterFactory.detectFramework(req, res);
                const genericReq: GenericRequest = adapter.parseRequest(req);
                const genericRes: GenericResponse = adapter.createResponse(res);

                (genericReq as any).hwebDev = dev;
                (genericReq as any).hotReloadManager = hotReloadManager;

                const {hostname} = req.headers;
                const method = (genericReq.method || 'GET').toUpperCase();
                const urlObj = new URL(genericReq.url, `http://${hostname}:${config?.port}`);
                const pathname = urlObj.pathname;
                if (pathname === RPC_ENDPOINT && method === 'POST') {
                    try {
                        const result = await executeRpc(
                            {
                                projectDir: dir,
                                request: genericReq
                            },
                            genericReq.body
                        );
                        genericRes.header('Content-Type', 'application/json');
                        genericRes.status(200).send(JSON.stringify(result));
                        return;
                    } catch (error) {
                        genericRes.header('Content-Type', 'application/json');
                        genericRes.status(200).send(JSON.stringify({ success: false, error: 'Internal RPC error' }));
                        return;
                    }
                }

                if (pathname === '/hweb-hotreload/' && genericReq.headers.upgrade === 'websocket' && hotReloadManager) {
                    return;
                }

                // --- SISTEMA DE OTIMIZAÇÃO DE IMAGEM ---
                if (pathname.includes('/_nytlex/image')) {

                    await handleImageOptimization(genericReq, genericRes, dir);
                    return;
                }
                // ---------------------------------------

                if (pathname !== '/' && !pathname.startsWith('/api/') && !pathname.startsWith('/.nytlex')) {
                    const publicDir = path.join(dir, 'public');

                    if (!isSuspiciousPathname(pathname)) {
                        const filePath = resolveWithin(publicDir, pathname);
                        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                            const ext = path.extname(filePath).toLowerCase();
                            const contentTypes: Record<string, string> = {
                                '.html': 'text/html',
                                '.css': 'text/css',
                                '.js': 'application/javascript',
                                '.json': 'application/json',
                                '.png': 'image/png',
                                '.jpg': 'image/jpeg',
                                '.jpeg': 'image/jpeg',
                                '.gif': 'image/gif',
                                '.svg': 'image/svg+xml',
                                '.ico': 'image/x-icon',
                                '.webp': 'image/webp',
                                '.mp4': 'video/mp4',
                                '.webm': 'video/webm',
                                '.mp3': 'audio/mpeg',
                                '.wav': 'audio/wav',
                                '.pdf': 'application/pdf',
                                '.txt': 'text/plain',
                                '.xml': 'application/xml',
                                '.zip': 'application/zip'
                            };

                            genericRes.header('Content-Type', contentTypes[ext] || 'application/octet-stream');

                            if (adapter.type === 'express') {
                                (res as any).sendFile(filePath);
                            } else if (adapter.type === 'fastify') {
                                const fileContent = fs.readFileSync(filePath);
                                genericRes.send(fileContent);
                            } else if (adapter.type === 'native') {
                                const fileContent = fs.readFileSync(filePath);
                                genericRes.send(fileContent);
                            }
                            return;
                        }
                    }
                }

                if (pathname.startsWith('/_nytlex/')) {
                    const staticPath = path.join(dir, '.nytlex');
                    const requestPath = pathname.replace('/_nytlex/', '');

                    if (!isSuspiciousPathname(requestPath)) {
                        let filePath = resolveWithin(staticPath, requestPath);
                        let fileToServe = filePath;
                        let contentEncoding = '';

                        // Lógica de Negociação de Conteúdo (Gzip/Brotli)
                        if (filePath) {
                            const acceptEncoding = (req.headers['accept-encoding'] || '') as string;
                            const supportsBrotli = acceptEncoding.includes('br');
                            const supportsGzip = acceptEncoding.includes('gzip');
                            
                            const brPath = filePath + '.br';
                            const gzPath = filePath + '.gz';

                            // Prioridade: Brotli > Gzip > Original
                            if (supportsBrotli && fs.existsSync(brPath)) {
                                fileToServe = brPath;
                                contentEncoding = 'br';
                            } else if (supportsGzip && fs.existsSync(gzPath)) {
                                fileToServe = gzPath;
                                contentEncoding = 'gzip';
                            } else if (!fs.existsSync(filePath)) {
                                // Se o original não existe, e não achamos comprimido compatível,
                                // não podemos servir nada.
                                fileToServe = null; 
                            }
                        }

                        // Verifica se existe E se é arquivo
                        if (fileToServe && fs.existsSync(fileToServe) && fs.statSync(fileToServe).isFile()) {
                            const stats = fs.statSync(fileToServe);

                            // O Content-Type deve ser baseado no arquivo ORIGINAL, não no .br/.gz
                            const originalExt = path.extname(filePath!).toLowerCase();
                            
                            const contentTypes: Record<string, string> = {
                                '.js': 'application/javascript',
                                '.css': 'text/css',
                                '.map': 'application/json',
                                '.vue': 'text/css',
                                '.png': 'image/png',
                                '.jpg': 'image/jpeg',
                                '.svg': 'image/svg+xml'
                            };

                            // CORREÇÃO 1: Cache diferenciado para Dev vs Produção
                            if (options.dev) {
                                genericRes.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                                genericRes.header('Pragma', 'no-cache');
                                genericRes.header('Expires', '0');
                            } else {
                                genericRes.header('Cache-Control', 'public, max-age=31536000, immutable');
                            }

                            // Define Content-Encoding se estiver servindo comprimido
                            if (contentEncoding) {
                                genericRes.header('Content-Encoding', contentEncoding);
                                // Remove Content-Length se houver, para evitar conflitos em alguns proxies
                                // (embora o adapter geralmente lide com isso ao enviar stream/buffer)
                            }

                            genericRes.header('Content-Type', contentTypes[originalExt] || 'text/plain');

                            const lastModified = stats.mtime.toUTCString();
                            genericRes.header('Last-Modified', lastModified);
                            
                            // Lógica 304
                            const ifModifiedSince = req.headers['if-modified-since'];
                            if (ifModifiedSince) {
                                const requestDate = new Date(ifModifiedSince).getTime();
                                const fileDate = new Date(lastModified).getTime();
                                if (requestDate >= fileDate) {
                                    if (adapter.type === 'express') {
                                        (res as any).status(304).end();
                                    } else {
                                        genericRes.status(304);
                                        genericRes.send(null);
                                    }
                                    return;
                                }
                            }

                            // Envia o arquivo
                            if (adapter.type === 'express') {
                                (res as any).sendFile(fileToServe);
                            } else {
                                const fileContent = fs.readFileSync(fileToServe);
                                genericRes.send(fileContent);
                            }
                            return; // Encerra aqui com sucesso

                        } else {
                            // CORREÇÃO 2: 404 para assets não encontrados
                            if (adapter.type === 'express') {
                                (res as any).status(404).send('Nytlex Asset Not Found');
                            } else {
                                genericRes.status(404);
                                genericRes.send('Nytlex Asset Not Found');
                            }
                            return; // Mata a requisição
                        }
                    }
                }

                const backendMatch = findMatchingBackendRoute(pathname, method);
                if (backendMatch) {
                    try {
                        const handler = backendMatch.route[method as keyof BackendRouteConfig] as BackendHandler;
                        if (handler) {
                            const hwebReq = new NytlexRequest(genericReq);

                            const hwebRes = await executeMiddlewareChain(
                                backendMatch.route.middleware,
                                handler,
                                hwebReq,
                                backendMatch.params
                            );

                            hwebRes._applyTo(genericRes);
                            return;
                        }
                    } catch (error) {
                        Console.error(`API route error ${pathname}:`, error);
                        genericRes.status(500).text('Internal server error in API');
                        return;
                    }
                }

                // Renderização de Página (Frontend)
                const pageMatch = findMatchingRoute(pathname);

                // Determina o objeto de resposta "cru" para o stream do React
                // Se for Fastify, o Writable stream está em res.raw. Se for Express/Native, é o próprio res.
                const rawRes = (res.raw || res);

                if (!pageMatch) {
                    try {
                        const notFoundRoute = {
                            pattern: '/__404__',
                            component: () => null, // Será renderizado via SSR se tiver componente de 404 definido no Client
                            componentPath: '__404__'
                        };

                        // Tenta usar componente 404 customizado se houver
                        const notFound = getNotFound();
                        if (notFound) {
                            // Carrega o componente 404 real para o SSR funcionar
                            try {
                                const nfModule = require(path.resolve(process.cwd(), notFound.componentPath));
                                // @ts-ignore
                                notFoundRoute.component = nfModule.default || nfModule;
                            } catch(e) {}
                        }

                        // Define status 404 antes de iniciar o stream
                        if (rawRes.statusCode) rawRes.statusCode = 404; // Native/Fastify
                        if (rawRes.status) rawRes.status(404); // Express (mas pode quebrar se for raw, melhor usar statusCode)

                        await renderAsStream({
                            req: genericReq,
                            res: rawRes,
                            route: notFoundRoute,
                            params: {},
                            allRoutes: frontendRoutes
                        });
                        return;
                    } catch (error) {
                        Console.error(`Error rendering page 404:`, error);
                        genericRes.status(404).text('Page not found');
                        return;
                    }
                }

                try {
                    // Renderização via Stream (SSR + Streaming)
                    await renderAsStream({
                        req: genericReq,
                        res: rawRes,
                        route: pageMatch.route,
                        params: pageMatch.params,
                        allRoutes: frontendRoutes
                    });
                } catch (error) {
                    Console.error(`Error rendering page ${pathname}:`, error);

                    // Se o stream já começou, não dá pra enviar erro 500 limpo.
                    // O renderAsStream tenta lidar com isso no onError.
                    if (!rawRes.headersSent) {
                        const {getServerErrorHtml} = require("./frameworks/themes/ServerError")
                        // Gera o HTML bonitão passando o erro real
                        const errorHtml = getServerErrorHtml({
                            title: 'Critical SSR Error',
                            error: error,
                            requestUrl: pathname,
                            hint: 'The page crashed before or during the rendering process on the server.'
                        });

                        // Configura a resposta como HTML e envia a tela de erro
                        rawRes.statusCode = 500;
                        rawRes.setHeader('Content-Type', 'text/html; charset=utf-8');
                        rawRes.end(errorHtml);
                    }
                }
            };
        },

        setupWebSocket: (server: any) => {
            const isExpressServer = FrameworkAdapterFactory.getCurrentAdapter() instanceof ExpressAdapter;
            const actualServer = isExpressServer ? server : (server.server || server);
            setupWebSocketUpgrade(actualServer, hotReloadManager);
        },

        stop: () => {

        }
    };
}