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

export interface DiscordConfig {
    id?: string;
    name?: string;
    clientId: string;
    clientSecret: string;
    callbackUrl?: string;
    successUrl?: string;
    // Escopos OAuth, padrão: ['identify', 'email']
    scope?: string[];
}

/**
 * Provider para autenticação com Discord OAuth2
 *
 * Este provider permite autenticação usando Discord OAuth2.
 * Automaticamente gerencia o fluxo OAuth completo e rotas necessárias.
 *
 * Exemplo de uso:
 * ```typescript
 * new DiscordProvider({
 * clientId: process.env.DISCORD_CLIENT_ID!,
 * clientSecret: process.env.DISCORD_CLIENT_SECRET!,
 * callbackUrl: "http://localhost:3000/api/auth/callback/discord"
 * })
 * ```
 *
 * Fluxo de autenticação:
 * 1. GET /api/auth/signin/discord - Gera URL e redireciona para Discord
 * 2. Discord redireciona para /api/auth/callback/discord com código
 * 3. Provider troca código por token e busca dados do usuário
 * 4. Retorna objeto User com dados do Discord
 */
export class DiscordProvider implements AuthProviderClass {
    public readonly id: string;
    public readonly name: string;
    public readonly type: string = 'discord';

    private config: DiscordConfig;
    private readonly defaultScope = ['identify', 'email'];

    constructor(config: DiscordConfig) {
        this.config = config;
        this.id = config.id || 'discord';
        this.name = config.name || 'Discord';
    }

    /**
     * Método para gerar URL OAuth (usado pelo handleSignIn)
     */
    handleOauth(credentials: Record<string, string> = {}): string {
        return this.getAuthorizationUrl(credentials.popup === 'true');
    }

    /**
     * Método principal - agora redireciona para OAuth ou processa callback
     */
    async handleSignIn(credentials: Record<string, string>): Promise<User | string | null> {
        // Se tem código, é callback - processa autenticação
        if (credentials.code) {
            return await this.processOAuthCallback(credentials);
        }

        // Se não tem código, é início do OAuth - retorna URL
        return this.handleOauth(credentials);
    }

    /**
     * Processa o callback OAuth (código → usuário)
     */
    private async processOAuthCallback(credentials: Record<string, string>): Promise<User | null> {
        try {
            const { code } = credentials;
            if (!code) {
                throw new Error('Authorization code not provided');
            }


            // Troca o código por access token
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: this.config.callbackUrl || '',
                }),
            });

            if (!tokenResponse.ok) {
                const error = await tokenResponse.text();
                // O erro original "Invalid \"code\" in request." acontece aqui.
                throw new Error(`Failed to exchange code for token: ${error}`);
            }

            const tokens = await tokenResponse.json();

            // Busca dados do usuário
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch user data');
            }

            const discordUser = await userResponse.json();

            // Retorna objeto User padronizado
            return {
                id: discordUser.id,
                name: discordUser.global_name || discordUser.username,
                email: discordUser.email,
                image: discordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                    : null,
                username: discordUser.username,
                discriminator: discordUser.discriminator,
                provider: this.id,
                providerId: discordUser.id,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token
            };

        } catch (error) {
            console.error(`[${this.id} Provider] Error during OAuth callback:`, error);
            return null;
        }
    }

    /**
     * Rotas adicionais específicas do Discord OAuth
     */
    public additionalRoutes: AuthRoute[] = [
        // Rota de callback do Discord
        {
            method: 'GET',
            path: '/api/auth/callback/discord',
            handler: async (req: NytlexRequest, params: any) => {
                const url = new URL(req.url || '', 'http://localhost');
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');

                // Detecta se é modo popup pela state
                const isPopup = state?.includes('popup=true');

                if (!code) {
                    if (isPopup) {
                        return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Authorization+code+not+provided&provider=discord`);
                    }
                    return NytlexResponse.json({ error: 'Authorization code not provided' }, { status: 400 });
                }

                try {
                    // CORREÇÃO: O fluxo correto é delegar o 'code' para o endpoint de signin
                    // principal, que processará o código uma única vez. A implementação anterior
                    // usava o código duas vezes, causando o erro 'invalid_grant'.
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
                                .redirect(`/api/auth/popup-callback?success=true&provider=discord&callbackUrl=${encodeURIComponent(callbackUrl)}`)
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
                            return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Session+creation+failed&provider=discord`);
                        }
                        return NytlexResponse.json({ error: 'Session creation failed' }, { status: 500 });
                    }

                } catch (error) {
                    console.error(`[${this.id} Provider] Callback handler fetch error:`, error);
                    if (isPopup) {
                        return NytlexResponse.redirect(`/api/auth/popup-callback?success=false&error=Internal+server+error&provider=discord`);
                    }
                    return NytlexResponse.json({ error: 'Internal server error' }, { status: 500 });
                }
            }
        }
    ];

    /**
     * Gera URL de autorização do Discord
     */
    getAuthorizationUrl(isPopup: boolean = false): string {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.callbackUrl || '',
            response_type: 'code',
            scope: (this.config.scope || this.defaultScope).join(' ')
        });

        // Adiciona state para indicar modo popup
        if (isPopup) {
            params.set('state', `popup=true&timestamp=${Date.now()}`);
        }

        return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    }

    /**
     * Retorna configuração pública do provider
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
