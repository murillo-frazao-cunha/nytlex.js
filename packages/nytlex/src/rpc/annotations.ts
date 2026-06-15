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
/**
 * Símbolo único para marcar funções expostas.
 * Usamos Symbol para garantir que não possa ser falsificado via JSON no payload.
 */
export const RPC_EXPOSED_KEY = Symbol('__rpc_exposed__');

type AnyFn = (...args: any[]) => any;

/**
 * Marca uma ou mais funções como seguras para RPC.
 */
export default function Expose<T extends AnyFn>(fn: T): T;
export default function Expose<T extends AnyFn[]>(fns: [...T]): T;
export default function Expose<T extends AnyFn[]>(...fns: T): T;
export default function Expose(...input: any[]): any {
    const fns: AnyFn[] =
        Array.isArray(input[0]) ? input[0] : input;

    for (const fn of fns) {
        if (typeof fn !== 'function') {
            throw new TypeError('Expose aceita apenas funções');
        }
        (fn as any)[RPC_EXPOSED_KEY] = true;
    }

    // Retorno:
    // - se veio uma função → retorna ela
    // - se veio lista → retorna a lista
    return input.length === 1 ? input[0] : input;
}
