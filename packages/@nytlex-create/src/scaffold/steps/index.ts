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
import type { CreateAppContext } from "../../core/types";
import { createProject } from "./createProject";
import { createProjectStructure } from "./createProjectStructure";
import { writeNytlexConfig } from "./writeNytlexConfig";
import { writeTsConfig } from "./writeTsConfig";
import { setupTailwind } from "./setupTailwind";
import { createExampleRoutes } from "./createExampleRoutes";
import { installDependencies } from "./installDependencies";

export interface Step {
  label: string;
  action: (ctx: CreateAppContext) => Promise<void>;
  condition?: (ctx: CreateAppContext) => boolean;
}

export const steps: Step[] = [
  {
    label: "Creating project directory and package.json",
    action: createProject,
  },
  {
    label: "Creating project structure",
    action: createProjectStructure,
  },
  {
    label: "Writing nytlex.config.ts",
    action: writeNytlexConfig,
  },
  {
    label: "Initializing TypeScript configuration",
    action: writeTsConfig,
  },
  {
    label: "Setting up Tailwind CSS",
    action: setupTailwind,
    condition: (ctx) => ctx.willTailwind,
  },
  {
    label: "Creating example routes",
    action: createExampleRoutes,
    condition: (ctx) => ctx.willRouteExample,
  },
  {
    label: "Installing dependencies",
    action: installDependencies,
    condition: (ctx) => ctx.willInstallDependencies,
  },
];
