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

class NytlexErrorModal extends HTMLElement {
    constructor() {
        super();
        this._error = null;
        this._isOpen = false;

        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.closeModal = this.closeModal.bind(this);
        this.copyLog = this.copyLog.bind(this);
    }

    set error(val) {
        this._error = val;
        this.render();
    }

    get error() {
        return this._error;
    }

    set isOpen(val) {
        this._isOpen = val;
        if (val) {
            document.body.style.overflow = 'hidden';
            window.addEventListener('keydown', this.handleKeyDown);
        } else {
            document.body.style.overflow = '';
            window.removeEventListener('keydown', this.handleKeyDown);
        }
        this.render();
    }

    get isOpen() {
        return this._isOpen;
    }

    handleKeyDown(e) {
        if (e.key === 'Escape' && this._isOpen) {
            this.closeModal();
        }
    }

    closeModal() {
        this.dispatchEvent(new CustomEvent('close-modal', { bubbles: true, composed: true }));
    }

    copyLog() {
        this.dispatchEvent(new CustomEvent('copy-log', { bubbles: true, composed: true }));
    }

    parseAnsi(text) {
        if (!text) return '';
        const ANSI_COLORS = {
            '30': '#71717a', '31': '#ef4444', '32': '#22c55e',
            '33': '#eab308', '34': '#3b82f6', '35': '#d946ef',
            '36': '#06b6d4', '37': '#f4f4f5', '90': '#52525b',
        };

        const regex = /\u001b\[(\d+)(?:;\d+)*m/g;
        let result = '';
        let lastIndex = 0;
        let match;
        let currentColor = null;

        while ((match = regex.exec(text)) !== null) {
            const rawText = text.slice(lastIndex, match.index);
            if (rawText) {
                result += currentColor ? `<span style="color: ${currentColor}">${this.escapeHtml(rawText)}</span>` : this.escapeHtml(rawText);
            }

            const code = match[1];
            if (code === '39' || code === '0') {
                currentColor = null;
            } else if (ANSI_COLORS[code]) {
                currentColor = ANSI_COLORS[code];
            }

            lastIndex = regex.lastIndex;
        }

        const remaining = text.slice(lastIndex);
        if (remaining) {
            result += currentColor ? `<span style="color: ${currentColor}">${this.escapeHtml(remaining)}</span>` : this.escapeHtml(remaining);
        }

        return result;
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    render() {
        if (!this._isOpen || !this._error) {
            this.innerHTML = '';
            return;
        }

        const rawOutput = this._error.message || '';
        const stackOutput = this._error.stack ? `\n\nStack Trace:\n${this._error.stack}` : '';

        const parsedMessage = this.parseAnsi(rawOutput);
        const parsedStack = this.parseAnsi(stackOutput);

        this.innerHTML = `
            <style>
                .nytlex-modal-overlay {
                    position: fixed; 
                    top: 0; left: 0; 
                    width: 100vw; height: 100vh;
                    z-index: 2147483647;
                    background: rgba(0, 0, 0, 0.85);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    display: flex; 
                    align-items: center; 
                    justify-content: center;
                    padding: 24px; 
                    box-sizing: border-box;
                    animation: fadeIn 0.2s ease-out;
                }

                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleUp { from { transform: scale(0.98) translateY(10px); } to { transform: scale(1) translateY(0); } }

                /* BORDA FAKE DE 3PX COM GRADIENTE ESCURO */
                .nytlex-card-wrapper {
                    width: 100%; 
                    max-width: 960px; 
                    max-height: 90vh; /* Controla o tamanho máximo para não vazar a tela */
                    padding: 3px;
                    border-radius: 16px;
                    background: linear-gradient(135deg, rgb(24, 24, 27), rgb(39, 39, 42), transparent);
                    display: flex;
                    flex-direction: column;
                    animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }

                /* CARD PRINCIPAL SEM BORDAS E SEM SHADOWS */
                .nytlex-modal-card {
                    background: #0a0a0c;
                    border-radius: 13px;
                    display: flex; 
                    flex-direction: column;
                    flex: 1;
                    min-height: 0; /* Essencial para o scroll interno funcionar */
                    overflow: hidden;
                    border: none;
                    box-shadow: none;
                }

                .nytlex-modal-header {
                    padding: 24px 32px; 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                }

                .nytlex-header-left {
                    display: flex; 
                    align-items: center; 
                    gap: 16px;
                }

                .nytlex-badge-error {
                    font-size: 12px; 
                    font-weight: 900; 
                    color: #ffffff;
                    background: #ef4444; 
                    padding: 4px 10px; 
                    border-radius: 6px; 
                    letter-spacing: 0.05em;
                }

                .nytlex-badge-plugin {
                    font-size: 12px; 
                    color: #a1a1aa; 
                    background: #18181b;
                    padding: 4px 10px; 
                    border-radius: 6px; 
                    font-family: 'JetBrains Mono', monospace;
                }

                /* ÁREA DO TERMINAL COMPLETAMENTE REFEITA PARA VISIBILIDADE */
                .nytlex-terminal-container {
                    flex: 1;
                    min-height: 0;
                    padding: 0 32px 32px 32px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                }

                /* Custom Scrollbar pro Terminal */
                .nytlex-terminal-container::-webkit-scrollbar {
                    width: 10px;
                }
                .nytlex-terminal-container::-webkit-scrollbar-track {
                    background: transparent;
                }
                .nytlex-terminal-container::-webkit-scrollbar-thumb {
                    background: #27272a;
                    border-radius: 10px;
                    border: 3px solid #0a0a0c; /* Borda da mesma cor do fundo para dar espaçamento */
                }
                .nytlex-terminal-container::-webkit-scrollbar-thumb:hover {
                    background: #3f3f46;
                }

                .nytlex-terminal {
                    background: #050505;
                    border-radius: 8px;
                    padding: 24px;
                    margin-top: 24px;
                    font-family: "JetBrains Mono", monospace; 
                    font-size: 13px; 
                    line-height: 1.6;
                    color: #f4f4f5; 
                    white-space: pre-wrap; 
                    word-break: break-word;
                    flex: 1;
                }

                .nytlex-stack {
                    margin-top: 24px; 
                    padding-top: 24px; 
                    border-top: 1px dashed rgba(255, 255, 255, 0.1);
                    color: #a1a1aa;
                }

                .nytlex-footer {
                    padding: 16px 32px; 
                    background: transparent;
                    display: flex; 
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid rgba(255, 255, 255, 0.03);
                    font-size: 12px; 
                    color: #71717a; 
                    font-family: 'Inter', sans-serif;
                }

                .nytlex-btn-group {
                    display: flex; 
                    gap: 12px;
                }

                .nytlex-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 10px 20px; 
                    border-radius: 8px; 
                    font-size: 12px; 
                    font-weight: 600;
                    cursor: pointer; 
                    transition: all 0.2s ease; 
                    border: none; 
                    outline: none; 
                    font-family: 'Inter', system-ui, sans-serif;
                }

                .nytlex-btn-primary { 
                    background: #ffffff; 
                    color: #000000; 
                }
                .nytlex-btn-primary:hover { 
                    opacity: 0.85; 
                    transform: translateY(-1px); 
                }
                
                .nytlex-btn-secondary { 
                    background: #18181b; 
                    color: #ffffff; 
                }
                .nytlex-btn-secondary:hover { 
                    background: #27272a; 
                }
            </style>

            <div class="nytlex-modal-overlay" id="nytlex-overlay">
                <div class="nytlex-card-wrapper" id="nytlex-card-wrapper">
                    <div class="nytlex-modal-card" id="nytlex-card">
                        
                        <div class="nytlex-modal-header">
                            <div class="nytlex-header-left">
                                <span class="nytlex-badge-error">BUILD ERROR</span>
                                ${this._error.plugin ? `<span class="nytlex-badge-plugin">${this._error.plugin}</span>` : ''}
                            </div>

                            <div class="nytlex-btn-group">
                                <button class="nytlex-btn nytlex-btn-secondary" id="nytlex-copy-btn">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    Copy Log
                                </button>
                                <button class="nytlex-btn nytlex-btn-primary" id="nytlex-close-btn">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    Close
                                </button>
                            </div>
                        </div>

                        <div class="nytlex-terminal-container">
                            <div class="nytlex-terminal">${parsedMessage}${parsedStack ? `<div class="nytlex-stack">${parsedStack}</div>` : ''}</div>
                        </div>

                        <div class="nytlex-footer">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                                <span>nytlex-cli</span>
                            </div>
                            <span>Waiting for file changes to rebuild...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const overlay = this.querySelector('#nytlex-overlay');
        const cardWrapper = this.querySelector('#nytlex-card-wrapper');
        const closeBtn = this.querySelector('#nytlex-close-btn');
        const copyBtn = this.querySelector('#nytlex-copy-btn');

        if (overlay) overlay.addEventListener('mousedown', this.closeModal);
        if (cardWrapper) cardWrapper.addEventListener('mousedown', (e) => e.stopPropagation());
        if (closeBtn) closeBtn.addEventListener('click', this.closeModal);
        if (copyBtn) copyBtn.addEventListener('click', this.copyLog);
    }
}

if (typeof window !== 'undefined' && !customElements.get('nytlex-error-modal')) {
    customElements.define('nytlex-error-modal', NytlexErrorModal);
}