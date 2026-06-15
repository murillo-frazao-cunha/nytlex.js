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
<script lang="ts">
    import { router } from '../../../client/clientRouter';

    // Propriedade exportada para receber o href
    export let href: string;

    // Função que intercepta o clique
    async function handleClick(e: MouseEvent) {
        e.preventDefault();

        // Usa o novo sistema de router
        router.push(href);
    }
</script>

<!--
  Repassa o href, adiciona o evento de clique e
  usa $$restProps para repassar quaisquer outros atributos HTML (como class, id, etc)
-->
<a {href} on:click={handleClick} {...$$restProps}>
    <slot></slot>
</a>