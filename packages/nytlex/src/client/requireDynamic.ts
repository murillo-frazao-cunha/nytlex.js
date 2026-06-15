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

export type RequireDynamicModule<T = any> = T & {
  default?: any;
};

/**
 * Array of loaded modules + helpers.
 *
 * Note: we intentionally DO NOT name the helper `.keys()` because Array already
 * has a `.keys()` method (iterator). Instead we provide `.fileKeys()`.
 */
export interface RequireDynamicContext<T = any> extends Array<RequireDynamicModule<T>> {
  /** Returns the matched relative file paths (like webpack keys()) */
  fileKeys(): string[];
  /** Map from key -> module */
  modules: Record<string, RequireDynamicModule<T>>;
}

export interface RequireDynamicOptions {
  /**
   * If true, uses eager bundler imports when available.
   * Defaults to true.
   */
  eager?: boolean;
}

/**
 * Webpack-like dynamic module context that works in:
 * - Vite/Rollup (via import.meta.glob)
 * - Node.js (filesystem scan + require)
 *
 * Note: In Node, `dir` must be a real filesystem path.
 * In the browser, this relies on bundler support.
 */
export function requireDynamic<T = any>(
  dir: string,
  recursive: boolean,
  pattern: RegExp,
  options: RequireDynamicOptions = {}
): RequireDynamicContext<T> {
  const eager = options.eager !== false;


  const maybeFn: any = (dir as any);
  if (typeof maybeFn === 'function' && typeof maybeFn.keys === 'function') {
    const keysArr = maybeFn.keys() as string[];
    const modules: Record<string, RequireDynamicModule<T>> = {};
    for (const k of keysArr) modules[k] = maybeFn(k);
    return makeContext(keysArr, modules);
  }

  // --- Preferred path (Rollup transform): if the bundler already transformed
  // something into a webpack-like require.context function, just use it.
  // This makes requireDynamic behave like a wrapper and avoids any Node imports.
  //
  // Example injected shape (see requireContextPlugin in builder.js):
  //   const ctx = (function(){ var map = {...}; var req = (k)=>map[k]; req.keys=()=>Object.keys(map); return req; })();
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const maybeReq = (globalThis as any)?.require?.context?.(dir, recursive, pattern);
    if (typeof maybeReq === 'function' && typeof (maybeReq as any).keys === 'function') {
      const keysArr = (maybeReq as any).keys() as string[];
      const modules: Record<string, RequireDynamicModule<T>> = {};
      for (const k of keysArr) modules[k] = (maybeReq as any)(k);
      return makeContext(keysArr, modules);
    }
  } catch {
    // ignore
  }


  const globFn = (globalThis as any)?.__NYTLEX_IMPORT_META_GLOB__ as undefined | ((g: string | string[], o?: any) => any);
  if (typeof globFn === 'function') {
    const base = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    const globPattern = recursive ? `${base}/**/*` : `${base}/*`;

    const raw = globFn(globPattern, { eager });
    const entries = Object.entries(raw)
      .filter(([key]) => pattern.test(key))
      .map(([key, mod]) => [normalizeKey(dir, key), mod] as const);

    return makeContextFromEntries(entries);
  }

  // --- No available mechanism ---
  // If we're in the browser, we MUST NOT try to load from disk.
  // Only bundler-driven mechanisms work.
  throw new Error(
    `[nytlex] requireDynamic("${dir}") can only run in the browser when your bundler provides a dynamic module loader. ` +
      `Either (1) use 'require.context' (nytlex build transforms it), or (2) inject Vite glob: globalThis.__NYTLEX_IMPORT_META_GLOB__ = import.meta.glob.`
  );
}

function makeContextFromEntries<T = any>(entries: ReadonlyArray<readonly [string, any]>): RequireDynamicContext<T> {
  const keys = entries.map(([k]) => k);
  const modules: Record<string, RequireDynamicModule<T>> = {};
  for (const [k, m] of entries) modules[k] = m;
  return makeContext(keys, modules);
}

function makeContext<T = any>(keysArr: string[], modules: Record<string, RequireDynamicModule<T>>): RequireDynamicContext<T> {
  const arr = keysArr.map((k) => modules[k]);
  const ctx = arr as unknown as RequireDynamicContext<T>;

  Object.defineProperty(ctx, 'modules', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: modules
  });

  ctx.fileKeys = () => [...keysArr];
  return ctx;
}

function normalizeKey(dir: string, fullKey: string) {
  // Vite keys are usually like "/abs/path" during dev or relative to project root.
  // We normalize to a webpack-ish relative key from `dir` when possible.
  const d = dir.replace(/\\/g, '/');
  const k = fullKey.replace(/\\/g, '/');

  // If fullKey already looks relative, keep it.
  if (k.startsWith('./')) return k;

  const idx = k.lastIndexOf(d.startsWith('./') ? d.slice(2) : d);
  if (idx >= 0) {
    const suffix = k.slice(idx + (d.startsWith('./') ? d.length - 2 : d.length));
    const normalized = './' + suffix.replace(/^\/+/, '');
    return normalized;
  }
  return k;
}





