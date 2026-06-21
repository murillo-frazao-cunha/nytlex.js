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
import * as path from "node:path";
import { parseArgs } from "../cli/args";
import { promptForMissingOptions } from "../cli/prompts";
import { steps } from "../scaffold/steps";
import { assertTargetDirIsSafeEmpty, validateAppName } from "./validate";
import { printSummary } from "./summary";
import type { CreateAppContext, CreateAppOptions } from "./types";

function resolveOwnPackageJson() {
  const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(pkgPath);
}

export async function createAppFromArgv(argv: string[]) {
  const opts = parseArgs(argv);
  return createApp(opts);
}

export async function createApp(options: CreateAppOptions) {
  const resolved = await promptForMissingOptions(options);
  const safeName = validateAppName(resolved.appName);
  const rootDir = safeName;

  assertTargetDirIsSafeEmpty(rootDir);
  const ownPkg = resolveOwnPackageJson();

  const ctx: CreateAppContext = {
    appName: safeName,
    rootDir,
    willTailwind: resolved.tailwind,
    willRouteExample: resolved.examples,
    willInstallDependencies: resolved.install,
    willUseModuleAlias: resolved.moduleAlias,
    moduleAlias: resolved.alias,
    nytlexVersion: ownPkg.version,
    packageJson: {},
    typeScript: resolved.typeScript,
    framework: resolved.framework,
  };

  console.clear();

  for (const step of steps) {
    if (step.condition?.(ctx) === false) continue;
    await step.action(ctx);
  }

  printSummary(ctx);
}
