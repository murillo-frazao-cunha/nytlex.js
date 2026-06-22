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

// Este arquivo exporta apenas código seguro para o cliente (navegador)
import Link from "./components/Link.vue"
import {cachedFramework} from "../../api/framework.ts";
export { Link }
export { Metadata } from "../../types.ts";
export { router } from '../../client/clientRouter.ts';
export { requireDynamic } from '../../client/requireDynamic.ts';
// RPC (client-side)
export { importServer } from '../../client/rpc.ts';
export {importPhpServer} from '../../client/rpcPhp.ts';
export { default as Image} from "./components/Image.vue"
export { default as NytlexImage } from "./components/Image.vue"
