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
    import { processNytlexImage } from '../../image-utils'; // Ajuste o caminho se necessário

    // Propriedades do componente
    export let src: any;
    export let width: number | string | undefined = undefined;
    export let height: number | string | undefined = undefined;
    export let quality: number = 75;
    export let priority: boolean = false;
    export let alt: string = "";

    // Bloco reativo: recalcula as informações da imagem sempre que src, width, height ou quality mudarem
    $: imageInfo = processNytlexImage(src, width, height, quality);

    // Combina classes e estilos externos (passados via $$restProps) com os padrões do Nytlex
    $: combinedClass = $$restProps.class ? `nytlex-image ${$$restProps.class}` : 'nytlex-image';
    $: combinedStyle = $$restProps.style
        ? `width: ${imageInfo.style.width}; height: ${imageInfo.style.height}; ${$$restProps.style}`
        : `width: ${imageInfo.style.width}; height: ${imageInfo.style.height};`;
</script>

{#if imageInfo.isValid}
    <img
            {...$$restProps}
            src={imageInfo.src}
            {alt}
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
            width={imageInfo.widthAttr}
            height={imageInfo.heightAttr}
            class={combinedClass}
            style={combinedStyle}
    />
{/if}