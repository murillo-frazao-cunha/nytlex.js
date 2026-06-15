/*
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
 */
import { defineComponent, h, watchEffect, computed, type PropType, type VNode } from 'vue';
import { useSession } from './session';
import { router } from 'nytlex/vue';

// Helper reativo interno para garantir acesso às Refs
// O useAuth do session.ts pode retornar valores estáticos dependendo da implementação,
// então usamos useSession diretamente aqui para garantir reatividade via computed.
function useAuthReactive() {
    const { data, status } = useSession();

    // Casting para Ref pois o inject traz as refs do provide
    const isAuthenticated = computed(() => (status as any).value === 'authenticated');
    const isLoading = computed(() => (status as any).value === 'loading');

    return { isAuthenticated, isLoading };
}

/**
 * Guard simples que só renderiza o slot default se estiver autenticado.
 * * Uso:
 * <AuthGuard redirectTo="/login">
 * <ConteudoProtegido />
 * </AuthGuard>
 */
export const AuthGuard = defineComponent({
    name: 'AuthGuard',
    props: {
        fallback: {
            type: [Object, String] as PropType<VNode | string | object>,
            default: null
        },
        redirectTo: {
            type: String,
            default: undefined
        }
    },
    setup(props, { slots }) {
        const { isAuthenticated, isLoading } = useAuthReactive();

        // Lógica de redirecionamento
        watchEffect(() => {
            if (props.redirectTo && !isLoading.value && !isAuthenticated.value) {
                if (router && typeof router.push === 'function') {
                    router.push(props.redirectTo);
                } else {
                    window.location.href = props.redirectTo;
                }
            }
        });

        // Render Function
        return () => {
            if (isLoading.value) {
                // Se houver fallback, renderiza ele (se for string cria text node, se for comp renderiza)
                // Caso contrário renderiza div vazia para manter paridade com React
                return props.fallback
                    ? (typeof props.fallback === 'string' ? h('div', props.fallback) : h(props.fallback))
                    : h('div');
            }

            if (!isAuthenticated.value) {
                return props.fallback
                    ? (typeof props.fallback === 'string' ? h('div', props.fallback) : h(props.fallback))
                    : null;
            }

            // Renderiza conteúdo principal
            return slots.default ? slots.default() : null;
        };
    }
});

/**
 * Componente para mostrar conteúdo apenas para usuários NÃO autenticados (ex: página de Login)
 */
export const GuestOnly = defineComponent({
    name: 'GuestOnly',
    props: {
        fallback: {
            type: [Object, String] as PropType<VNode | string | object>,
            default: null
        },
        redirectTo: {
            type: String,
            default: undefined
        }
    },
    setup(props, { slots }) {
        const { isAuthenticated, isLoading } = useAuthReactive();

        watchEffect(() => {
            if (props.redirectTo && !isLoading.value && isAuthenticated.value) {
                if (router && typeof router.push === 'function') {
                    router.push(props.redirectTo);
                } else {
                    window.location.href = props.redirectTo;
                }
            }
        });

        return () => {
            if (isLoading.value || isAuthenticated.value) {
                return props.fallback
                    ? (typeof props.fallback === 'string' ? h('div', props.fallback) : h(props.fallback))
                    : h('div');
            }

            return slots.default ? slots.default() : null;
        };
    }
});

/**
 * Composable para redirecionar baseado no status de autenticação.
 * Equivalente ao hook useAuthRedirect do React.
 */
export function useAuthRedirect(
    authenticatedRedirect?: string,
    unauthenticatedRedirect?: string
) {
    const { isAuthenticated, isLoading } = useAuthReactive();

    watchEffect(() => {
        if (isLoading.value) return;

        if (isAuthenticated.value && authenticatedRedirect) {
            window.location.href = authenticatedRedirect;
        } else if (!isAuthenticated.value && unauthenticatedRedirect) {
            window.location.href = unauthenticatedRedirect;
        }
    });
}