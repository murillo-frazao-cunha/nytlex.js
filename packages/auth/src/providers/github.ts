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
import type {AuthProviderClass, AuthRoute, User} from '../types';
import {NytlexRequest, NytlexResponse} from 'nytlex';

export interface GithubConfig {
    id?: string;
    name?: string;
    clientId: string;
    clientSecret: string;
    callbackUrl?: string;
    successUrl?: string;
    // Escopos OAuth do GitHub, padrão: ['read:user', 'user:email']
    scope?: string[];
}

/**
 * Provider para autenticação com GitHub OAuth2
 *
 * Este provider permite autenticação usando GitHub.
 * Automaticamente gerencia o fluxo OAuth completo e rotas necessárias.
 *
 * Exemplo de uso:
 * ```typescript
 * new GithubProvider({
 * clientId: process.env.GITHUB_CLIENT_ID!,
 * clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 * callbackUrl: "http://localhost:3000/api/auth/callback/github"
 * })
 * ```
 *
 * Fluxo de autenticação:
 * 1. GET /api/auth/signin/github - Gera URL e redireciona para GitHub
 * 2. GitHub redireciona para /api/auth/callback/github com código
 * 3. Provider troca código por token e busca dados do usuário
 * 4. Retorna objeto User com dados do GitHub
 */
export class GithubProvider implements AuthProviderClass {
    public readonly id: string;
    public readonly name: string;
    public readonly type: string = 'github';

    private config: GithubConfig;
    private readonly defaultScope = [
        'read:user',
        'user:email'
    ];

    constructor(config: GithubConfig) {
        this.config = config;
        this.id = config.id || 'github';
        this.name = config.name || 'GitHub';
    }

    /**
     * Método para gerar URL OAuth (usado pelo handleSignIn)
     */
    handleOauth(credentials: Record<string, string> = {}): string {
        return this.getAuthorizationUrl(credentials.popup === 'true');
    }

    /**
     * Método principal - redireciona para OAuth ou processa o callback
     */
    async handleSignIn(credentials: Record<string, string>): Promise<User | string | null> {
        // Se tem código, é o callback - processa a autenticação
        if (credentials.code) {
            return await this.processOAuthCallback(credentials);
        }

        // Se não tem código, é o início do OAuth - retorna a URL
        return this.handleOauth(credentials);
    }

