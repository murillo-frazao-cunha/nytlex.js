<template>
  <div id="nytlex-vue-root">
    <component :is="resolvedLayout" v-if="resolvedLayout">
      <component
          :is="resolvedContent"
          v-bind="contentProps"
          :key="`page-${currentPathKey}-${hmrKey}`"
      />
    </component>

    <component
        v-else
        :is="resolvedContent"
        v-bind="contentProps"
        :key="`page-${currentPathKey}-${hmrKey}`"
    />

    <nytlex-dev-badge
        v-if="isMounted && isDev"
        :has-build-error="!!buildError"
        @click-build-error="isErrorOpen = true"
    ></nytlex-dev-badge>

    <nytlex-error-modal
        v-if="isMounted"
        .error="buildError"
        .isOpen="isErrorOpen"
        @close-modal="isErrorOpen = false"
        @copy-log="handleCopyLog"
    ></nytlex-error-modal>
  </div>
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
  layoutComponent: null,
  initialResolvedComponent: null // Prop adicionada para pre-load do SSR
});

// --- Estado ---
const isMounted = ref(false);
const hmrTimestamp = ref(0); // Mudado de Date.now() para 0 para evitar mismatch de SSR
const hmrKey = ref(0); // Chave para forçar o remount visual no Vue
const currentPathKey = ref(window.location.pathname);
const pendingHmrReady = ref(null);

const buildError = ref(window.__NYTLEX_BUILD_ERROR__ || null);
const isErrorOpen = ref(!!window.__NYTLEX_BUILD_ERROR__);
const isDev = process.env.NODE_ENV !== 'production';

// Cleanup references for events
let cleanupErrorEvents;
let cleanupHmrEvents;
let unsubscribeRouter;
let hmrTimeout;

const handleCopyLog = () => copyBuildError(buildError.value);

const handleVueHmrSwap = () => {
  clearTimeout(hmrTimeout);
  // Espera os pacotes terminarem de injetar no __NYTLEX_COMPONENTS__ antes de atualizar
  hmrTimeout = setTimeout(async () => {
    console.log('[Nytlex] ♻️ Vue HMR Swap: Forçando atualização da rota com os novos pacotes...');
    isFirstRender.value = false;
    hmrKey.value++; // Altera a chave para forçar o Vue a redesenhar o componente do zero
    await updateRoute();

    // 👉 DESLIGA O DEV BADGE! Avisa ele pra parar de girar
    window.dispatchEvent(new CustomEvent('nytlex:hotreload', {
      detail: { state: 'idle', payload: { success: true }, ts: Date.now() }
    }));
  }, 50);
};

watch(hmrTimestamp, async (timestamp) => {
  if (!pendingHmrReady.value || pendingHmrReady.value.timestamp !== timestamp) return;
  await nextTick();
  dispatchHmrReady(pendingHmrReady.value);
  pendingHmrReady.value = null;
});

// --- Roteamento ---
// Inicia diretamente com o componente resolvido, sem tela branca!
const CurrentPageComponent = shallowRef(props.initialResolvedComponent || props.componentMap[props.initialComponentPath] || null);
const params = ref(props.initialParams || {});
const isFirstRender = ref(true);

const updateRoute = async () => {
  const currentPath = window.location.pathname.replace("index.html", '');
  currentPathKey.value = currentPath;

  // CHAVE DA MÁGICA: Sempre buscar do window.__NYTLEX_COMPONENTS__ pois o entry.client
  // atualiza esse objeto global ao baixar a nova versão do main.js via import()
  const compMap = window.__NYTLEX_COMPONENTS__ || props.componentMap;

  const match = findRouteForPath(currentPath, props.routes);
  if (match) {
    const wrapper = compMap[match.componentPath];
    params.value = match.params;

    let componentToRender = wrapper;

    if (isFirstRender.value) {
      isFirstRender.value = false;
      componentToRender = props.initialResolvedComponent || wrapper;
      CurrentPageComponent.value = componentToRender;
    } else {
      // Na navegação via SPA ou no HMR, resolvemos o chunk fresco antes de atualizar a tela
      if (wrapper && typeof wrapper.__importFunc === 'function') {
        try {
          const m = await wrapper.__importFunc();
          componentToRender = m.default || Object.values(m)[0] || m;
        } catch (e) {
          console.error('[Nytlex] Error fetching route chunk:', e);
        }
      }
      CurrentPageComponent.value = componentToRender;
    }

    let pageTitle = null;

    // 1. Pega do Layout primeiro (Fallback base)
    const LayoutMetadata = window.__NYTLEX_LAYOUT_METADATA__ || {};

    if (LayoutMetadata) {
      if (LayoutMetadata.title) {
        pageTitle = LayoutMetadata.title;
      }
    }

    // 2. Sobrescreve com o estático da rota atual (se existir)
    if (match.metadata?.title) {
      pageTitle = match.metadata.title;
    }

    // 3. Sobrescreve com o dinâmico da rota atual (Prioridade máxima)
    if (componentToRender) {
      try {
        if (typeof componentToRender.getMetadata === 'function') {
          const dynamicMetaRaw = await componentToRender.getMetadata();

          let dynamicMeta = dynamicMetaRaw;
          if (typeof dynamicMetaRaw === 'function') {
            dynamicMeta = await dynamicMetaRaw(match.params);
          }

          if (dynamicMeta && dynamicMeta.title) {
            pageTitle = dynamicMeta.title;
          }
        }
      } catch (err) {
        console.error('[Nytlex] Erro ao resolver metadata da página:', err);
      }
    }

    // 4. Atualiza o título real da página
    if (pageTitle) {
      updateDocumentTitle(pageTitle);
    }
  } else {
    CurrentPageComponent.value = null;
    params.value = {};
  }
};

// --- Computed ---
const resolvedContent = computed(() => {
  if (!CurrentPageComponent.value || props.initialComponentPath === '__404__') {
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
  isMounted.value = true;
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
  window.addEventListener('nytlex:vue-hmr-swap', handleVueHmrSwap);
});

onUnmounted(() => {
  if (cleanupErrorEvents) cleanupErrorEvents();
  if (cleanupHmrEvents) cleanupHmrEvents();

  window.removeEventListener('popstate', updateRoute);
  if (unsubscribeRouter) unsubscribeRouter();
  window.removeEventListener('nytlex:vue-hmr-swap', handleVueHmrSwap);
});
</script>