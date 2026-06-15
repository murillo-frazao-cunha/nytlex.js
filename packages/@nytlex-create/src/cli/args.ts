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
import type { CreateAppOptions } from "../core/types";

function normalizeAliasPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "@/";

  if (trimmed.endsWith("/*")) return trimmed.slice(0, -1);
  if (trimmed.endsWith("/")) return trimmed;
  return `${trimmed}/`;
}

function readArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

export function parseArgs(argv: string[]): CreateAppOptions {
  const args = argv.slice(2);
  const appName = args.find((a) => a.length > 0 && !a.startsWith("-"));

  const tailwindFlag = args.includes("--tailwind") || args.includes("-t");
  const noInstallFlag = args.includes("--no-install");
  const installFlag = args.includes("--install");
  const noExamplesFlag = args.includes("--no-examples");
  const examplesFlag = args.includes("--examples");
  const noAliasFlag = args.includes("--no-alias");
  const aliasValue = readArgValue(args, "--alias");
  const reactFlag = args.includes("--react");
  const vueFlag = args.includes("--vue");

  return {
    appName,
    tailwind: tailwindFlag ? true : undefined,
    examples: noExamplesFlag ? false : examplesFlag ? true : undefined,
    install: noInstallFlag ? false : installFlag ? true : undefined,
    moduleAlias: noAliasFlag ? false : aliasValue ? true : undefined,
    alias: aliasValue ? normalizeAliasPrefix(aliasValue) : undefined,
    typeScript: args.includes("--typescript") || args.includes("-ts") ? true : undefined,
    framework: reactFlag ? "react" : vueFlag ? "vue" : undefined,
  };
}

export function normalizeAlias(raw: string): string {
  return normalizeAliasPrefix(raw);
}
