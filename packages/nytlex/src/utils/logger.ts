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
import os from 'os';
import Console, { Colors } from "../api/console";
import type { NytlexOptions, NytlexConfig } from '../types';

/**
 * Encontra o IP externo local (rede)
 */
export function getLocalExternalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const ifaceList = interfaces[name];
        if (ifaceList) {
            for (const iface of ifaceList) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }
    return 'localhost'; // Fallback
}

export const sendBox = (options: NytlexOptions, config: NytlexConfig) => {
    const isDev = options.dev;
    // @ts-ignore
    const isSSL = config.ssl && config.ssl.key && config.ssl.cert;
    const protocol = isSSL ? 'https' : 'http';
    const localIp = getLocalExternalIp();

    // Estilos Clean
    const labelStyle = Colors.FgGray;
    const urlStyle = Colors.Bright + Colors.FgCyan; // Ciano para links é o padrão mais legível
    const now = new Date();
    const time = now.toLocaleTimeString('pt-BR', { hour12: false });
    const timer = ` ${Colors.FgGray}${time}${Colors.Reset}  `

    // Pequeno espaçamento visual antes dos logs de acesso
    console.log('');
    console.log(timer + labelStyle + ' Access on:')
    // 1. Local (Alinhamento: Local tem 6 letras + 4 espaços = 10)
    console.info(timer + `${labelStyle}  ┃  Local:${Colors.Reset}    ${urlStyle}${protocol}://localhost:${config?.port}${Colors.Reset}`);

    // 2. Network (Alinhamento: Network tem 8 letras + 2 espaços = 10)
    if (localIp) {
        console.info(timer + `${labelStyle}  ┃  Network:${Colors.Reset}  ${urlStyle}${protocol}://${localIp}:${config?.port}${Colors.Reset}`);
    }

    if(config?.ssl?.http3Port) {
        console.info(timer + `${labelStyle}  ┃  HTTP/3:${Colors.Reset}   ${urlStyle}${protocol}://${localIp}:${config.ssl.http3Port}${Colors.Reset}`);
    }

    // 3. Infos Extras (Redirect HTTP -> HTTPS)
    // @ts-ignore
    if (isSSL && config.ssl?.redirectPort) {
        // @ts-ignore
        console.info(timer + `${labelStyle}  ┃  Redirect:${Colors.Reset} ${labelStyle}port ${config.ssl.redirectPort} ➜ https${Colors.Reset}`);
    }

    // 4. Info de Ambiente
    if (isDev) {
        console.info(timer + `${labelStyle}  ┃  Mode:${Colors.Reset}     ${Colors.FgAlmostWhite}development${Colors.Reset}`);
    }

    // Espaçamento final
    console.log('\n');
}