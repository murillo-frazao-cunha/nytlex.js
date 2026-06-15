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
import fs from "fs";
import path from "path";
import Console from "../api/console";

function parse(src: string): { [key: string]: string } {
  const obj: { [key: string]: string } = {};
  const lines = src.toString().split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#') || trimmedLine === '') {
      continue;
    }

    const match = trimmedLine.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      obj[key] = value;
    }
  }
  return obj;
}

function applyEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = parse(fileContent);

    for (const key in parsed) {
      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = parsed[key];
      }
    }
  } catch (e) {
    Console.error(`Error loading env file ${filePath}:`, e);
  }
}

export const loadEnv = (options: { dir: string, dev: boolean; envFiles?: string[] }) => {
  const { dir, dev, envFiles = [] } = options;
  const filesToLoad = [".env", ...envFiles].map((file) => path.join(dir, file));

  filesToLoad.forEach(applyEnv);
  if (dev) {
    for (const file of filesToLoad) {
      if (fs.existsSync(file)) {
        let watchTimeout: any;

        fs.watch(file, (eventType) => {
          if (eventType === 'change') {
            // Limpa o timeout anterior para evitar execuções múltiplas
            clearTimeout(watchTimeout);

            // Define um novo timeout de 100ms
            watchTimeout = setTimeout(() => {
              Console.info(`Reloading environment variables from ${path.basename(file)}.`);
              applyEnv(file);
            }, 100);
          }
        });
      }
    }
  }
};
