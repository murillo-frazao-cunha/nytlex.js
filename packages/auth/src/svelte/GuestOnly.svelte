<!--
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
-->
<script lang="ts">
    import { useAuth } from './session';
    import { router } from 'nytlex/svelte';

    export let fallback: any = null;
    export let redirectTo: string | undefined = undefined;

    const { isAuthenticated, isLoading } = useAuth();

    // Redireciona se JÁ estiver autenticado
    $: if (redirectTo && !$isLoading && $isAuthenticated) {
        if (router && typeof router.push === 'function') {
            router.push(redirectTo);
        } else {
            window.location.href = redirectTo;
        }
    }
</script>

{#if $isLoading || $isAuthenticated}
    {#if typeof fallback === 'string'}
        <div>{fallback}</div>
    {:else if fallback}
        <svelte:component this={fallback} />
    {:else}
        <div></div>
    {/if}
{:else}
    <!-- Renderiza apenas se for visitante -->
    <slot />
{/if}