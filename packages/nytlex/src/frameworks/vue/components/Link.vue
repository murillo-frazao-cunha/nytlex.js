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
<script setup>
import { router } from '../../../client/clientRouter';

const props = defineProps({
  href: {
    type: String,
    required: true
  }
});

const handleClick = async (e) => {
  e.preventDefault();

  // Usa o novo sistema de router
  await router.push(props.href);
};
</script>

<template>
  <a :href="href" @click="handleClick">
    <slot></slot>
  </a>
</template>