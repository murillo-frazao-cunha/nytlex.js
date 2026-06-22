#!/usr/bin/env node

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

require('ts-node').register();

const { registerLoaders } = require('../loaders');
registerLoaders();

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

const ConsoleModule = require('../api/console');

const {default: detectFramework} = require("../api/framework");
const {renderAsStream} = require("../renderer");
const {showTitle} = require("../utils/utils");
const Console = ConsoleModule.default;
const { Levels, Colors } = ConsoleModule;

program
    .version('1.0.0')
    .description('CLI to manage the application.');

// --- Helpers ---

/**
 * Cria um arquivo de marcação de build de produção
 */
function createBuildInfoFile(projectDir) {
    const buildInfoPath = path.join(projectDir, '.nytlex', '.build-info.json');



    const buildInfo = {
        type: 'production',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        nytlexVersion: '1.0.0', // Pode pegar do package.json se necessário
        buildDate: new Date().getTime()
    };

    try {
        fs.mkdirSync(path.dirname(buildInfoPath), { recursive: true });
        fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2), 'utf8');
    } catch (error) {
        Console.error('Failed to create build info file:', error);
    }
}

/**
 * Verifica se existe uma build de produção válida
 */
function hasValidProductionBuild(projectDir) {
    const buildInfoPath = path.join(projectDir, '.nytlex', '.build-info.json');
    const buildDir = path.join(projectDir, '.nytlex');

    // Verifica se o diretório de build existe e tem conteúdo
    if (!fs.existsSync(buildDir)) {
        return false;
    }

    // Verifica se o arquivo de info de build existe
    if (!fs.existsSync(buildInfoPath)) {
        return false;
    }

    try {
        const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));

        // Verifica se é uma build de produção
        if (buildInfo.type !== 'production') {
            return false;
        }

        // Verifica se tem arquivos no diretório (além do .build-info.json)
        const files = fs.readdirSync(buildDir);
        if (files.length <= 1) {
            return false;
        }

        return true;
    } catch (error) {
        Console.warn('Invalid build info file:', error.message);
        return false;
    }
}

/**
 * Obtém informações da build de produção
 */
function getBuildInfo(projectDir) {
    const buildInfoPath = path.join(projectDir, '.nytlex', '.build-info.json');

    try {
        if (fs.existsSync(buildInfoPath)) {
            return JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
        }
    } catch (error) {
        Console.warn('Could not read build info:', error.message);
    }

    return null;
}

/**
 * Remove o arquivo de info de build (usado no modo dev)
 */
function removeBuildInfoFile(projectDir) {
    const buildInfoPath = path.join(projectDir, '.nytlex', '.build-info.json');

    try {
        if (fs.existsSync(buildInfoPath)) {
            fs.unlinkSync(buildInfoPath);
        }
    } catch (error) {
        // Silencioso, não é crítico
    }
}

function initializeApp(options, isDev, skipBuild = false) {
    const appOptions = {
        dev: isDev,
        port: options.port,
        hostname: options.hostname,
        framework: 'native',
        skipBuild: skipBuild,
    };


    const helperModule = require("../helpers");
    const helper = helperModule.default(appOptions);
    helper.init();
}

