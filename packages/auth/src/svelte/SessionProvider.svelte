<!--
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
-->
<script lang="ts">
    import { createSessionProvider } from './session';

    export let basePath: string = '/api/auth';
    export let refetchInterval: number = 0;
    export let refetchOnWindowFocus: boolean = true;

    // Inicia a lógica e o ciclo de vida que injeta o store nos filhos
    createSessionProvider({
        basePath,
        refetchInterval,
        refetchOnWindowFocus
    });
</script>

<slot />