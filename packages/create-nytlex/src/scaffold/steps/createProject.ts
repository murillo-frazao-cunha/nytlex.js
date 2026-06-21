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
import { ensureDir, writeJson } from "../fs";
import { buildPackageJson } from "../packageJson";

export async function createProject(ctx: CreateAppContext) {
  const dynamic = Console.dynamicLine("Creating your Nytlex.js app...");

  ensureDir(ctx.rootDir);

  ctx.packageJson = await buildPackageJson({
    appName: ctx.appName,
    nytlexVersion: ctx.nytlexVersion,
    willTailwind: ctx.willTailwind,
    typeScript: ctx.typeScript,
    framework: ctx.framework,
  });

  writeJson(path.join(ctx.rootDir, "package.json"), ctx.packageJson);
  dynamic.end("Created project directory and package.json");
}
