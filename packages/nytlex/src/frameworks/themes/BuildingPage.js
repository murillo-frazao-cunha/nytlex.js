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

function getBuildingScreenHtml() {
    let version = "1.0.0";
    try {
        // 1. Acha o arquivo principal do pacote (ex: dist/index.js)
        const mainFilePath = require.resolve('nytlex');
        let packageRoot = path.dirname(mainFilePath);

        // 2. Sobe as pastas até encontrar o diretório que realmente contém o package.json
        while (packageRoot && !fs.existsSync(path.join(packageRoot, 'package.json'))) {
            const parentDir = path.dirname(packageRoot);
            if (parentDir === packageRoot) break; // Evita loop infinito na raiz do sistema
            packageRoot = parentDir;
        }

        // 3. Monta o caminho correto e lê a versão
        const pkgPath = path.join(packageRoot, 'package.json');
        version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    } catch (e) {
        console.error(e);
    }

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Nytlex.js | Building...</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style>
            :root {
                --bg-base-start: #050507;
                --bg-base-end: #09090b;
                
                --bg-card: #0a0a0c;
                --bg-terminal: #050505;
                
                --text-main: #ffffff;
                --text-dim: #71717a;
                
                --color-terciary: #6366f1;
                --color-secondary: #0ea5e9;
            }

            body {
                margin: 0;
                padding: 0;
                width: 100vw;
                height: 100vh;
                background-color: var(--bg-base-start);
                background-image: linear-gradient(135deg, var(--bg-base-start), var(--bg-base-end));
                font-family: 'Inter', system-ui, sans-serif;
                color: var(--text-main);
                display: flex;
                justify-content: center;
                align-items: center;
                overflow: hidden;
            }

            .container {
                display: flex;
                flex-direction: column;
                align-items: center;
                width: 100%;
                z-index: 2;
            }

            /* LAYOUT DEITADO COM A BORDA FAKE DE 3PX */
            .card-wrapper {
                width: min(90%, 540px);
                padding: 3px;
                border-radius: 16px;
                background: linear-gradient(135deg, rgb(24, 24, 27), rgb(39, 39, 42), transparent);
                box-sizing: border-box;
            }

            .card {
                background-color: var(--bg-card);
                border-radius: 13px;
                padding: 32px 40px;
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 24px;
                box-sizing: border-box;
                border: none;
                box-shadow: none;
            }

            .content {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 32px;
                width: 100%;
            }

            .left-side {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                min-width: 120px;
            }

            .left-side img {
                width: 56px;
                height: 56px;
                object-fit: contain;
            }

            .title-wrap {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
            }

            h1 {
                margin: 0;
                font-size: 1.6rem;
                font-weight: 800;
                letter-spacing: -0.04em;
                background: linear-gradient(to right, #fff, var(--text-dim));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .version {
                color: var(--text-dim);
                font-size: 0.8rem;
                font-weight: 500;
                letter-spacing: 0.05em;
                font-family: 'JetBrains Mono', monospace;
            }

            .right-side {
                flex: 1;
                display: flex;
                flex-direction: column;
            }

            .terminal {
                background-color: var(--bg-terminal);
                border-radius: 8px;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.8rem;
                box-sizing: border-box;
            }

            .term-line {
                display: flex;
                align-items: center;
                gap: 12px;
                color: var(--text-dim);
            }

            .term-line.active {
                color: var(--text-main);
            }

            .spinner {
                width: 12px;
                height: 12px;
                border: 2px solid var(--text-dim);
                border-top-color: var(--color-secondary);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }

            .check {
                color: var(--color-secondary);
                font-size: 13px;
                margin-left: 1px;
            }

            .file-name {
                color: var(--color-terciary);
            }

            .footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.75rem;
                color: var(--text-dim);
                font-weight: 500;
                width: 100%;
                border-top: 1px solid rgba(255, 255, 255, 0.02);
                padding-top: 16px;
            }

            .pulse-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .pulse-dot {
                width: 6px;
                height: 6px;
                background-color: var(--color-secondary);
                border-radius: 50%;
                animation: pulse 2s infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(0.8); }
                100% { opacity: 1; transform: scale(1); }
            }

            .brand-link {
                margin-top: 40px;
                display: flex;
                align-items: center;
                gap: 10px;
                opacity: 0.5;
                transition: opacity 0.3s ease;
                text-decoration: none;
                color: var(--text-main);
            }

            .brand-link:hover {
                opacity: 1;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card-wrapper">
                <div class="card">
                    <div class="content">
                        <div class="left-side">
                            <img src="https://raw.githubusercontent.com/murillo-frazao-cunha/nytlex-docs/master/public/logo.png" alt="Nytlex.js Logo" />
                            <div class="title-wrap">
                                <h1>Nytlex.js</h1>
                                <span class="version">v${version}</span>
                            </div>
                        </div>

                        <div class="right-side">
                            <div class="terminal">
                                <div class="term-line">
                                    <span class="check">✓</span>
                                    <span>Initializing environment</span>
                                </div>
                                <div class="term-line active">
                                    <div class="spinner"></div>
                                    <span>Compiling <span class="file-name">src/nytlex.ts</span></span>
                                </div>
                                <div class="term-line" style="opacity: 0.4;">
                                    <span style="width: 12px; text-align: center;">-</span>
                                    <span>Optimizing assets</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="footer">
                        <div class="pulse-wrap">
                            <div class="pulse-dot"></div>
                            <span>Building your application...</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <a href="https://npmjs.com/package/nytlex" target="_blank" rel="noopener noreferrer" class="brand-link">
                <img src="https://raw.githubusercontent.com/murillo-frazao-cunha/nytlex-docs/master/public/logo.png" alt="Nytlex Logo" style="width: 24px; height: 24px;" />
                <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">Nytlex.js</span>
            </a>
        </div>

        <script>
            setTimeout(() => {
                window.location.reload();
            }, 2500);
        </script>
    </body>
    </html>
    `;
}

module.exports = { getBuildingScreenHtml };