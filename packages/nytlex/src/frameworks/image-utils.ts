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

export function getBaseUrl(): string | null {
    if (typeof window === "undefined") return null;
    return window.location.origin;
}

export function isExportMode(): boolean {
    if (typeof window === 'undefined') {
        return typeof process !== 'undefined' && process.env?.NYTLEX_MODE === 'exported';
    }

    const w: any = window as any;
    return (
        w.__NYTLEX_MODE__ === 'export' ||
        (w.__NYTLEX && w.__NYTLEX.mode === 'export') ||
        w.__NYTLEX_EXPORT__ === true
    );
}

export function cleanDimension(val?: string | number): string | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'string') return val.replace('px', '');
    return String(val);
}

export function formatStyleDimension(val?: string | number): string {
    if (val === undefined || val === null) return 'auto';
    return typeof val === 'number' ? `${val}px` : String(val);
}

export interface ProcessedImage {
    isValid: boolean;
    src: string;
    widthAttr?: string;
    heightAttr?: string;
    style: {
        width: string;
        height: string;
    };
}

export function processNytlexImage(
    rawSrc: any,
    width?: number | string,
    height?: number | string,
    quality: number = 75
): ProcessedImage {
    // 1. Normalização do Src
    const normalizedSrc = (rawSrc && typeof rawSrc === 'string')
        ? rawSrc
        : (rawSrc && typeof rawSrc === 'object' ? (rawSrc.src || rawSrc.default || String(rawSrc)) : rawSrc);

    // 2. Validação básica
    if (!normalizedSrc || (typeof normalizedSrc === "object" && Object.keys(normalizedSrc).length === 0)) {
        return { isValid: false, src: '', style: { width: 'auto', height: 'auto' } };
    }

    const baseUrl = getBaseUrl();

    // 3. Verifica se é otimizável
    const isOptimizable =
        typeof normalizedSrc === 'string' &&
        !normalizedSrc.startsWith('data:') &&
        ((baseUrl && normalizedSrc.startsWith(baseUrl)) || !normalizedSrc.startsWith('http')) &&
        !isExportMode();

    let finalSrc = normalizedSrc;

    // 4. Lógica de Otimização
    if (isOptimizable) {
        let path = normalizedSrc;
        if (baseUrl && path.startsWith(baseUrl)) {
            path = path.slice(baseUrl.length) || '/';
        }

        const params = new URLSearchParams();
        params.set('url', path);

        const w = cleanDimension(width);
        if (w && !isNaN(Number(w))) params.set('w', w);

        const h = cleanDimension(height);
        if (h && !isNaN(Number(h))) params.set('h', h);

        if (quality) params.set('q', quality.toString());

        finalSrc = `/_nytlex/image?${params.toString()}`;
    }

    // 5. Retorna as propriedades limpas e prontas para uso nos frameworks
    return {
        isValid: true,
        src: finalSrc,
        widthAttr: cleanDimension(width),
        heightAttr: cleanDimension(height),
        style: {
            width: formatStyleDimension(width),
            height: formatStyleDimension(height)
        }
    };
}