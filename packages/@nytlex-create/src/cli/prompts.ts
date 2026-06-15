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
import Console, { Colors } from "nytlex/console";
import type { CreateAppOptions } from "../core/types";
import { normalizeAlias } from "./args";

type ResolvedCreateAppOptions = Required<Omit<CreateAppOptions, "appName">> & { appName: string };

async function askFramework(): Promise<"react" | "vue" | "svelte"> {
  const selected = await Console.selection("What framework do you want to use?", {
    react: "React",
    vue: "Vue",
    svelte: "Svelte",
  });
  console.log("");
  return selected.toLowerCase() === "vue" ? "vue" : selected.toLowerCase() === "svelte" ? "svelte" : "react";
}

export async function promptForMissingOptions(opts: CreateAppOptions): Promise<ResolvedCreateAppOptions> {
  let appName = opts.appName;
  if (appName === undefined) {
    appName = await Console.ask("What is the name of your app?", "my-nytlex-app");
    console.log("             ");
  }

  let framework = opts.framework;
  if (framework === undefined) {
    framework = await askFramework();
  }

  const recommendedOptions: CreateAppOptions = {
    appName,
    tailwind: true,
    examples: true,
    install: true,
    moduleAlias: true,
    alias: "@/",
    typeScript: true,
    framework,
  };

  const frameworkName = framework === "react" ? "React" : framework === "vue" ? "Vue" : "Svelte";
  const recommended = await Console.selection(`Would you like to use the recommended options? (${frameworkName})`, {
    yes: `${Colors.Underscore}Yes, use recommended defaults - TypeScript, Tailwind CSS, Module Alias`,
    no: "No, customize settings",
  });

  if (recommended !== "no") {
    return {
      appName: recommendedOptions.appName!,
      tailwind: recommendedOptions.tailwind!,
      examples: recommendedOptions.examples!,
      install: recommendedOptions.install!,
      moduleAlias: recommendedOptions.moduleAlias!,
      alias: recommendedOptions.alias!,
      typeScript: recommendedOptions.typeScript!,
      framework: recommendedOptions.framework!,
    };
  }

  let typeScript = opts.typeScript;
  if (typeScript === undefined) {
    typeScript = await Console.confirm("Do you want to use typescript?", true);
    console.log("  ");
  }

  let tailwind = opts.tailwind;
  if (tailwind === undefined) {
    tailwind = await Console.confirm("Do you want to include Tailwind CSS?", true);
    console.log("             ");
  }

  let examples = opts.examples;
  if (examples === undefined) {
    examples = await Console.confirm("Do you want to include example routes?", true);
    console.log(" ");
  }

  let moduleAlias = opts.moduleAlias;
  if (moduleAlias === undefined) {
    moduleAlias = await Console.confirm("Do you want to set a module alias?", true);
    console.log(" ");
  }

  let alias = opts.alias;
  if (moduleAlias) {
    if (alias === undefined) {
      alias = await Console.ask("Which alias do you want to set?", "@/");
      console.log(" ");
    }
    alias = normalizeAlias(alias);
  } else {
    alias = "@/";
  }

  let install = opts.install;
  if (install === undefined) {
    install = await Console.confirm("Do you want to install dependencies?", true);
    console.log("             ");
  }

  return {
    appName: appName!,
    tailwind: tailwind!,
    examples: examples!,
    install: install!,
    moduleAlias: moduleAlias!,
    alias: alias!,
    typeScript: typeScript!,
    framework: framework!,
  };
}
