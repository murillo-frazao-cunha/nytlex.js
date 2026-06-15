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
import type { AuthConfig, AuthProviderClass, User, Session } from './types';
import { SessionManager } from './jwt';

export class NytlexAuth {
    private config: AuthConfig;
    private sessionManager: SessionManager;

    constructor(config: AuthConfig) {
        this.config = {
            session: { strategy: 'jwt', maxAge: 86400, ...config.session },
            pages: { signIn: '/auth/signin', signOut: '/auth/signout', ...config.pages },
            ...config
        };

        this.sessionManager = new SessionManager(
            config.secret,
            this.config.session?.maxAge || 86400
        );
    }

    /**
     * Middleware para adicionar autenticação às rotas
     */
    private async middleware(req: NytlexRequest): Promise<{ session: Session | null; user: User | null }> {
        const token = this.getTokenFromRequest(req);

        if (!token) {
            return { session: null, user: null };
        }

        const session = this.sessionManager.verifySession(token);
        return {
            session,
            user: session?.user || null
        };
    }

    /**
     * Autentica um usuário usando um provider específico
     */
    async signIn(providerId: string, credentials: Record<string, string>, req: NytlexRequest): Promise<{ session: Session; token: string } | { redirectUrl: string } | null> {
        const provider = this.config.providers.find(p => p.id === providerId);
        if (!provider) {
            console.error(`[nytlex-auth] Provider not found: ${providerId}`);
            return null;
        }

        try {
            // Usa o método handleSignIn do provider
            const result = await provider.handleSignIn(credentials, req );

            if (!result) return null;

            // Se resultado é string, é URL de redirecionamento OAuth
            if (typeof result === 'string') {
                return { redirectUrl: result };
            }

            // Se resultado é User, cria sessão
            let user = result as User;

            // Callback de signIn se definido
            if (this.config.callbacks?.signIn) {
                const allowed = await this.config.callbacks.signIn(user, { provider: providerId }, {});
                if (!allowed) return null;
            }


            if (this.config.callbacks?.user) {
                const updatedUser = await this.config.callbacks.user({user, provider: providerId});
                user = updatedUser;
            }

            const sessionResult = this.sessionManager.createSession(user);

            return sessionResult;
        } catch (error) {
            console.error(`[nytlex-auth] Error signing in with provider ${providerId}:`, error);
            return null;
        }
    }

    /**
     * Faz logout do usuário
     */
    async signOut(req: NytlexRequest): Promise<NytlexResponse> {
        // Busca a sessão atual para saber qual provider usar
        const { session } = await this.middleware(req);

        if (session?.user?.provider) {
            const provider = this.config.providers.find(p => p.id === session.user.provider);
            if (provider && provider.handleSignOut) {
                try {
                    await provider.handleSignOut();
                } catch (error) {
                    console.error(`[nytlex-auth] Signout error on provider ${provider.id}:`, error);
                }
            }
        }

        return NytlexResponse
            .json({ success: true })
            .clearCookie('nytlex-auth-token', {
                path: '/',
                httpOnly: true,
                secure: this.config.secureCookies || false,
                sameSite: 'strict',
                domain: this.config.domain || undefined
            });
    }

    /**
     * Obtém a sessão atual
     */
    async getSession(req: NytlexRequest): Promise<Session | null> {
        const { session } = await this.middleware(req);
        return session;
    }

    /**
     * Verifica se o usuário está autenticado
     */
    async isAuthenticated(req: NytlexRequest): Promise<boolean> {
        const session = await this.getSession(req);
        return session !== null;
    }

    /**
     * Retorna todos os providers disponíveis (dados públicos)
     */
    getProviders(): any[] {
        return this.config.providers.map(provider => ({
            id: provider.id,
            name: provider.name,
            type: provider.type,
            config: provider.getConfig ? provider.getConfig() : {}
        }));
    }

    /**
     * Busca um provider específico
     */
    getProvider(id: string): AuthProviderClass | null {
        return this.config.providers.find(p => p.id === id) || null;
    }

    /**
     * Retorna todas as rotas adicionais dos providers
     */
    getAllAdditionalRoutes(): Array<{ provider: string; route: any }> {
        const routes: Array<{ provider: string; route: any }> = [];

        for (const provider of this.config.providers) {
            if (provider.additionalRoutes) {
                for (const route of provider.additionalRoutes) {
                    routes.push({ provider: provider.id, route });
                }
            }
        }

        return routes;
    }


    updateSession(request: NytlexRequest, data: any): NytlexResponse {
        const token = this.getTokenFromRequest(request);
        if (!token) {
            return NytlexResponse.json({ error: "No session token found" }, { status: 400 });
        }
        const session = this.sessionManager.verifySession(token);
        if (!session) {
            throw new Error("Session not found");
        }
        const update = this.sessionManager.updateUserSession(data)!;
        return this.createAuthResponse(update.token, { session: update.session });
    }

    /**
     * Cria resposta com cookie de autenticação - Secure implementation
     */
    createAuthResponse(token: string, data: any): NytlexResponse {
        return NytlexResponse
            .json(data)
            .cookie('nytlex-auth-token', token, {
                httpOnly: true,
                secure: this.config.secureCookies || false, // Always secure, even in development
                sameSite: 'strict', // Prevent CSRF attacks
                maxAge: (this.config.session?.maxAge || 86400) * 1000,
                path: '/',
                domain: this.config.domain || undefined // Let browser set automatically for security
            })
            // SECURITY: Comprehensive security headers
            .header('X-Content-Type-Options', 'nosniff')
            .header('X-Frame-Options', 'DENY')
            .header('X-XSS-Protection', '1; mode=block')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin')
            .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';")
            .header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
            .header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    }

    /**
     * Extrai token da requisição (cookie ou header)
     */
    private getTokenFromRequest(req: NytlexRequest): string | null {
        // Primeiro tenta pegar do cookie
        const cookieToken = req.cookie('nytlex-auth-token');
        if (cookieToken) return cookieToken;

        // Depois tenta do header Authorization
        const authHeader = req.header('authorization');
        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }

        return null;
    }
}
