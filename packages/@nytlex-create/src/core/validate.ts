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
import * as fs from "node:fs";
import * as path from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function validateAppName(appName: string) {
  const name = appName.trim();
  if (!name) throw new Error("App name cannot be empty.");

  if (name.includes(path.sep) || name.includes("/") || name.includes("\\")) {
    throw new Error("App name must be a folder name, not a path.");
  }

  if (/[<>:"/\\|?*]/.test(name)) {
    throw new Error("App name contains invalid filename characters.");
  }

  if (name.length > 214) {
    throw new Error("App name is too long.");
  }

  if (name === "." || name === "..") {
    throw new Error("App name cannot be '.' or '..'.");
  }

  const upper = name.toUpperCase();
  const base = upper.split(".")[0];
  if (WINDOWS_RESERVED_NAMES.has(base)) {
    throw new Error(`App name '${name}' is reserved on Windows.`);
  }

  return name;
}

export function assertTargetDirIsSafeEmpty(rootDir: string) {
  if (!fs.existsSync(rootDir)) return;

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    throw new Error(`Target path '${rootDir}' already exists and isn't a directory.`);
  }

  const entries = fs.readdirSync(rootDir);
  if (entries.length > 0) {
    throw new Error(`Target directory '${rootDir}' already exists and isn't empty.`);
  }
}
