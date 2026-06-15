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
import type { CreateAppContext } from "./types";

export function printSummary(ctx: CreateAppContext) {
  console.clear();

  const now = new Date();
  const time = now.toLocaleTimeString("pt-BR", { hour12: false });

  const timer = ` ${Colors.FgGray}${time}${Colors.Reset}  `;
  const label = Colors.FgGray;
  const cmd = Colors.Bright + Colors.FgCyan;
  const ok = Colors.FgGreen;
  const dim = Colors.Dim;
  const bright = Colors.Bright;
  const nodeVersion = process.version;
  const platform = process.platform;

  console.log("");
  console.log(`${timer}${bright}${Colors.FgCyan}Nytlex.js${Colors.Reset} ${dim}v${ctx.nytlexVersion}${Colors.Reset}`);
  console.log(`${timer}${dim}────────────────────────────────────────${Colors.Reset}`);
  console.log(`${timer}${ok}✔${Colors.Reset}  ${bright}Project ${Colors.FgWhite}${ctx.appName}${Colors.Reset}${bright} created successfully.${Colors.Reset}`);

  console.log("");
  console.log(`${timer}${label}Environment:${Colors.Reset}`);
  console.log(`${timer}${label}  • Runtime:${Colors.Reset} ${Colors.Bright + Colors.FgGreen}Node.js${Colors.Reset} ${dim}${nodeVersion}${Colors.Reset}`);
  console.log(`${timer}${label}  • Platform:${Colors.Reset} ${cmd}${platform}${Colors.Reset}`);
  console.log(`${timer}${label}  • Framework:${Colors.Reset} ${cmd}Nytlex.js${Colors.Reset} ${dim}v${ctx.nytlexVersion}${Colors.Reset}`);

  console.log("");
  console.log(`${timer}${label}Next steps:${Colors.Reset}`);
  console.log(`${timer}${label}  1.${Colors.Reset} ${cmd}cd ${ctx.appName}${Colors.Reset}`);

  let step = 2;
  if (!ctx.willInstallDependencies) {
    console.log(`${timer}${label}  ${step++}.${Colors.Reset} ${cmd}npm install${Colors.Reset}`);
  }

  console.log(`${timer}${label}  ${step++}.${Colors.Reset} ${cmd}nytlex dev${Colors.Reset}`);
  console.log(`${timer}${label}     or${Colors.Reset}`);
  console.log(`${timer}${label}     ${cmd}npm run dev${Colors.Reset}`);

  console.log("");
  console.log(`${timer}${label}Production steps:${Colors.Reset}`);
  console.log(`${timer}${label}  1. ${cmd}nytlex build${Colors.Reset}`);
  console.log(`${timer}${label}  2. ${cmd}nytlex start${Colors.Reset}`);
  console.log(`${timer}${label}     or${Colors.Reset}`);
  console.log(`${timer}${label}     ${cmd}npm run start${Colors.Reset}`);
  console.log("");
  console.log(`${timer}${dim}Website:${Colors.Reset} ${Colors.FgCyan}https://nytlex.mfraz.ovh${Colors.Reset}`);
  console.log("");
  console.log();
}
