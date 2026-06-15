<script setup>
import { useSessionProviderLogic } from './session';

// Definição das props com valores padrão (Sintaxe JavaScript)
const props = defineProps({
  basePath: {
    type: String,
    default: '/api/auth'
  },
  refetchInterval: {
    type: Number,
    default: 0
  },
  refetchOnWindowFocus: {
    type: Boolean,
    default: true
  }
});

// Inicializa a lógica do provider passando as props reativas
useSessionProviderLogic(props);
</script>

<template>
  <slot />
</template>