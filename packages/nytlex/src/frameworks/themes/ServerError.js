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

function formatUnknownError(error) {
    if (!error) return { message: 'Erro desconhecido no SSR.' };

    if (error instanceof Error) {
        return { message: error.message || String(error), stack: error.stack };
    }

    if (typeof error === 'string') {
        return { message: error };
    }

    try {
        return { message: JSON.stringify(error, null, 2) };
    } catch {
        return { message: String(error) };
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getServerErrorHtml(options = {}) {
    const title = options.title || 'SSR Error';
    const { message, stack } = formatUnknownError(options.error);
    const hint = options.hint;
    const requestUrl = options.requestUrl;

    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const safeStack = escapeHtml(stack);
    const safeHint = escapeHtml(hint);
    const safeUrl = escapeHtml(requestUrl);

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Nytlex.js | ${safeTitle}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style>
            :root {
                --bg-base-start: #050507;
                --bg-base-end: #09090b;
                
                --bg-card: #0a0a0c;
                --bg-terminal: #050505;
                
                --text-main: #ffffff;
                --text-dim: #71717a;
                --color-accent: #0ea5e9;
                --error-red: #ef4444;
            }

            body {
                margin: 0;
                padding: 0;
                padding: 10px;
                background-color: var(--bg-base-start);
                background-image: linear-gradient(135deg, var(--bg-base-start), var(--bg-base-end));
                font-family: 'Inter', system-ui, sans-serif;
                color: var(--text-main);
                box-sizing: border-box;
                display: flex;
                justify-content: center;
                align-items: center;
            }

            .container {
                display: flex;
                flex-direction: column;
                align-items: center;
                width: 100%;
                z-index: 2;
                padding: 24px;
                box-sizing: border-box;
            }

            /* BORDA FAKE DE 3PX COM GRADIENTE ESCURO */
            .card-wrapper {
                width: 100%;
                max-width: 1024px; /* Bem largo pra caber as logs do SSR */
                max-height: 90vh;
                padding: 3px;
                border-radius: 16px;
                background: linear-gradient(135deg, rgb(24, 24, 27), rgb(39, 39, 42), transparent);
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
            }

            /* CARD SEM BORDAS REAIS E SEM SHADOWS */
            .card {
                background-color: var(--bg-card);
                border-radius: 13px;
                padding: 32px 40px;
                width: 100%;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                border: none;
                box-shadow: none;
                flex: 1;
                min-height: 0; /* Essencial pra deixar o terminal scrollar */
            }

            .header-section {
                margin-bottom: 24px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .title-row {
                display: flex;
                align-items: center;
                gap: 16px;
            }

            .badge-error {
                font-size: 11px;
                font-weight: 900;
                color: #ffffff;
                background: var(--error-red);
                padding: 4px 10px;
                border-radius: 6px;
                letter-spacing: 0.05em;
                text-transform: uppercase;
            }

            h1 {
                margin: 0;
                font-size: 1.8rem;
                font-weight: 800;
                letter-spacing: -0.04em;
                background: linear-gradient(to right, #fff, var(--text-dim));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .meta-info {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 16px;
                background: rgba(255, 255, 255, 0.02);
                border-radius: 8px;
            }

            .meta-row {
                display: flex;
                align-items: baseline;
                gap: 12px;
                font-size: 0.85rem;
            }

            .meta-label {
                color: var(--text-dim);
                font-weight: 700;
                font-size: 0.75rem;
                letter-spacing: 0.05em;
                min-width: 80px;
            }

            .meta-value {
                color: var(--color-accent);
                font-family: 'JetBrains Mono', monospace;
                word-break: break-all;
            }

            .terminal-container {
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
                background: var(--bg-terminal);
                border-radius: 8px;
                padding: 24px;
            }

            .terminal-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
            }

            .terminal-dots {
                display: flex;
                gap: 6px;
                opacity: 0.5;
            }

            .dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--text-dim);
            }

            .terminal-title {
                font-size: 0.75rem;
                color: var(--text-dim);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-weight: 600;
            }

            .terminal-body {
                overflow-y: auto;
                color: #f4f4f5;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.85rem;
                line-height: 1.6;
                padding-right: 12px;
            }

            .log-entry {
                color: #ef4444;
                font-weight: 600;
                display: flex;
                gap: 10px;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .arrow {
                color: var(--text-dim);
                user-select: none;
            }

            .stack-trace {
                color: #a1a1aa;
                white-space: pre-wrap;
                word-break: break-all;
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px dashed rgba(255, 255, 255, 0.05);
            }

            /* Custom Scrollbar pro Terminal SSR */
            .terminal-body::-webkit-scrollbar {
                width: 10px;
            }
            .terminal-body::-webkit-scrollbar-track {
                background: transparent;
            }
            .terminal-body::-webkit-scrollbar-thumb {
                background: #27272a;
                border-radius: 10px;
                border: 3px solid var(--bg-terminal);
            }
            .terminal-body::-webkit-scrollbar-thumb:hover {
                background: #3f3f46;
            }

            .footer {
                margin-top: 24px;
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
                background-color: var(--error-red);
                border-radius: 50%;
                animation: pulse-dot 1.5s infinite;
            }

            @keyframes pulse-dot {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }
            }

            .brand-link {
                margin-top: 32px;
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
                    
                    <div class="header-section">
                        <div class="title-row">
                            <span class="badge-error">SSR FAILED</span>
                            <h1>${safeTitle}</h1>
                        </div>

                        ${(safeUrl || safeHint) ? `
                            <div class="meta-info">
                                ${safeUrl ? `
                                    <div class="meta-row">
                                        <span class="meta-label">ROUTE</span>
                                        <span class="meta-value">${safeUrl}</span>
                                    </div>
                                ` : ''}
                                ${safeHint ? `
                                    <div class="meta-row">
                                        <span class="meta-label">HINT</span>
                                        <span class="meta-value" style="color: #f4f4f5;">${safeHint}</span>
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>

                    <div class="terminal-container">
                        <div class="terminal-header">
                            <div class="terminal-dots">
                                <div class="dot"></div>
                                <div class="dot"></div>
                                <div class="dot"></div>
                            </div>
                            <span class="terminal-title">Server Exception Trace</span>
                        </div>

                        <div class="terminal-body">
                            <div class="log-entry">
                                <span class="arrow">></span> 
                                <span>${safeMessage}</span>
                            </div>

                            ${safeStack ? `
                                <div class="stack-trace">${safeStack}</div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="footer">
                        <span>Nytlex.js</span>
                        <div class="status">
                            <div class="status-dot"></div>
                            <span style="color: var(--text-main);">Render Offline</span>
                        </div>
                    </div>

                </div>
            </div>

            <a href="https://npmjs.com/package/nytlex" target="_blank" rel="noopener noreferrer" class="brand-link">
                <img src="https://raw.githubusercontent.com/murillo-frazao-cunha/nytlex-docs/master/public/favicon-dark.svg" alt="Nytlex Logo" style="width: 20px; height: 20px;" />
                <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.02em;">Nytlex.js</span>
            </a>
        </div>
    </body>
    </html>
    `;
}

module.exports = { getServerErrorHtml };