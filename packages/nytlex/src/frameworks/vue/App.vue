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
import { ref, computed, onMounted, onUnmounted, shallowRef, watch, nextTick, defineComponent, h } from 'vue';
import { router } from '../../client/clientRouter';

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
const currentMetadata = ref({});

const updateRoute = async () => {
  const currentPath = window.location.pathname.replace("index.html", '');
  currentPathKey.value = currentPath;

  const match = findRouteForPath(currentPath, props.routes);
  if (match) {
    // Agora o componente vem de 'routeData.component'
    const routeData = props.componentMap[match.componentPath];
    CurrentPageComponent.value = routeData ? routeData.component : null;
    params.value = match.params;

    try {
      // 1. Resolve Metadata do Layout
      let layoutMeta = {};
      // Lemos do .module que injetamos via Esbuild
      if (props.layoutComponent && props.layoutComponent.module) {
        const layoutModule = props.layoutComponent.module;
        layoutMeta = layoutModule.metadata || (layoutModule.default && layoutModule.default.metadata) || {};

        if (typeof layoutModule.generateMetadata === 'function') {
          const dynamicLayoutMeta = await layoutModule.generateMetadata(params.value);
          layoutMeta = { ...layoutMeta, ...dynamicLayoutMeta };
        } else if (layoutModule.default && typeof layoutModule.default.generateMetadata === 'function') {
          const dynamicLayoutMeta = await layoutModule.default.generateMetadata(params.value);
          layoutMeta = { ...layoutMeta, ...dynamicLayoutMeta };
        }
      }

      // 2. Resolve Metadata da Página acessando o módulo real via routeData.loader()
      let pageMeta = match.metadata || {};
      if (routeData && routeData.loader) {
        // Invoca o import dinâmico que não está enjaulado pelo defineAsyncComponent
        const pageModule = await routeData.loader();

        pageMeta = { ...pageMeta, ...(pageModule.metadata || (pageModule.default && pageModule.default.metadata) || {}) };

        if (typeof pageModule.generateMetadata === 'function') {
          const dynamicPageMeta = await pageModule.generateMetadata(params.value);
          if (dynamicPageMeta) pageMeta = { ...pageMeta, ...dynamicPageMeta };
        } else if (pageModule.default && typeof pageModule.default.generateMetadata === 'function') {
          const dynamicPageMeta = await pageModule.default.generateMetadata(params.value);
          if (dynamicPageMeta) pageMeta = { ...pageMeta, ...dynamicPageMeta };
        }
      }

      // 3. Unifica e joga pro watcher
      currentMetadata.value = { ...layoutMeta, ...pageMeta };

    } catch (error) {
      console.error('[Vatts.js Metadata] ❌ Erro ao resolver metadata real do módulo:', error);
    }

  } else {
    CurrentPageComponent.value = null;
    params.value = {};
    currentMetadata.value = null;
  }
};

watch(currentMetadata, (newMeta) => {
  if (newMeta && newMeta.title) {
    updateDocumentTitle(newMeta.title);
  }
}, { deep: true });

// --- Computed ---
const resolvedContent = computed(() => {
  if (!CurrentPageComponent.value) {
    const NotFoundData = window.__NYTLEX_NOT_FOUND__;
    if (NotFoundData) return NotFoundData;

    const { getDefaultNotFound } = window.__NYTLEX_DEFAULT_NOT_FOUND__ || {};
    return getDefaultNotFound
        ? defineComponent({ render: () => h('div', { innerHTML: getDefaultNotFound() }) })
        : 'div';
  }
  return CurrentPageComponent.value;
});

const contentProps = computed(() => {
  if (!CurrentPageComponent.value) return {};
  return { params: params.value };
});

const resolvedLayout = computed(() => {
  // Ajuste pro template receber a parte certa do layout
  return props.layoutComponent ? props.layoutComponent.component : null;
});

// --- Lifecycle ---
onMounted(() => {
  updateRoute();

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