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
import {
    provide,
    inject,
    ref,
    onMounted,
    onUnmounted,
    type InjectionKey,
    type Ref
} from 'vue';
import type { Session, SessionContextType, SignInOptions, SignInResult, User } from '../types';
import { router } from "nytlex/vue";

// Chave de injeção para o TypeScript
export const SessionKey: InjectionKey<SessionContextType> = Symbol('SessionKey');

export interface SessionProviderProps {
    basePath: string;
    refetchInterval: number;
    refetchOnWindowFocus: boolean;
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

/**
 * Composable que contém toda a lógica do SessionProvider.
 * Deve ser chamado dentro do setup do componente.
 */
export function useSessionProviderLogic(props: SessionProviderProps) {
    // Estado reativo
    const session = ref<Session | null>(null);
    const status = ref<'loading' | 'authenticated' | 'unauthenticated'>('loading');

    // Fetch da sessão atual
    const fetchSession = async (): Promise<Session | null> => {
        try {
            const response = await fetch(`${props.basePath}/session`, {
                credentials: 'include'
            });

            if (!response.ok) {
                status.value = 'unauthenticated';
                session.value = null;
                return null;
            }

            const data = await response.json();
            const sessionData = data.session;

            if (sessionData) {
                session.value = sessionData;
                status.value = 'authenticated';
                return sessionData;
            } else {
                session.value = null;
                status.value = 'unauthenticated';
                return null;
            }
        } catch (error) {
            console.error('[nytlex-auth] Error fetching session:', error);
            session.value = null;
            status.value = 'unauthenticated';
            return null;
        }
    };

    // SignIn function
    const signIn = async (
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
                    const startRes = await fetch(`${props.basePath}/passkeys/login/start`, {
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

            const response = await fetch(`${props.basePath}/signin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    provider,
                    ...credentials
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                if (data.type === 'oauth' && data.redirectUrl) {
                    if (popup && typeof window !== 'undefined') {
                        // Abre em popup
                        return await openOAuthPopup(data.redirectUrl, provider, fetchSession, redirect);
                    } else if (redirect && typeof window !== 'undefined') {
                        window.location.href = data.redirectUrl;
                    }
                    return { ok: true, status: 200, url: data.redirectUrl };
                }

                // Se é sessão (credentials/passkeys), atualiza e redireciona
                await fetchSession();
                if (data.type === 'session') {
                    const finalUrl = callbackUrl || '/';
                    if (redirect && typeof window !== 'undefined') {
                        try {
                            if (router && typeof router.push === 'function') {
                                router.push(finalUrl);
                            } else {
                                window.location.href = finalUrl;
                            }
                        } catch (e) {
                            window.location.href = finalUrl;
                        }
                    }
                    return { ok: true, status: 200, url: finalUrl };
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
            return { error: 'Network error', status: 500, ok: false };
        }
    };

    // SignOut function
    const signOut = async (options: { callbackUrl?: string } = {}): Promise<void> => {
        try {
            await fetch(`${props.basePath}/signout`, {
                method: 'POST',
                credentials: 'include'
            });

            session.value = null;
            status.value = 'unauthenticated';

            if (typeof window !== 'undefined') {
                const url = options.callbackUrl || '/';
                try {
                    if (router && typeof router.push === 'function') {
                        router.push(url);
                    } else {
                        window.location.href = url;
                    }
                } catch (e) {
                    window.location.href = url;
                }
            }
        } catch (error) {
            console.error('[nytlex-auth] Error on signOut:', error);
        }
    };

    const update = async (): Promise<Session | null> => {
        return await fetchSession();
    };

    // Ciclo de vida e Listeners
    onMounted(() => {
        fetchSession();

        // Refetch Interval
        let intervalId: ReturnType<typeof setInterval> | null = null;
        if (props.refetchInterval > 0) {
            intervalId = setInterval(() => {
                if (status.value === 'authenticated') {
                    fetchSession();
                }
            }, props.refetchInterval * 1000);
        }

        // Refetch on Focus
        const handleFocus = () => {
            if (props.refetchOnWindowFocus && status.value === 'authenticated') {
                fetchSession();
            }
        };

        if (props.refetchOnWindowFocus) {
            window.addEventListener('focus', handleFocus);
        }

        onUnmounted(() => {
            if (intervalId) clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
        });
    });

    // Fornece o contexto para os filhos
    provide(SessionKey, {
        data: session as unknown as Session | null,
        status: status as unknown as any,
        signIn,
        signOut,
        update
    });

    return { session, status };
}

/**
 * Hook para acessar a sessão atual
 */
export function useSession(): SessionContextType {
    const context = inject(SessionKey);
    if (!context) {
        throw new Error('useSession must be used inside a SessionProvider');
    }
    return context;
}

/**
 * Hook para verificar autenticação
 */
export function useAuth(): { user: User | null; isAuthenticated: boolean; isLoading: boolean } {
    const context = useSession();

    // Tratando Refs injetadas
    const sessionData = (context.data as unknown as Ref<Session | null>).value;
    const statusVal = (context.status as unknown as Ref<string>).value;

    return {
        user: sessionData?.user || null,
        isAuthenticated: statusVal === 'authenticated',
        isLoading: statusVal === 'loading'
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