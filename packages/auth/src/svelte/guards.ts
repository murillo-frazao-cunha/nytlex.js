/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 */
import { derived } from 'svelte/store';
import { useAuth } from './session';
import { onDestroy } from 'svelte';

/**
 * Hook utilitário para redirecionar baseado no status de autenticação.
 * Deve ser chamado na inicialização do script (top-level) de um componente Svelte.
 */
export function useAuthRedirect(
    authenticatedRedirect?: string,
    unauthenticatedRedirect?: string
) {
    const { isAuthenticated, isLoading } = useAuth();

    // Cria uma inscrição nas mudanças dos stores de autenticação
    const unsubscribe = derived(
        [isAuthenticated, isLoading],
        ([$auth, $loading]) => ({ $auth, $loading })
    ).subscribe(({ $auth, $loading }) => {
        if ($loading) return;

        if ($auth && authenticatedRedirect) {
            window.location.href = authenticatedRedirect;
        } else if (!$auth && unauthenticatedRedirect) {
            window.location.href = unauthenticatedRedirect;
        }
    });

    // Limpa o subscription assim que o componente que convocou este hook for destruído
    try {
        onDestroy(unsubscribe);
    } catch (e) {
        // Ignora se for chamado fora do ciclo de vida de um componente Svelte
    }
}