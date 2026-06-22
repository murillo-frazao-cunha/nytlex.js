<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);

function increment() {
  count.value++;
}
</script>

<script lang="ts">
import type { Metadata } from "nytlex/vue";

export function generateMetadata(): Metadata {
  return {
    title: "Hello World - Nytlex.js Vue Example",
    description: "A simple Hello World page using Nytlex.js with Vue.",
  };
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4 text-center">
    <div class="group relative">
      <div
          class="absolute -inset-1 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-400 opacity-25 blur transition duration-500 group-hover:opacity-50"
      />

      <div class="relative rounded-lg bg-gray-900 px-8 py-6 ring-1 ring-gray-800">
        <h1 class="mb-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Hello
          <span class="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            World
          </span>
        </h1>

        <p class="mb-4 text-sm font-medium text-gray-400">
          Running with <span class="text-gray-200">Nytlex.js</span>
        </p>

        <p class="mb-4 text-white">
          Count: {{ count }}
        </p>

        <button
            @click="increment"
            class="rounded-lg bg-cyan-500 px-4 py-2 text-white"
        >
          Incrementt
        </button>
      </div>
    </div>
  </div>
</template>