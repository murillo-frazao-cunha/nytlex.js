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

class DevBadge extends HTMLElement {
    constructor() {
        super();
        this.isVisible = true;
        this.hotState = 'idle';
        this.hasBuildError = false;

        // Bind dos métodos
        this.handleHotReload = this.handleHotReload.bind(this);
        this.closeBadge = this.closeBadge.bind(this);
        this.handleBadgeClick = this.handleBadgeClick.bind(this);
    }

    static get observedAttributes() {
        return ['has-build-error'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'has-build-error') {
            this.hasBuildError = newValue === 'true';
            this.render();
        }
    }

    connectedCallback() {
        if (typeof window !== 'undefined') {
            window.addEventListener('nytlex:hotreload', this.handleHotReload);
        }
        this.render();
    }

    disconnectedCallback() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('nytlex:hotreload', this.handleHotReload);
        }
    }

    handleHotReload(ev) {
        const detail = ev?.detail;
        if (!detail || !detail.state) return;

        if (detail.state === 'reloading' || detail.state === 'full-reload') {
            this.hotState = 'reloading';
        } else if (detail.state === 'idle') {
            this.hotState = 'idle';
        }
        this.render();
    }

    closeBadge(e) {
        e.stopPropagation();
        this.isVisible = false;
        this.render();
    }

    handleBadgeClick() {
        if (this.hasBuildError) {
            this.dispatchEvent(new CustomEvent('click-build-error', { bubbles: true, composed: true }));
        }
    }

    render() {
        if (!this.isVisible) {
            this.innerHTML = '';
            return;
        }

        const isReloading = this.hotState === 'reloading';
        const isError = this.hasBuildError;

        this.innerHTML = `
            <style>
                @keyframes nytlex-pulse {
                    0% { opacity: 0.3; transform: scale(0.95); }
                    50% { opacity: 1; transform: scale(1.05); }
                    100% { opacity: 0.3; transform: scale(0.95); }
                }

                @keyframes nytlex-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                /* WRAPPER DA BORDA FAKE COM PADDING DE 3PX E GRADIENTE */
                .nytlex-badge-wrapper {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 2147483647; 
                    
                    padding: 2px; /* Padding mágico para a borda */
                    border-radius: 9999px;
                    /* O gradiente exato to-br com zinc-900, zinc-800 e transparent */
                    background: linear-gradient(135deg, rgb(24, 24, 27), rgb(39, 39, 42), transparent);
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .nytlex-badge-wrapper:hover {
                    transform: translateY(-3px) scale(1.02);
                    /* Acende levemente o gradiente de fundo no hover */
                    background: linear-gradient(135deg, rgb(39, 39, 42), rgb(63, 63, 70), transparent);
                }

                .nytlex-dev-badge {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px 16px 8px 14px;
                    background: #0a0a0c; /* Fundo do card interno */
                    border-radius: 9999px;
                    font-family: 'Inter', system-ui, sans-serif;
                    font-size: 12px;
                    letter-spacing: 0.04em;
                    border: none;
                    box-shadow: none;
                    cursor: default;
                    user-select: none;
                }

                .nytlex-dev-badge.clickable {
                    cursor: pointer;
                }

                .nytlex-status-dot {
                    width: 8px;
                    height: 8px;
                    background: #0ea5e9;
                    border-radius: 50%;
                    border: none;
                    animation: nytlex-pulse 2s infinite ease-in-out;
                }

                .nytlex-status-dot.reloading {
                    background: #71717a; 
                    animation: none;
                }

                .nytlex-status-dot.error {
                    background: #ef4444; 
                    animation: nytlex-pulse 1s infinite ease-in-out;
                }

                .nytlex-spinner {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    border: 2px solid rgba(14, 165, 233, 0.15);
                    border-top-color: #0ea5e9;
                    animation: nytlex-spin 0.7s linear infinite;
                }

                .nytlex-logo {
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    background: linear-gradient(to right, #6366f1, #0ea5e9);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .nytlex-logo span.suffix {
                    color: #71717a;
                    -webkit-text-fill-color: #71717a;
                    font-weight: 600;
                }

                .nytlex-error-pill {
                    margin-left: 10px;
                    padding: 2px 8px;
                    border-radius: 6px;
                    background: #ef4444;
                    color: #ffffff;
                    -webkit-text-fill-color: #ffffff;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.1em;
                }

                .close-btn {
                    background: none;
                    border: none;
                    color: #52525b;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: 400;
                    padding: 0;
                    margin-left: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: color 0.2s ease;
                }

                .close-btn:hover {
                    color: #ffffff;
                }
            </style>

            <div class="nytlex-badge-wrapper">
                <div class="nytlex-dev-badge ${isError ? 'clickable' : ''}" id="nytlex-badge-container">
                    ${isReloading ? '<div class="nytlex-spinner"></div>' : `<div class="nytlex-status-dot ${isError ? 'error' : ''}"></div>`}
                    
                    <div class="nytlex-logo">
                        NYTLEX<span class="suffix">.JS</span>
                        ${isError ? '<span class="nytlex-error-pill">ERROR</span>' : ''}
                    </div>

                    <button class="close-btn" id="nytlex-badge-close" aria-label="Close">×</button>
                </div>
            </div>
        `;

        const container = this.querySelector('#nytlex-badge-container');
        const closeBtn = this.querySelector('#nytlex-badge-close');

        if (container) {
            container.addEventListener('click', this.handleBadgeClick);
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', this.closeBadge);
        }
    }
}

if (typeof window !== 'undefined' && !customElements.get('nytlex-dev-badge')) {
    customElements.define('nytlex-dev-badge', DevBadge);
}