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
import * as path from "node:path";
import type { CreateAppContext } from "../../core/types";
import { ensureDir, writeFile } from "../fs";
import { globalsCssTemplate } from "../templates/common";
import { layoutJsxTemplate, layoutTsxTemplate } from "../templates/react";
import { vueExampleLayout } from "../templates/vue";
import {svelteExampleLayout} from "../templates/svelte";

export async function createProjectStructure(ctx: CreateAppContext) {
  const dynamic = Console.dynamicLine("Creating project structure...");

  ensureDir(path.join(ctx.rootDir, "src", "backend", "routes"));
  ensureDir(path.join(ctx.rootDir, "src", "web"));

  writeFile(path.join(ctx.rootDir, "src", "web", "globals.css"), globalsCssTemplate(ctx.willTailwind));
  if (ctx.framework === "react") {
    writeFile(path.join(ctx.rootDir, "src", "web", `layout.${ctx.typeScript ? "tsx" : "jsx"}`), ctx.typeScript ? layoutTsxTemplate() : layoutJsxTemplate());
  } else if (ctx.framework === "vue") {
    writeFile(path.join(ctx.rootDir, "src", "web", "layout.vue"), vueExampleLayout(ctx.typeScript));
  } else if(ctx.framework === "svelte") {
    writeFile(path.join(ctx.rootDir, "src", "web", "layout.svelte"), svelteExampleLayout(ctx.typeScript));
  }

  dynamic.end("Created project structure");
}
