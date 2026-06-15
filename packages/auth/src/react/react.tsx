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
import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { Session, SessionContextType, SignInOptions, SignInResult, User } from '../types';
import { router } from "nytlex/react";

const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
    children: ReactNode;
    basePath?: string;
    refetchInterval?: number;
    refetchOnWindowFocus?: boolean;
}

/**
 * Abre OAuth em popup e aguarda o resultado
 */
function openOAuthPopup(
    url: string,
    provider: string,
    fetchSession: () => Promise<Session | null>,
    redirect: boolean
): Promise<SignInResult> {
    return new Promise((resolve, reject) => {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
            url,
            `oauth-${provider}`,
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes`
        );

        if (!popup) {
            resolve({
                error: 'Popup blocked',
                status: 400,
                ok: false
            });
            return;
        }

        // Verifica se o popup foi fechado manualmente
        const checkPopupClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                resolve({
                    error: 'Popup closed',
                    status: 400,
                    ok: false
                });
            }
        }, 500);

        // Listener para mensagens do popup
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === 'oauth-success' && event.data?.provider === provider) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                popup.close();

                // Atualiza a sessão
                await fetchSession();

                if (redirect && typeof window !== 'undefined') {
                    window.location.href = event.data.callbackUrl || '/';
                }

                resolve({
                    ok: true,
                    status: 200,
                    url: event.data.callbackUrl || '/'
                });
            } else if (event.data?.type === 'oauth-error' && event.data?.provider === provider) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                popup.close();

                resolve({
                    error: event.data.error || 'Authentication failed',
                    status: 401,
                    ok: false
                });
            }
        };

        window.addEventListener('message', handleMessage);
    });
}

export function SessionProvider({
    children,
    basePath = '/api/auth',
    refetchInterval = 0,
    refetchOnWindowFocus = true
}: SessionProviderProps) {
    const [session, setSession] = useState<Session | null>(null);
    const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

    // Fetch da sessão atual
    const fetchSession = useCallback(async (): Promise<Session | null> => {
        try {
            const response = await fetch(`${basePath}/session`, {
                credentials: 'include'
            });

            if (!response.ok) {
                setStatus('unauthenticated');
                return null;
            }

            const data = await response.json();
            const sessionData = data.session;

            if (sessionData) {
                setSession(sessionData);
                setStatus('authenticated');
                return sessionData;
            } else {
                setSession(null);
                setStatus('unauthenticated');
                return null;
            }
        } catch (error) {
            console.error('[nytlex-auth] Error fetching session:', error);
            setSession(null);
            setStatus('unauthenticated');
            return null;
        }
    }, [basePath]);

    // SignIn function
    const signIn = useCallback(async (
        provider: string = 'credentials',
        options: SignInOptions = {}
    ): Promise<SignInResult | undefined> => {
        try {
            const { redirect = true, callbackUrl, popup = false, ...credentials } = options;

            // --- INÍCIO DA INTERCEPTAÇÃO PASSKEYS ---
            if (provider === 'passkeys') {
                try {
                    // 1. Pede ao backend as opções de desafio para login (SEM username)
                    // Com discoverable credentials, o navegador mostra as keys disponíveis
                    const startRes = await fetch(`${basePath}/passkeys/login/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });

                    if (!startRes.ok) {
                        const errData = await startRes.json().catch(() => ({}));
                        return { error: errData.error || 'Failed to start passkey login', status: startRes.status, ok: false };
                    }

                    const { options, sessionId } = await startRes.json();

                    if (!sessionId) {
                        return { error: 'No session ID received from server', status: 500, ok: false };
                    }

                    // 2. Importa dinamicamente para não quebrar em SSR e chama o navegador (FaceID, TouchID, etc)
                    // O navegador mostrará as credenciais disponíveis automaticamente
                    const { startAuthentication } = await import('@simplewebauthn/browser');
                    const asseResp = await startAuthentication(options);

                    // 3. Injeta a resposta assinada e o sessionId no credentials para seguir o fluxo normal do signIn
                    credentials.response = JSON.stringify(asseResp);
                    credentials.sessionId = sessionId;

                } catch (error: any) {
                    console.error('[nytlex-auth] Error during passkey login flow:', error);
                    return { error: error.message || 'Passkey authentication failed', status: 400, ok: false };
                }
            }
            // --- FIM DA INTERCEPTAÇÃO PASSKEYS ---

            const response = await fetch(`${basePath}/signin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    provider,
                    ...credentials,
                    popup
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Se é OAuth, redireciona para URL fornecida ou abre popup
                if (data.type === 'oauth' && data.redirectUrl) {
                    if (popup && typeof window !== 'undefined') {
                        // Abre em popup
                        return await openOAuthPopup(data.redirectUrl, provider, fetchSession, redirect);
                    } else if (redirect && typeof window !== 'undefined') {
                        window.location.href = data.redirectUrl;
                    }

                    return {
                        ok: true,
                        status: 200,
                        url: data.redirectUrl
                    };
                }

                // Se é sessão (credentials/passkeys), atualiza e redireciona
                await fetchSession();
                if (data.type === 'session') {
                    if (redirect && typeof window !== 'undefined') {
                        window.location.href = callbackUrl || '/';
                    }

                    return {
                        ok: true,
                        status: 200,
                        url: callbackUrl || '/'
                    };
                }
            } else {
                return {
                    error: data.error || 'Authentication failed',
                    status: response.status,
                    ok: false
                };
            }
        } catch (error) {
            console.error('[nytlex-auth] Error on signIn:', error);
            return {
                error: 'Network error',
                status: 500,
                ok: false
            };
        }
    }, [basePath, fetchSession]);

    // SignOut function
    const signOut = useCallback(async (options: { callbackUrl?: string } = {}): Promise<void> => {
        try {
            await fetch(`${basePath}/signout`, {
                method: 'POST',
                credentials: 'include'
            });

            setSession(null);
            setStatus('unauthenticated');

            if (typeof window !== 'undefined') {
                try {
                    router.push(options.callbackUrl || '/');
                } catch (e) {
                    window.location.href = options.callbackUrl || '/';
                }
            }
        } catch (error) {
            console.error('[nytlex-auth] Error on signOut:', error);
        }
    }, [basePath]);

    // Update session
    const update = useCallback(async (): Promise<Session | null> => {
        return await fetchSession();
    }, [fetchSession]);

    // Initial session fetch
    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // Refetch interval
    useEffect(() => {
        if (refetchInterval > 0) {
            const interval = setInterval(() => {
                if (status === 'authenticated') {
                    fetchSession();
                }
            }, refetchInterval * 1000);

            return () => clearInterval(interval);
        }
    }, [refetchInterval, status, fetchSession]);

    // Refetch on window focus
    useEffect(() => {
        if (refetchOnWindowFocus) {
            const handleFocus = () => {
                if (status === 'authenticated') {
                    fetchSession();
                }
            };

            window.addEventListener('focus', handleFocus);
            return () => window.removeEventListener('focus', handleFocus);
        }
    }, [refetchOnWindowFocus, status, fetchSession]);

    const value: SessionContextType = {
        data: session,
        status,
        signIn,
        signOut,
        update
    };

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
}

/**
 * Hook para acessar a sessão atual
 */
export function useSession(): SessionContextType {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error('useSession must be used inside a SessionProvider');
    }
    return context;
}

/**
 * Hook para verificar se o usuário está autenticado
 */
export function useAuth(): { user: User | null; isAuthenticated: boolean; isLoading: boolean } {
    const { data: session, status } = useSession();

    return {
        user: session?.user || null,
        isAuthenticated: status === 'authenticated',
        isLoading: status === 'loading'
    };
}

/**
 * Função utilitária para registrar uma nova Passkey (WebAuthn).
 * Pode ser usada em painéis de "Configurações de Conta" pelo desenvolvedor.
 */
export async function registerPasskey(
    username: string, 
    name?: string,
    basePath: string = '/api/auth'
): Promise<{ success: boolean; error?: string }> {
    try {
        const { startRegistration } = await import('@simplewebauthn/browser');

        // 1. Pega as opções do servidor
        const startRes = await fetch(`${basePath}/passkeys/register/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        if (!startRes.ok) {
            const errData = await startRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to start passkey registration');
        }

        const options = await startRes.json();

        // 2. Chama a biometria/PIN do dispositivo
        const attResp = await startRegistration(options);

        // 3. Envia o resultado de volta pro servidor validar e salvar
        const finishRes = await fetch(`${basePath}/passkeys/register/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, response: attResp, name })
        });

        const result = await finishRes.json();
        
        if (result.success) {
            return { success: true };
        } else {
            return { success: false, error: result.error || 'Verification failed on server' };
        }
    } catch (error: any) {
        console.error('[nytlex-auth] Error during passkey registration:', error);
        return { success: false, error: error.message || 'Passkey registration failed' };
    }
}