function copyDirRecursive(src, dest) {
    try {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (let entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    } catch (error) {
        Console.error(`Error copying ${src} to ${dest}:`, error);
        throw error;
    }
}

// --- Comandos ---

program
    .command('dev')
    .description('Starts the application in development mode.')
    .option('-p, --port <number>', 'Specifies the port to run on', '3000')
    .option('-H, --hostname <string>', 'Specifies the hostname to run on', '0.0.0.0')
    .option('--ssl', 'Activates HTTPS/SSL mode')
    .option('--http-redirect-port <number>', 'Port for HTTP->HTTPS redirection', '80')
    .action(async (options) => {
        await showTitle()
        const projectDir = process.cwd();

        // Remove o arquivo de build info se existir (modo dev não usa builds de produção)
        removeBuildInfoFile(projectDir);

        initializeApp(options, true);
    });

program
    .command('build')
    .description('Builds the application for production.')
    .action(async (options) => {
        await showTitle()
        process.env.NODE_ENV = 'production';
        const projectDir = process.cwd();

        Console.info('Starting production build...');

        try {
            const { loadNytlexConfig, setConfig } = require("../config");
            setConfig(await loadNytlexConfig(projectDir, 'production'));

            const helperModule = require("../helpers");
            const app = helperModule.default({
                dev: false,
                port: 3000,
                hostname: '0.0.0.0',
                framework: 'native'
            });

            await app.prepare();

            // Cria o arquivo de informações da build
            createBuildInfoFile(projectDir);

            Console.success('Production build completed successfully!');
            Console.info('You can now start the application with: nytlex start');
        } catch (error) {
            Console.error('Build failed:', error);
            process.exit(1);
        }
    });

program
    .command('start')
    .description('Starts the application in production mode.')
    .option('-p, --port <number>', 'Specifies the port to run on', '3000')
    .option('-H, --hostname <string>', 'Specifies the hostname to run on', '0.0.0.0')
    .option('--ssl', 'Activates HTTPS/SSL mode')
    .option('--http-redirect-port <number>', 'Port for HTTP->HTTPS redirection', '80')
    .option('--build', 'Force rebuild before starting')
    .action(async (options) => {
        await showTitle()
        process.env.NODE_ENV = 'production';
        const projectDir = process.cwd();
        const buildDir = path.join(projectDir, '.nytlex');

        // Verifica se existe uma build de produção válida
        const hasValidBuild = hasValidProductionBuild(projectDir);

        if (!hasValidBuild || options.build) {
            if (!hasValidBuild && !options.build) {

                const dim = Colors.Dim;
                const bright = Colors.Bright;

                const title = bright + Colors.FgCyan;
                const err = bright + Colors.FgRed;
                const label = Colors.FgGray;
                const cmd = bright + Colors.FgCyan;
                const reset = Colors.Reset;

                const line = `${dim}${"━".repeat(70)}${reset}`;

                Console.logCustomLevel(
                    "",
                    false,
                    undefined,
                    `${err}✖  No valid production build found!${reset}`,
                    `${label}It looks like there is no build output to run in production.${reset}`,
                    " ",

                    `${label}Build the application first:${reset}`,
                    `  ${cmd}nytlex build${reset}`,
                    " ",

                    `${label}Or build and start in one command:${reset}`,
                    `  ${cmd}nytlex start --build${reset}`,
                );

                process.exitCode = 0;
                return
            } else {
                Console.info('Rebuilding application...');
            }

            try {
                const { loadNytlexConfig, setConfig } = require("../config");
                setConfig(await loadNytlexConfig(projectDir, 'production'));

                const helperModule = require("../helpers");
                const app = helperModule.default({
                    dev: false,
                    port: options.port || 3000,
                    hostname: options.hostname || '0.0.0.0',
                    framework: 'native'
                });

                await app.prepare();

                // Cria o arquivo de informações da build
                createBuildInfoFile(projectDir);

                Console.success('Build completed!');
            } catch (error) {
                Console.error('Build failed:', error);
                process.exitCode = 0;
                return
            }

            // Inicia a aplicação sem rebuildar (já foi buildado acima)
            // Pass true para indicar que foi buildado agora
            await initializeApp(options, false);
        } else {
            // Mostra informações da build existente
            const buildInfo = getBuildInfo(projectDir);
            if (buildInfo) {
                const dim = Colors.Dim;
                const bright = Colors.Bright;

                const title = bright + Colors.FgCyan;
                const ok = bright + Colors.FgGreen;
                const label = Colors.FgGray;
                const value = bright + Colors.FgWhite;
                const reset = Colors.Reset;
                const rawLocale =
                    process.env.LC_ALL ||
                    process.env.LC_TIME ||
                    process.env.LANG ||
                    undefined;
                // Normalize locale: strip encoding suffix (e.g. "C.UTF-8" -> undefined, "pt_BR.UTF-8" -> "pt-BR")
                let sysLocale;
                if (rawLocale && rawLocale !== 'C' && rawLocale !== 'POSIX') {
                    const normalized = rawLocale.split('.')[0].replace(/_/g, '-');
                    try {
                        new Intl.DateTimeFormat(normalized);
                        sysLocale = normalized;
                    } catch {
                        sysLocale = undefined;
                    }
                }
                const date = new Date(buildInfo.buildDate).toLocaleString(sysLocale, {
                    dateStyle: 'full',
                    timeStyle: 'medium'
                });

                Console.logCustomLevel(
                    "",
                    false,
                    undefined,
                    `${ok}✔${reset}  ${bright}Using existing production build${reset}`,
                    " ",

                    `${label}Built on:${reset}      ${value}${date}${reset}`,
                    `${label}Node version:${reset}  ${value}${buildInfo.nodeVersion}${reset}`,
                    `${label}Platform:${reset}      ${value}${buildInfo.platform}-${buildInfo.arch}${reset}`,
                    " "
                );

            }

            // Inicia a aplicação sem rebuildar
            await initializeApp(options, false);
        }
    });
program
    .command('export')
    .description('Exports the application as static HTML to the "exported" folder.')
    .option('-o, --output <path>', 'Specifies the output directory', 'exported')
    .option('--assets-dir <path>', 'Directory where the .nytlex assets will be written', '.nytlex')
    .option('--no-html', 'Do not generate index.html (assets only)')
    .option('--output-h-data <file>', 'Write the data-h value into this file')
    .action(async (options) => {
        await showTitle()
        process.env.NODE_ENV = 'production';
        const projectDir = process.cwd();
        const outputInput = (typeof options.output === 'string' && options.output.trim()) || 'exported';
        const exportDirResolved = path.resolve(projectDir, outputInput);

        const projectDirResolved = path.resolve(projectDir);

        if (exportDirResolved === path.parse(exportDirResolved).root) {
            Console.error(`Refusing to use drive root: ${exportDirResolved}`);
            process.exit(1);
        }

        const assetsDirInput = (typeof options.assetsDir === 'string' && options.assetsDir.trim()) || '.nytlex';
        const assetsDirResolved = path.resolve(exportDirResolved, assetsDirInput);
        const relAssetsToExport = path.relative(exportDirResolved, assetsDirResolved);

        const assetsBaseHref = '/.' + (relAssetsToExport.split(path.sep).join('/').replace(/^\.?\/?/, '') || '');

        Console.info('Starting export process...');

        try {
            let { loadNytlexConfig, setConfig, config } = require("../config")
            setConfig(await loadNytlexConfig(projectDirResolved, 'production'))
            if (fs.existsSync(exportDirResolved)) {
                Console.info('Cleaning existing export folder...');
                fs.rmSync(exportDirResolved, { recursive: true, force: true });
            }
            fs.mkdirSync(exportDirResolved, { recursive: true });

            Console.info('Building application...');
            const helperModule = require("../helpers");
            // Mark this build as an export build so client bundles can avoid runtime-only endpoints
            process.env.NYTLEX_MODE = 'export';
            const app = helperModule.default({ dev: false, port: 3000, hostname: '0.0.0.0', framework: 'native', mode: "exported" });
            await app.prepare();
            Console.success('Build complete.');

            const distDir = path.join(projectDirResolved, '.nytlex');
            if (fs.existsSync(distDir)) {
                Console.info('Copying JavaScript files...');
                copyDirRecursive(distDir, assetsDirResolved);
            }

            const publicDir = path.join(projectDirResolved, 'public');
            if (fs.existsSync(publicDir)) {
                Console.info('Copying public files...');
                copyDirRecursive(publicDir, exportDirResolved);
            }

            const shouldExtractHData = !!options.outputHData;
            const shouldRenderHtml = options.html !== false || shouldExtractHData;

            if (shouldRenderHtml) {
                const writeHtmlToDisk = options.html !== false;
                Console.info(writeHtmlToDisk ? 'Generating index.html...' : 'Rendering HTML for h-data extraction...');


                const frameWork = detectFramework(projectDirResolved)
                const { renderAsStream } = require('../renderer');

                const { loadRoutes, loadLayout, loadNotFound } = require('../router');

                const userWebDir = path.join(projectDirResolved, 'src', 'web');
                const userWebRoutesDir = path.join(userWebDir, 'routes');

                // Recarrega rotas para garantir estado limpo
                const routes = loadRoutes(userWebRoutesDir);
                loadLayout(userWebDir);
                loadNotFound(userWebDir);

                if (routes.length === 0) {
                    Console.warn('No routes found in src/web/routes. Skipping HTML generation.');
                } else {
                    const rootRoute = routes.find(r => r.pattern === '/') || routes[0];

                    let htmlResult = '';
                    const mockReq = {
                        url: rootRoute.pattern || '/',
                        method: 'GET',
                        headers: { host: 'localhost' },
                        hwebDev: false,
                        hotReloadManager: null
                    };

                    const mockRes = new Writable({
                        write(chunk, encoding, callback) {
                            htmlResult += chunk.toString();
                            callback();
                        }
                    });

                    // Extensão do mockRes para compatibilidade com o renderer
                    mockRes.setHeader = () => {};
                    mockRes.getHeader = () => {};
                    mockRes.statusCode = 200;
                    mockRes.end = (chunk) => {
                        if (chunk) htmlResult += chunk.toString();
                        mockRes.emit('finish');
                    };

                    const streamComplete = new Promise((resolve, reject) => {
                        mockRes.on('finish', resolve);
                        mockRes.on('error', reject);
                    });

                    await renderAsStream({
                        req: mockReq,
                        res: mockRes,
                        route: rootRoute,
                        params: {},
                        allRoutes: routes
                    });

                    await streamComplete;

                    if (shouldExtractHData) {
                        const m = htmlResult.match(/data-h=["']([^"']*)["']/i);
                        if (m && m[1]) {
                            const outputHDataPath = path.resolve(projectDirResolved, options.outputHData.trim());
                            fs.mkdirSync(path.dirname(outputHDataPath), { recursive: true });
                            fs.writeFileSync(outputHDataPath, m[1], 'utf8');
                            Console.success(`h-data written to: ${path.relative(projectDirResolved, outputHDataPath)}`);
                        }
                    }

                    if (writeHtmlToDisk) {
                        // Ajusta caminhos dos scripts para serem relativos ao assetsDir
                        const finalHtml = htmlResult.replace(/\/_nytlex\//g, assetsBaseHref.endsWith('/') ? assetsBaseHref : assetsBaseHref + '/');
                        const indexPath = path.join(exportDirResolved, 'index.html');
                        fs.writeFileSync(indexPath, finalHtml, 'utf8');
                        Console.success('index.html generated.');
                    }
                }
            } else {
                Console.info('Skipping index.html generation.');
            }

            Console.success(`Export completed successfully to: ${path.relative(projectDirResolved, exportDirResolved)}`);

        } catch (error) {
            Console.error('Error during export:', error);
            process.exit(1);
        }
    });

program.parse(process.argv);