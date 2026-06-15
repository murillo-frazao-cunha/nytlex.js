<!--
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
-->

<script setup lang="ts">
import { computed } from 'vue';
import { processNytlexImage } from '../../image-utils'; // Ajuste o caminho conforme necessário

const props = defineProps({
  src: {
    type: [String, Object], // Aceita string ou objeto (imports dinâmicos)
    required: true
  },
  width: [Number, String],
  height: [Number, String],
  quality: {
    type: Number,
    default: 75
  },
  priority: {
    type: Boolean,
    default: false
  },
  alt: {
    type: String,
    default: ""
  }
});

// Computed reativo que processa a imagem sempre que as props mudarem
const imageInfo = computed(() => {
  return processNytlexImage(props.src, props.width, props.height, props.quality);
});
</script>

<template>
  <img
      v-if="imageInfo.isValid"
      v-bind="$attrs"
      :src="imageInfo.src"
      :alt="alt"
      :loading="priority ? 'eager' : 'lazy'"
      :decoding="priority ? 'sync' : 'async'"
      :width="imageInfo.widthAttr"
      :height="imageInfo.heightAttr"
      :style="imageInfo.style"
      class="nytlex-image"
  />
</template>