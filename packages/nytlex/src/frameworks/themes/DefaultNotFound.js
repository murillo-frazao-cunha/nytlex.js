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

function getDefaultNotFound() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>404 | Not Found</title>
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
                --color-accent: #0ea5e9;
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
                flex-direction: column;
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

            .card-wrapper {
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

            /* GRID PARA CONTROLAR O ESPAÇO E EVITAR QUE OS ELEMENTOS VAZEM */
            .content {
                display: grid;
                grid-template-columns: auto 1fr;
                align-items: center;
                gap: 32px;
                width: 100%;
            }

            .left-side {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-width: 100px;
            }

            .code {
                font-size: 4.5rem;
                font-weight: 900;
                line-height: 1;
                letter-spacing: -0.05em;
                background: linear-gradient(to right, #fff, var(--text-dim));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin: 0;
            }

            .error-label {
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.1em;
                color: #ef4444;
                text-transform: uppercase;
                margin-top: 4px;
            }

            .right-side {
                display: flex;
                flex-direction: column;
                gap: 16px;
                min-width: 0; /* Permite que o container encolha sem quebrar a grid */
            }

            .terminal-box {
                width: 100%;
                background-color: var(--bg-terminal);
                border-radius: 8px;
                padding: 16px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.8rem;
                text-align: left;
                color: var(--text-dim);
                box-sizing: border-box;
            }

            .terminal-dots {
                display: flex;
                gap: 6px;
                margin-bottom: 10px;
                opacity: 0.5;
            }

            .dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--text-dim);
            }

            .terminal-route {
                overflow-wrap: anywhere; /* Impede a rota de vazar para fora do terminal */
                word-break: break-all;
                line-height: 1.4;
            }

            .method {
                color: var(--color-accent);
                font-weight: 600;
                margin-right: 6px;
            }

            .route-path {
                color: var(--text-main);
            }

            .actions {
                display: flex;
                gap: 12px;
                width: 100%;
            }

            .btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                outline: none;
                text-decoration: none;
                font-family: 'Inter', sans-serif;
                flex: 1;
            }

            .btn-primary {
                background: var(--text-main);
                color: #000000;
            }

            .btn-primary:hover {
                opacity: 0.85;
                transform: translateY(-1px);
            }

            .btn-secondary {
                background: var(--bg-terminal);
                color: var(--text-main);
            }

            .btn-secondary:hover {
                background: #1a1a1a;
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

            .status {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .status-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #ef4444;
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

            /* Responsividade básica para telas muito pequenas */
            @media (max-width: 480px) {
                .content {
                    grid-template-columns: 1fr;
                    gap: 20px;
                }
                .left-side {
                    align-items: center;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card-wrapper">
                <div class="card">
                    <div class="content">
                        <div class="left-side">
                            <h1 class="code">404</h1>
                            <span class="error-label">Not Found</span>
                        </div>
                        
                        <div class="right-side">
                            <div class="terminal-box">
                                <div class="terminal-dots">
                                    <div class="dot"></div>
                                    <div class="dot"></div>
                                    <div class="dot"></div>
                                </div>
                                <div class="terminal-route">
                                    <span class="method">GET</span>
                                    <span class="route-path" id="display-path">/</span>
                                </div>
                            </div>

                            <div class="actions">
                                <a href="/" class="btn btn-primary">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                                    Home
                                </a>
                                <button id="retry-btn" class="btn btn-secondary">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                                    Retry
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="footer">
                        <span>Nytlex.js</span>
                        <div class="status">
                            <div class="status-dot"></div>
                            <span style="color: var(--text-main);">404</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <a href="https://npmjs.com/package/nytlex" target="_blank" rel="noopener noreferrer" class="brand-link">
                <img src="https://raw.githubusercontent.com/murillo-frazao-cunha/nytlex-docs/master/public/favicon-dark.svg" alt="Nytlex Logo" style="width: 24px; height: 24px;" />
                <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">Nytlex.js</span>
            </a>
        </div>

        <script>
            document.getElementById('display-path').textContent = window.location.pathname;

            document.getElementById('retry-btn').addEventListener('click', () => {
                window.location.reload();
            });
        </script>
    </body>
    </html>
    `;
}

module.exports = { getDefaultNotFound };