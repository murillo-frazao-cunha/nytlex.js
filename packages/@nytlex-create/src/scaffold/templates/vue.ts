/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 itsmuzin
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
export function vueExampleRoute(_typescript: boolean, tailwind: boolean) {
  return `${tailwind ? `<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4 text-center">
    <div class="group relative">
      <div class="absolute -inset-1 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-400 opacity-25 blur transition duration-500 group-hover:opacity-50"></div>
      <div class="relative rounded-lg bg-gray-900 px-8 py-6 ring-1 ring-gray-800">
        <h1 class="mb-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Hello <span class="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">World</span>
        </h1>

        <p class="text-sm font-medium text-gray-400">
          Running with <span class="text-gray-200">Nytlex.js</span>
        </p>
      </div>
    </div>
  </div>
</template>` : `<template>
  <div class="container">
    <div class="group-wrapper">
      <div class="gradient-blur"></div>

      <div class="card">
        <h1 class="title">
          Hello <span class="gradient-text">World</span>
        </h1>

        <p class="subtitle">
          Running with <span class="subtitle-highlight">Nytlex.js</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #030712;
  padding: 1rem;
  text-align: center;
  font-family: sans-serif;
}

.group-wrapper {
  position: relative;
}

.gradient-blur {
  position: absolute;
  top: -4px;
  right: -4px;
  bottom: -4px;
  left: -4px;
  border-radius: 0.5rem;
  background: linear-gradient(to right, #9333ea, #22d3ee);
  filter: blur(8px);
  transition: opacity 500ms ease;
  opacity: 0.25;
}

.group-wrapper:hover .gradient-blur {
  opacity: 0.5;
}

.card {
  position: relative;
  border-radius: 0.5rem;
  background-color: #111827;
  padding: 1.5rem 2rem;
  border: 1px solid #1f2937;
  color: white;
}

.title {
  margin-bottom: 0.5rem;
  font-size: 2.25rem;
  font-weight: bold;
  letter-spacing: -0.025em;
  color: white;
  line-height: 1;
}

.gradient-text {
  color: transparent;
  background-clip: text;
  -webkit-background-clip: text;
  background-image: linear-gradient(to right, #c084fc, #22d3ee);
}

.subtitle {
  font-size: 0.875rem;
  font-weight: 500;
  color: #9ca3af;
  margin: 0;
}

.subtitle-highlight {
  color: #e5e7eb;
}
</style>`}`;
}

export function vueExampleLayout(typescript: boolean) {
  return `<script${typescript ? ' lang="ts"' : ""}>
${typescript ? `import type { Metadata } from "nytlex/vue";` : ""}
export const metadata${typescript ? ": Metadata" : ""} = {
  title: "Nytlex JS | The Fast and Simple Web Framework for React",
  description: "The fastest and simplest web framework for React! Start building high-performance web applications today with Nytlex JS.",
  keywords: ["Nytlex JS", "web framework", "React", "JavaScript", "TypeScript", "web development", "fast", "simple", "SSR", "frontend"],
  author: "Nytlex JS Team",
};
</script>

<script setup ${typescript ? ' lang="ts"' : ""}>
import './globals.css';
</script>

<template>
    <slot />
</template>`;
}
