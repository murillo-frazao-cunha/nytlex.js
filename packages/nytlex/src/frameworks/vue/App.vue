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

const updateRoute = () => {
  const currentPath = window.location.pathname.replace("index.html", '');
  currentPathKey.value = currentPath;

  const match = findRouteForPath(currentPath, props.routes);
  if (match) {
    CurrentPageComponent.value = props.componentMap[match.componentPath];
    params.value = match.params;
    updateDocumentTitle(match.metadata?.title);
  } else {
    CurrentPageComponent.value = null;
    params.value = {};
  }
};

// --- Computed ---
const resolvedContent = computed(() => {
  if (!CurrentPageComponent.value) {
    const NotFoundComponent = window.__NYTLEX_NOT_FOUND__;
    if (NotFoundComponent) return NotFoundComponent;

    const { getDefaultNotFound } = window.__NYTLEX_DEFAULT_NOT_FOUND__;
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