<!--
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
-->
<script lang="ts">
    import { useAuth } from './session';
    import { router } from 'nytlex/svelte';

    export let fallback: any = null; // Componente Svelte ou string
    export let redirectTo: string | undefined = undefined;

    const { isAuthenticated, isLoading } = useAuth();

    // Lógica de Redirecionamento
    $: if (redirectTo && !$isLoading && !$isAuthenticated) {
        if (router && typeof router.push === 'function') {
            router.push(redirectTo);
        } else {
            window.location.href = redirectTo;
        }
    }
</script>

{#if $isLoading}
    {#if typeof fallback === 'string'}
        <div>{fallback}</div>
    {:else if fallback}
        <svelte:component this={fallback} />
    {:else}
        <div></div>
    {/if}
{:else if !$isAuthenticated}
    {#if typeof fallback === 'string'}
        <div>{fallback}</div>
    {:else if fallback}
        <svelte:component this={fallback} />
    {/if}
{:else}
    <!-- Renderiza apenas se estiver autenticado -->
    <slot />
{/if}