    /**
     * Processa o callback do OAuth (troca o código pelo usuário)
     */
    private async processOAuthCallback(credentials: Record<string, string>): Promise<User | null> {
        try {
            const { code } = credentials;
            if (!code) {
                throw new Error('Authorization code not provided');
            }

            // Troca o código por um access token
            // Nota: O GitHub requer o header Accept: application/json para retornar JSON
            const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    code,
                    redirect_uri: this.config.callbackUrl || undefined,
                }),
            });

            if (!tokenResponse.ok) {
                const error = await tokenResponse.text();
                throw new Error(`Failed to exchange code for token: ${error}`);
            }

            const tokens = await tokenResponse.json();

            if (tokens.error) {
                throw new Error(`GitHub Token Error: ${tokens.error_description || tokens.error}`);
            }

            // Busca os dados do usuário com o access token
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch user data');
            }

            const githubUser = await userResponse.json();

            // Lógica específica do GitHub: O email pode ser privado e não vir no objeto user principal
            let email = githubUser.email;

            if (!email) {
                try {
                    const emailsResponse = await fetch('https://api.github.com/user/emails', {
                        headers: {
                            'Authorization': `Bearer ${tokens.access_token}`,
                            'Accept': 'application/vnd.github.v3+json',
                        },
                    });

                    if (emailsResponse.ok) {
                        const emails: any[] = await emailsResponse.json();
                        // Tenta pegar o email primário e verificado, ou o primeiro disponível
                        const primaryEmail = emails.find((e: any) => e.primary && e.verified) ||
                            emails.find((e: any) => e.verified) ||
                            emails[0];

                        if (primaryEmail) {
                            email = primaryEmail.email;
                        }
                    }
                } catch (emailError) {
                    console.warn(`[${this.id} Provider] Could not fetch private emails`, emailError);
                }
            }

            // Retorna o objeto User padronizado
            return {
                id: String(githubUser.id), // GitHub retorna ID numérico
                name: githubUser.name || githubUser.login, // Fallback para o username se não tiver nome configurado
                email: email,
                image: githubUser.avatar_url || null,
                provider: this.id,
                providerId: String(githubUser.id),
                accessToken: tokens.access_token,
                // GitHub geralmente não retorna refresh tokens em Apps OAuth padrão (web flow)
                // a menos que especificamente configurado, mas mantemos o campo se vier
                refreshToken: tokens.refresh_token || undefined
            };

        } catch (error) {
            console.error(`[${this.id} Provider] Error during OAuth callback:`, error);
            return null;
        }
    }

    /**
     * Rotas adicionais específicas do GitHub OAuth
     */
    public additionalRoutes: AuthRoute[] = [
        // Rota de callback do GitHub
        {
            method: 'GET',
            path: '/api/auth/callback/github',
            handler: async (req: NytlexRequest, params: any) => {
                const url = new URL(req.url || '', 'http://localhost');
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');

                // Detecta se é modo popup pela state
                const isPopup = state?.includes('popup=true');

                if (!code) {
                    if (isPopup) {
                        return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Authorization+code+not+provided&provider=github`);
                    }
                    return NytlexResponse.json({ error: 'Authorization code not provided' }, { status: 400 });
                }

                try {
                    // Delega o 'code' para o endpoint de signin principal
                    const authResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/auth/signin`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            provider: this.id,
                            code,
                        })
                    });

                    if (authResponse.ok) {
                        const setCookieHeader = authResponse.headers.get('set-cookie');

                        // Se é popup, redireciona para popup-callback
                        if (isPopup) {
                            const callbackUrl = this.config.successUrl || '/';
                            return NytlexResponse
                                .redirect(`/api/auth/popup-callback?success=true&provider=github&callbackUrl=${encodeURIComponent(callbackUrl)}`)
                                .header('Set-Cookie', setCookieHeader || '');
                        }

                        // Comportamento normal
                        if(this.config.successUrl) {
                            return NytlexResponse
                                .redirect(this.config.successUrl)
                                .header('Set-Cookie', setCookieHeader || '');
                        }
                        return NytlexResponse.json({ success: true })
                            .header('Set-Cookie', setCookieHeader || '');
                    } else {
                        const errorText = await authResponse.text();
                        console.error(`[${this.id} Provider] Session creation failed during callback. Status: ${authResponse.status}, Body: ${errorText}`);

                        if (isPopup) {
                            return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Session+creation+failed&provider=github`);
                        }
                        return NytlexResponse.json({ error: 'Session creation failed' }, { status: 500 });
                    }

                } catch (error) {
                    console.error(`[${this.id} Provider] Callback handler fetch error:`, error);
                    if (isPopup) {
                        return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Internal+server+error&provider=github`);
                    }
                    return NytlexResponse.json({ error: 'Internal server error' }, { status: 500 });
                }
            }
        }
    ];

    /**
     * Gera a URL de autorização do GitHub
     */
    getAuthorizationUrl(isPopup: boolean = false): string {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.callbackUrl || '',
            scope: (this.config.scope || this.defaultScope).join(' '),
            // GitHub não usa 'response_type=code' explicitamente na URL padrão, mas aceita.
            // O padrão é web application flow.
        });

        // Adiciona state para indicar modo popup
        if (isPopup) {
            params.set('state', `popup=true&timestamp=${Date.now()}`);
        }

        return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }

    /**
     * Retorna a configuração pública do provider
     */
    getConfig(): any {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            clientId: this.config.clientId, // Público
            scope: this.config.scope || this.defaultScope,
            callbackUrl: this.config.callbackUrl
        };
    }
}