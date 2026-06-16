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
import { RouteConfig } from './types';
import type { GenericRequest } from './types/framework';
import { cachedFramework } from "./api/framework";

// Importamos apenas os tipos para evitar side-effects de runtime
// As implementações reais são carregadas sob demanda.

interface RenderOptions {
    req: GenericRequest;
    res: any;
    route: RouteConfig & { componentPath: string };
    params: Record<string, string>;
    allRoutes: (RouteConfig & { componentPath: string })[];
}

/**
 * Renderiza a requisição como stream, carregando o driver apropriado dinamicamente.
 * Isso evita erros de "Module Not Found" quando um dos frameworks não está instalado.
 */
export async function renderAsStream(params: RenderOptions): Promise<void> {
    if (cachedFramework === 'react') {
        // Import dinâmico garante que o código do React só seja avaliado se necessário
        const { render } = await import("./frameworks/renderers/renderer-react.js");
        return await render(params);
    } else if(cachedFramework === 'vue') {
        const { renderVue } = await import("./frameworks/renderers/renderer.vue.js");
        return await renderVue(params);
    } else if(cachedFramework === 'svelte') {
        const { renderSvelte } = await import("./frameworks/renderers/renderer.svelte.js");
        return await renderSvelte(params);
    } else {
        throw new Error(`Unsupported framework: ${cachedFramework}`);
    }
}