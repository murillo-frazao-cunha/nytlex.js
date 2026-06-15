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
import { NytlexRequest, NytlexResponse } from 'nytlex';
import type { AuthConfig } from './types';
import { NytlexAuth } from './core';

/**
 * Cria o handler catch-all para /api/auth/[...value]
 */
export function createAuthRoutes(config: AuthConfig) {
    const auth = new NytlexAuth(config);

    /**
     * Handler principal que gerencia todas as rotas de auth
     * Uso: /api/auth/[...value].ts
     */
    return {
        pattern: '/api/auth/[...value]',

        async GET(req: NytlexRequest, params: { [key: string]: string }) {

            const path = params["value"];
            const route = Array.isArray(path) ? path.join('/') : path || '';

            // Verifica rotas adicionais dos providers primeiro
            const additionalRoutes = auth.getAllAdditionalRoutes();
            for (const { provider, route: additionalRoute } of additionalRoutes) {

                if (additionalRoute.method === 'GET' && additionalRoute.path.includes(route)) {
                    try {
                        return await additionalRoute.handler(req, params);
                    } catch (error) {
                        console.error(`[${provider} Provider] Error in additional route:`, error);
                        return NytlexResponse.json({ error: 'Provider route error' }, { status: 500 });
                    }
                }
            }

            // Rotas padrão do sistema
            switch (route) {
                case 'session':
                    return await handleSession(req, auth);

                case 'csrf':
                    return await handleCsrf(req);

                case 'providers':
                    return await handleProviders(auth);

                case 'popup-callback':
                    return handlePopupCallback(req);

                default:
                    return NytlexResponse.json({ error: 'Route not found' }, { status: 404 });
            }
        },

        async POST(req: NytlexRequest, params: { [key: string]: string }) {
            const path = params["value"];
            const route = Array.isArray(path) ? path.join('/') : path || '';

            // Verifica rotas adicionais dos providers primeiro
            const additionalRoutes = auth.getAllAdditionalRoutes();
            for (const { provider, route: additionalRoute } of additionalRoutes) {
                if (additionalRoute.method === 'POST' && additionalRoute.path.includes(route)) {
                    try {
                        return await additionalRoute.handler(req, params);
                    } catch (error) {
                        console.error(`[${provider} Provider] Error in additional route:`, error);
                        return NytlexResponse.json({ error: 'Provider route error' }, { status: 500 });
                    }
                }
            }

            // Rotas padrão do sistema
            switch (route) {
                case 'signin':
                    return await handleSignIn(req, auth);

                case 'signout':
                    return await handleSignOut(req, auth);

                default:
                    return NytlexResponse.json({ error: 'Route not found' }, { status: 404 });
            }
        },

        // Instância do auth para uso manual
        auth
    };
}

/**
 * Handler para GET /api/auth/session
 */
async function handleSession(req: NytlexRequest, auth: NytlexAuth) {
    const session = await auth.getSession(req);

    if (!session) {
        return NytlexResponse.json({ session: null });
    }

    return NytlexResponse.json({ session });
}

/**
 * Handler para GET /api/auth/csrf
 */
async function handleCsrf(req: NytlexRequest) {
    // SECURITY: Usa crypto.randomBytes para token criptograficamente seguro
    // 32 bytes = 256 bits de entropia, codificado em base64url (URL-safe)
    const crypto = await import('crypto');
    const csrfToken = crypto.randomBytes(32).toString('base64url');

    return NytlexResponse.json({ csrfToken });
}

/**
 * Handler para GET /api/auth/providers
 */
async function handleProviders(auth: NytlexAuth) {
    const providers = auth.getProviders();

    return NytlexResponse.json({ providers });
}

/**
 * Handler para POST /api/auth/signin
 */
async function handleSignIn(req: NytlexRequest, auth: NytlexAuth) {
    try {
        const { provider = 'credentials', popup, ...credentials } = await req.json();

        // Se popup está definido, passa para os credentials
        const credentialsWithPopup = popup !== undefined
            ? { ...credentials, popup: String(popup) }
            : credentials;

        const result = await auth.signIn(provider, credentialsWithPopup, req);

        if (!result) {
            return NytlexResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Se tem redirectUrl, é OAuth - retorna URL para redirecionamento
        if ('redirectUrl' in result) {
            return NytlexResponse.json({
                success: true,
                redirectUrl: result.redirectUrl,
                type: 'oauth'
            });
        }
        console.log('result:', result);
        // Se tem session, é credentials - retorna sessão
        return auth.createAuthResponse(result.token, {
            success: true,
            user: result.session.user,
            type: 'session'
        });
    } catch (error) {
        console.error('[nytlex-auth] Error on handleSignIn:', error);
        return NytlexResponse.json(
            { error: 'Authentication failed' },
            { status: 500 }
        );
    }
}

/**
 * Handler para GET /api/auth/popup-callback
 * Retorna uma página HTML que envia mensagem para a janela pai e fecha o popup
 */
function handlePopupCallback(req: NytlexRequest) {
    const url = new URL(req.url, 'http://localhost');
    const success = url.searchParams.get('success') === 'true';
    const error = url.searchParams.get('error');
    const provider = url.searchParams.get('provider') || 'unknown';
    const callbackUrl = url.searchParams.get('callbackUrl') || '/';

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Authenticating...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
        }
        .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h2 {
            margin: 0;
            font-size: 24px;
        }
        p {
            margin: 10px 0 0;
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2>${success ? '✓ Autenticação bem-sucedida' : '✗ Erro na autenticação'}</h2>
        <p>${success ? 'Fechando janela...' : (error || 'Algo deu errado')}</p>
    </div>
    <script>
        (function() {
            try {
                if (window.opener) {
                    console.log('Enviando mensagem para janela pai:')
                    window.opener.postMessage({
                        type: ${success ? "'oauth-success'" : "'oauth-error'"},
                        provider: "${provider}",
                        ${success ? `callbackUrl: "${callbackUrl}"` : `error: "${error || 'Authentication failed'}"`}
                    }, window.location.origin);
                }
                setTimeout(() => {
                    window.close();
                }, 1000);
            } catch (e) {
                console.error('Error communicating with parent window:', e);
            }
        })();
    </script>
</body>
</html>
    `;
    return NytlexResponse.html(html);
}

/**
 * Handler para POST /api/auth/signout
 */
async function handleSignOut(req: NytlexRequest, auth: NytlexAuth) {
    return await auth.signOut(req);
}
