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
export type CreateAppOptions = {
  /** If omitted, we prompt */
  appName?: string;
  tailwind?: boolean;
  examples?: boolean;
  install?: boolean;

  /** If omitted, we prompt (default: true) */
  moduleAlias?: boolean;

  /** Alias prefix to use when moduleAlias=true (default: "@/") */
  alias?: string;

  typeScript?: boolean;

  framework?: "react" | "vue" | "svelte";
};

export type CreateAppContext = {
  appName: string;
  rootDir: string;
  willTailwind: boolean;
  willRouteExample: boolean;
  willInstallDependencies: boolean;

  willUseModuleAlias: boolean;

  /** Normalized alias prefix (ex: "@/") */
  moduleAlias: string;

  /** computed */
  nytlexVersion: string;

  packageJson: Record<string, unknown>;
  typeScript: boolean;
  framework: "react" | "vue" | "svelte";
};
