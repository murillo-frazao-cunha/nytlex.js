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

const fs = require('fs');
const path = require('path');

function tryReadJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function resolveExtends(tsconfig, tsconfigDir) {
    if (!tsconfig || !tsconfig.extends) return tsconfig;

    const ext = tsconfig.extends;
    let extendedPath = ext;

    // Se começa com . ou .., é relativo. Se não, pode ser um node_module.
    if (ext.startsWith('.') || ext.startsWith('..')) {
        extendedPath = path.resolve(tsconfigDir, ext);
        if (!path.extname(extendedPath)) extendedPath += '.json';
    } else {
        // Tenta resolver via node modules (ex: @tsconfig/node18)
        try {
            extendedPath = require.resolve(ext, { paths: [tsconfigDir] });
        } catch {
            // Se falhar, tenta resolver como arquivo local mesmo sem ./
            extendedPath = path.resolve(tsconfigDir, ext);
            if (!path.extname(extendedPath)) extendedPath += '.json';
        }
    }

    const baseConfig = tryReadJson(extendedPath);
    if (!baseConfig) return tsconfig;

    const baseDir = path.dirname(extendedPath);
    const resolvedBase = resolveExtends(baseConfig, baseDir);

    // merge (shallow) with child overriding
    return {
        ...resolvedBase,
        ...tsconfig,
        compilerOptions: {
            ...(resolvedBase.compilerOptions || {}),
            ...(tsconfig.compilerOptions || {})
        }
    };
}

/**
 * Loads tsconfig paths and returns matchers (baseUrl removed).
 *
 * @param {string} projectDir directory containing tsconfig.json
 */
function loadTsConfigPaths(projectDir = process.cwd()) {
    const tsconfigPath = path.join(projectDir, 'tsconfig.json');
    const raw = tryReadJson(tsconfigPath);
    if (!raw) {
        return {
            projectDir,
            paths: {},
            mappings: []
        };
    }

    const merged = resolveExtends(raw, projectDir);
    const compilerOptions = merged.compilerOptions || {};
    const paths = compilerOptions.paths || {};

    const mappings = [];

    for (const [key, targetArr] of Object.entries(paths)) {
        if (!Array.isArray(targetArr) || targetArr.length === 0) continue;
        const target = targetArr[0];

        const hasStar = key.includes('*');
        const keyPrefix = key.split('*')[0];
        const keySuffix = hasStar ? key.split('*')[1] : '';

        const targetHasStar = typeof target === 'string' && target.includes('*');
        const targetPrefix = targetHasStar ? target.split('*')[0] : target;
        const targetSuffix = targetHasStar ? target.split('*')[1] : '';

        mappings.push({
            key,
            hasStar,
            keyPrefix,
            keySuffix,
            target,
            targetHasStar,
            targetPrefix,
            targetSuffix,
            baseDir: projectDir
        });
    }

    // Longer prefixes first (more specific)
    mappings.sort((a, b) => b.keyPrefix.length - a.keyPrefix.length);

    return { projectDir, paths, mappings };
}

function isRelativeLike(spec) {
    return spec.startsWith('.') || spec.startsWith('/') || spec.match(/^[A-Za-z]:\\/);
}

/**
 * Resolve a bare specifier using tsconfig paths.
 * Returns an absolute path candidate (without forcing extensions), or null.
 */
function resolveTsConfigAlias(specifier, tsconfigInfo) {
    if (!specifier || isRelativeLike(specifier)) return null;
    if (!tsconfigInfo || !tsconfigInfo.mappings || tsconfigInfo.mappings.length === 0) return null;

    for (const m of tsconfigInfo.mappings) {
        if (!m.hasStar) {
            if (specifier === m.key) {
                return path.resolve(m.baseDir, m.target);
            }
            continue;
        }

        // Verifica se o inicio e o fim batem
        if (!specifier.startsWith(m.keyPrefix) || !specifier.endsWith(m.keySuffix)) continue;

        // Pega o "miolo" do import que corresponde ao *
        const matched = specifier.slice(m.keyPrefix.length, specifier.length - m.keySuffix.length);

        const substituted = m.targetHasStar
            ? `${m.targetPrefix}${matched}${m.targetSuffix}`
            : m.target;

        return path.resolve(m.baseDir, substituted);
    }

    return null;
}

function resolveWithNodeStyleExtensions(candidateAbsPath) {
    const extensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'];

    if (fs.existsSync(candidateAbsPath)) {
        const stat = fs.statSync(candidateAbsPath);
        if (stat.isFile()) return candidateAbsPath;
        if (stat.isDirectory()) {
            for (const ext of extensions) {
                const idx = path.join(candidateAbsPath, 'index' + ext);
                if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
            }
        }
    }

    for (const ext of extensions) {
        const p = candidateAbsPath + ext;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }

    for (const ext of extensions) {
        const idx = path.join(candidateAbsPath, 'index' + ext);
        if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
    }

    return null;
}

module.exports = {
    loadTsConfigPaths,
    resolveTsConfigAlias,
    resolveWithNodeStyleExtensions
};