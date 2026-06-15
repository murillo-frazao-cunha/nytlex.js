/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 */
import { setContext, getContext, onMount, onDestroy } from 'svelte';
import { writable, derived, get, type Writable, type Readable } from 'svelte/store';
import type { Session, SignInOptions, SignInResult, User } from '../types';
import { router } from "nytlex/svelte"; // Ajustado para o módulo Svelte

// Tipagem do contexto em Svelte
export interface SessionContextType {
    data: Writable<Session | null>;
    status: Writable<'loading' | 'authenticated' | 'unauthenticated'>;
    signIn: (provider?: string, options?: SignInOptions) => Promise<SignInResult | undefined>;
    signOut: (options?: { callbackUrl?: string }) => Promise<void>;
    update: () => Promise<Session | null>;
}

export const SessionKey = Symbol('SessionKey');

export interface SessionProviderProps {
    basePath: string;
    refetchInterval: number;
    refetchOnWindowFocus: boolean;
}

function openOAuthPopup(
    url: string,
    provider: string,
    fetchSession: () => Promise<Session | null>,
    redirect: boolean
): Promise<SignInResult> {
    return new Promise((resolve) => {
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
            resolve({ error: 'Popup blocked', status: 400, ok: false });
            return;
        }

        const checkPopupClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                resolve({ error: 'Popup closed', status: 400, ok: false });
            }
        }, 500);

        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === 'oauth-success' && event.data?.provider === provider) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                popup.close();

                await fetchSession();

                if (redirect && typeof window !== 'undefined') {
                    window.location.href = event.data.callbackUrl || '/';
                }

                resolve({ ok: true, status: 200, url: event.data.callbackUrl || '/' });
            } else if (event.data?.type === 'oauth-error' && event.data?.provider === provider) {
                clearInterval(checkPopupClosed);
                window.removeEventListener('message', handleMessage);
                popup.close();

                resolve({ error: event.data.error || 'Authentication failed', status: 401, ok: false });
            }
        };

        window.addEventListener('message', handleMessage);
    });
}

/**
 * Função que deve ser chamada dentro da tag <script> do SessionProvider.svelte
 */
export function createSessionProvider(props: SessionProviderProps) {
    const session = writable<Session | null>(null);
    const status = writable<'loading' | 'authenticated' | 'unauthenticated'>('loading');

    const fetchSession = async (): Promise<Session | null> => {
        try {
            const response = await fetch(`${props.basePath}/session`, { credentials: 'include' });
            if (!response.ok) throw new Error('Not authenticated');

            const data = await response.json();
            if (data.session) {
                session.set(data.session);
                status.set('authenticated');
                return data.session;
            } else {
                throw new Error('No session data');
            }
        } catch (error) {
            session.set(null);
            status.set('unauthenticated');
            return null;
        }
    };

    const signIn = async (provider: string = 'credentials', options: SignInOptions = {}): Promise<SignInResult | undefined> => {
        try {
            const { redirect = true, callbackUrl, popup = false, ...credentials } = options;

            if (provider === 'passkeys') {
                const startRes = await fetch(`${props.basePath}/passkeys/login/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                if (!startRes.ok) {
                    const errData = await startRes.json().catch(() => ({}));
                    return { error: errData.error || 'Failed to start passkey login', status: startRes.status, ok: false };
                }

                const { options: passkeyOptions, sessionId } = await startRes.json();
                const { startAuthentication } = await import('@simplewebauthn/browser');
                const asseResp = await startAuthentication(passkeyOptions);

                credentials.response = JSON.stringify(asseResp);
                credentials.sessionId = sessionId;
            }

            const response = await fetch(`${props.basePath}/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider, ...credentials })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                if (data.type === 'oauth' && data.redirectUrl) {
                    if (popup && typeof window !== 'undefined') {
                        return await openOAuthPopup(data.redirectUrl, provider, fetchSession, redirect);
                    } else if (redirect && typeof window !== 'undefined') {
                        window.location.href = data.redirectUrl;
                    }
                    return { ok: true, status: 200, url: data.redirectUrl };
                }

                await fetchSession();
                const finalUrl = callbackUrl || '/';
                if (redirect && typeof window !== 'undefined') {
                    try {
                        if (router && typeof router.push === 'function') router.push(finalUrl);
                        else window.location.href = finalUrl;
                    } catch (e) {
                        window.location.href = finalUrl;
                    }
                }
                return { ok: true, status: 200, url: finalUrl };
            } else {
                return { error: data.error || 'Authentication failed', status: response.status, ok: false };
            }
        } catch (error) {
            console.error('[nytlex-auth] Error on signIn:', error);
            return { error: 'Network error', status: 500, ok: false };
        }
    };

    const signOut = async (options: { callbackUrl?: string } = {}): Promise<void> => {
        try {
            await fetch(`${props.basePath}/signout`, { method: 'POST', credentials: 'include' });
            session.set(null);
            status.set('unauthenticated');

            if (typeof window !== 'undefined') {
                const url = options.callbackUrl || '/';
                if (router && typeof router.push === 'function') router.push(url);
                else window.location.href = url;
            }
        } catch (error) {
            console.error('[nytlex-auth] Error on signOut:', error);
        }
    };

    const update = async () => await fetchSession();

    // Svelte Liefcycle functions
    onMount(() => {
        fetchSession();
        let intervalId: ReturnType<typeof setInterval>;

        if (props.refetchInterval > 0) {
            intervalId = setInterval(() => {
                if (get(status) === 'authenticated') fetchSession();
            }, props.refetchInterval * 1000);
        }

        const handleFocus = () => {
            if (props.refetchOnWindowFocus && get(status) === 'authenticated') fetchSession();
        };

        if (props.refetchOnWindowFocus) window.addEventListener('focus', handleFocus);

        return () => {
            if (intervalId) clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
        };
    });

    setContext<SessionContextType>(SessionKey, { data: session, status, signIn, signOut, update });
}

export function useSession(): SessionContextType {
    const context = getContext<SessionContextType>(SessionKey);
    if (!context) throw new Error('useSession must be used inside a SessionProvider');
    return context;
}

export function useAuth() {
    const { data, status } = useSession();

    return {
        user: derived(data, $data => $data?.user || null),
        isAuthenticated: derived(status, $status => $status === 'authenticated'),
        isLoading: derived(status, $status => $status === 'loading')
    };
}

export async function registerPasskey(username: string, name?: string, basePath: string = '/api/auth') {
    // Mesma lógica de registro original
    try {
        const { startRegistration } = await import('@simplewebauthn/browser');
        const startRes = await fetch(`${basePath}/passkeys/register/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (!startRes.ok) throw new Error('Failed to start passkey registration');

        const options = await startRes.json();
        const attResp = await startRegistration(options);

        const finishRes = await fetch(`${basePath}/passkeys/register/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, response: attResp, name })
        });

        const result = await finishRes.json();
        return result.success ? { success: true } : { success: false, error: result.error };
    } catch (error: any) {
        return { success: false, error: error.message || 'Passkey registration failed' };
    }
}