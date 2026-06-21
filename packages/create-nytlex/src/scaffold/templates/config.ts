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
export function nytlexConfigTemplate(typescript: boolean) {
  if (!typescript) {
    return `
const nytlexConfig = (phase, { defaultConfig }) => {
    return {
        ...defaultConfig
    };
};

export default nytlexConfig;
    `;
  }

  return `import type { NytlexConfigFunction } from 'nytlex';

const nytlexConfig: NytlexConfigFunction = (phase, { defaultConfig }) => {
    return {
        ...defaultConfig
    };
};

export default nytlexConfig;`;
}

export function tsconfigTemplate(opts?: { moduleAlias?: string | false }) {
  const aliasPrefix = opts?.moduleAlias;
  const willAlias = typeof aliasPrefix === "string" && aliasPrefix.length > 0;

  const normalizedPrefix = willAlias ? (aliasPrefix.endsWith("/") ? aliasPrefix : `${aliasPrefix}/`) : "@/";
  const aliasKey = `${normalizedPrefix}*`;

  const aliasBlock = willAlias
    ? `,
    "paths": {
      "${aliasKey}": ["./src/*"]
    }`
    : "";

  return `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "rootDir": "./src",
    "outDir": "./dist",
    "moduleResolution": "nodenext",
    "types": ["nytlex/global", "node"]${aliasBlock}
  },
  "ts-node": {
    "transpileOnly": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;
}
