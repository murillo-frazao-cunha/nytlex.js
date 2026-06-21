/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 itsmuzin
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
import Console from "nytlex/console";
import type { CreateAppContext } from "../core/types";

async function getLatest(pkg: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    const data = await response.json() as { version: string };
    return data.version;
  } catch (error) {
    Console.error(`Could not check for the latest ${pkg} version:`, error);
    return fallback;
  }
}

export async function buildPackageJson(
  ctx: Pick<CreateAppContext, "appName" | "nytlexVersion" | "willTailwind" | "typeScript" | "framework">,
) {
  const [version, typesNodeVersion] = await Promise.all([getLatest("nytlex", ctx.nytlexVersion), getLatest("@types/node", "20.11.0")]);

  const packageJson: any = {
    name: ctx.appName,
    version: "0.1.0",
    description: "Basic application for Nytlex.js framework",
    scripts: {
      start: "nytlex start",
      dev: "nytlex dev",
      build: "nytlex build",
    },
    dependencies: {
      nytlex: `^${version}`,
    },
    devDependencies: {
      "@types/node": `^${typesNodeVersion}`,
    },
  };

  if (ctx.framework === "react") {
    const [reactVer, reactDomVer, typesReactVer] = await Promise.all([
      getLatest("react", "19.2.3"),
      getLatest("react-dom", "19.2.3"),
      getLatest("@types/react", "19.2.8"),
    ]);

    packageJson.dependencies = {
      ...packageJson.dependencies,
      react: `^${reactVer}`,
      "react-dom": `^${reactDomVer}`,
    };
    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      "@types/react": `^${typesReactVer}`,
    };
  } else if (ctx.framework === "vue") {
    const vueVer = await getLatest("vue", "3.5.27");
    packageJson.dependencies = {
      ...packageJson.dependencies,
      vue: `^${vueVer}`,
    };
  } else if (ctx.framework === "svelte") {
    const svelteVer = await getLatest("svelte", "5.56.3");
    packageJson.dependencies = {
      ...packageJson.dependencies,
      svelte: `^${svelteVer}`,
    };
  }

  if (ctx.typeScript) {
    const [tsVer, tsNodeVer] = await Promise.all([getLatest("typescript", "5.9.3"), getLatest("ts-node", "10.9.2")]);

    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      typescript: `^${tsVer}`,
    };
    packageJson.dependencies = {
      ...packageJson.dependencies,
      "ts-node": `^${tsNodeVer}`,
    };
  }

  if (ctx.willTailwind) {
    const [tailwindVer, tailwindPostcssVer, postcssVer, autoprefixerVer] = await Promise.all([
      getLatest("tailwindcss", "4.1.18"),
      getLatest("@tailwindcss/postcss", "4.1.18"),
      getLatest("postcss", "8.5.6"),
      getLatest("autoprefixer", "10.4.23"),
    ]);

    packageJson.dependencies = {
      ...packageJson.dependencies,
      tailwindcss: `^${tailwindVer}`,
      "@tailwindcss/postcss": `^${tailwindPostcssVer}`,
      postcss: `^${postcssVer}`,
      autoprefixer: `^${autoprefixerVer}`,
    };
  }

  return packageJson;
}
