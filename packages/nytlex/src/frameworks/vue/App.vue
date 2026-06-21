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
<template>
  <component :is="resolvedLayout" v-if="resolvedLayout">
    <component
        :is="resolvedContent"
        v-bind="contentProps"
        :key="`page-${hmrTimestamp}-${currentPathKey}`"
    />
  </component>

  <component
      v-else
      :is="resolvedContent"
      v-bind="contentProps"
      :key="`page-${hmrTimestamp}-${currentPathKey}`"
  />

  <nytlex-dev-badge
      v-if="isDev"
      :has-build-error="!!buildError"
      @click-build-error="isErrorOpen = true"
  ></nytlex-dev-badge>

  <nytlex-error-modal
      .error="buildError"
      .isOpen="isErrorOpen"
      @close-modal="isErrorOpen = false"
      @copy-log="handleCopyLog"
  ></nytlex-error-modal>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, shallowRef, watch, nextTick, defineComponent, h } from 'vue';
import { router } from '../../client/clientRouter';

// Importa a lógica centralizada
import {
  findRouteForPath, updateDocumentTitle, copyBuildError,
  setupBuildErrorEvents, setupHMREvents, dispatchHmrReady
} from '../FrontCore';

import '../themes/DevBadge';
import '../themes/ErrorModal';

// --- Props ---
const props = defineProps({
  componentMap: Object,
  routes: Array,
  initialComponentPath: String,
  initialParams: null,
  layoutComponent: null
});

// --- Estado ---
const hmrTimestamp = ref(Date.now());
const currentPathKey = ref(window.location.pathname);
const pendingHmrReady = ref(null);

const buildError = ref(window.__NYTLEX_BUILD_ERROR__ || null);
const isErrorOpen = ref(!!window.__NYTLEX_BUILD_ERROR__);
const isDev = process.env.NODE_ENV !== 'production';

// Cleanup references for events
let cleanupErrorEvents;
let cleanupHmrEvents;
let unsubscribeRouter;

const handleCopyLog = () => copyBuildError(buildError.value);

watch(hmrTimestamp, async (timestamp) => {
  if (!pendingHmrReady.value || pendingHmrReady.value.timestamp !== timestamp) return;
  await nextTick();
  dispatchHmrReady(pendingHmrReady.value);
  pendingHmrReady.value = null;
});

// --- Roteamento ---
const CurrentPageComponent = shallowRef(null);
const params = ref({});

// NOVO: Estado para segurar a metadata atual
const currentMetadata = ref({});

const updateRoute = async () => {
  const currentPath = window.location.pathname.replace("index.html", '');
  currentPathKey.value = currentPath;

  console.log(`[Vatts.js Metadata] 🔄 Atualizando rota para: ${currentPath}`);

  const match = findRouteForPath(currentPath, props.routes);
  if (match) {
    const component = props.componentMap[match.componentPath];
    CurrentPageComponent.value = component;
    params.value = match.params;

    console.log('[Vatts.js Metadata] ✅ Componente encontrado:', match.componentPath);

    try {
      // 1. Resolve Metadata do Layout (Base)
      let layoutMeta = {};
      if (props.layoutComponent) {
        layoutMeta = props.layoutComponent.metadata || {};
        if (typeof props.layoutComponent.generateMetadata === 'function') {
          console.log('[Vatts.js Metadata] ⏳ Executando generateMetadata do Layout...');
          const dynamicLayoutMeta = await props.layoutComponent.generateMetadata(params.value);
          layoutMeta = { ...layoutMeta, ...dynamicLayoutMeta };
        }
      }
      console.log('[Vatts.js Metadata] 📦 Layout Meta resolvido:', layoutMeta);

      // 2. Resolve Metadata da Página (Específico)
      let pageMeta = match.metadata || (component && component.metadata) || {};
      if (component && typeof component.generateMetadata === 'function') {
        console.log('[Vatts.js Metadata] ⏳ Executando generateMetadata da Página...');
        const dynamicPageMeta = await component.generateMetadata(params.value);
        if (dynamicPageMeta) {
          pageMeta = { ...pageMeta, ...dynamicPageMeta };
        }
      }
      console.log('[Vatts.js Metadata] 📄 Page Meta resolvido:', pageMeta);

      // 3. Unifica as Metadatas (Prioridade para a Página)
      const unifiedMeta = {
        ...layoutMeta,
        ...pageMeta
      };

      console.log('[Vatts.js Metadata] 🔗 Metadata Unificada Final:', unifiedMeta);

      // Força a atualização do ref
      currentMetadata.value = unifiedMeta;

    } catch (error) {
      console.error('[Vatts.js Metadata] ❌ Erro ao resolver metadata (Verifique suas funções generateMetadata):', error);
    }

  } else {
    console.warn(`[Vatts.js Metadata] ⚠️ Nenhuma rota encontrada para: ${currentPath}`);
    CurrentPageComponent.value = null;
    params.value = {};
    currentMetadata.value = null;
  }
};

// NOVO: Watcher pra atualizar o título de forma isolada
watch(currentMetadata, (newMeta) => {
  console.log('[Vatts.js Metadata] 👀 Watcher acionado com:', newMeta);
  if (newMeta && newMeta.title) {
    console.log(`[Vatts.js Metadata] ✏️ Atualizando document.title para: "${newMeta.title}"`);
    updateDocumentTitle(newMeta.title);
  } else {
    console.log('[Vatts.js Metadata] ℹ️ Nenhum título encontrado na metadata unificada.');
  }
}, { deep: true });

// --- Computed ---
const resolvedContent = computed(() => {
  if (!CurrentPageComponent.value) {
    const NotFoundComponent = window.__NYTLEX_NOT_FOUND__;
    if (NotFoundComponent) return NotFoundComponent;

    const { getDefaultNotFound } = window.__NYTLEX_DEFAULT_NOT_FOUND__ || {};
    return getDefaultNotFound
        ? defineComponent({
          render() {
            return h('div', {
              innerHTML: getDefaultNotFound()
            });
          }
        })
        : 'div';
  }
  return CurrentPageComponent.value;
});

const contentProps = computed(() => {
  if (!CurrentPageComponent.value) return {};
  return { params: params.value };
});

const resolvedLayout = computed(() => props.layoutComponent || null);

// --- Lifecycle ---
onMounted(() => {
  updateRoute();

  // Usa as funções de eventos do Core
  cleanupErrorEvents = setupBuildErrorEvents(
      (err) => { buildError.value = err; isErrorOpen.value = true; },
      () => { buildError.value = null; isErrorOpen.value = false; }
  );

  cleanupHmrEvents = setupHMREvents((file, timestamp) => {
    pendingHmrReady.value = { file, timestamp };
    hmrTimestamp.value = timestamp;
    updateRoute();
  });

  window.addEventListener('popstate', updateRoute);
  unsubscribeRouter = router.subscribe(updateRoute);
});

onUnmounted(() => {
  if (cleanupErrorEvents) cleanupErrorEvents();
  if (cleanupHmrEvents) cleanupHmrEvents();

  window.removeEventListener('popstate', updateRoute);
  if (unsubscribeRouter) unsubscribeRouter();
});
</script>