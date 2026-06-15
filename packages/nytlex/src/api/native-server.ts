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
import koffi from 'koffi';
import path from 'path';
import fs from 'fs';
import { coreGoManager } from '../index';

export interface NativeServerOptions {
    httpPort: string;
    httpsPort: string;
    http3Port?: string;
    devMode: string;
    certPath: string;
    keyPath: string;
    onData: (connId: number, data: Buffer) => void;
    onClose?: (connId: number) => void;
    customLibPath?: string;
}

// Interface de retorno mapeando o JSON que vem do Go
export interface NativeServerResult {
    status?: string;
    httpPort?: string;
    httpsPort?: string;
    http3Port?: string;
}

const OnDataCallback = koffi.proto('void OnDataCallback(int connID, void* data, int length)');
const OnCloseCallback = koffi.proto('void OnCloseCallback(int connID)');

export class NativeServer {
    private static lib: any = null;
    private static startFunc: any = null;
    private static writeFunc: any = null;
    private static closeConnFunc: any = null;

    private static registeredCallbacks: any[] = [];

    public static getLibPath(): string {
        return coreGoManager.getFile();
    }

    private static loadLibrary(customPath?: string) {
        if (this.lib) return;

        let libPath = customPath || this.getLibPath();

        if (!fs.existsSync(libPath)) {
            const altPath = path.resolve(process.cwd(), libPath);
            const altPathSimple = path.resolve(process.cwd(), path.basename(libPath));

            if (fs.existsSync(altPath)) {
                libPath = altPath;
            } else if (fs.existsSync(altPathSimple)) {
                libPath = altPathSimple;
            } else {
                console.warn(`Native Server Library not found at: ${libPath}`);
                return;
            }
        }

        try {
            this.lib = koffi.load(libPath);

            this.startFunc = this.lib.func('StartServer', 'str', [
                'str', 'str', 'str', 'str',
                koffi.pointer(OnDataCallback),
                koffi.pointer(OnCloseCallback),
                'str',
                'str'
            ]);

            this.writeFunc = this.lib.func('WriteToConn', 'str', ['int', 'void*', 'int']);
            this.closeConnFunc = this.lib.func('CloseConn', 'void', ['int']);

        } catch (error) {
            throw new Error(`Failed to load native library at ${libPath}: ${error}`);
        }
    }

    public static start(options: NativeServerOptions): NativeServerResult | void {
        const {
            httpPort,
            httpsPort,
            certPath,
            keyPath,
            onData,
            onClose,
            customLibPath,
            http3Port,
            devMode
        } = options;

        this.loadLibrary(customLibPath);

        if (!this.startFunc) return;

        // Validação removida do Node pois o Go agora faz a verificação mais robusta e segura
        // sincronicamente, evitando redundância e "race conditions".

        const onDataPtr = koffi.register((connId: number, ptr: any, len: number) => {
            try {
                const buffer = Buffer.from(koffi.decode(ptr, 'uint8', len));
                onData(connId, buffer);
            } catch (e) {
                console.error("Error inside NativeServer onData callback:", e);
            }
        }, koffi.pointer(OnDataCallback));

        const onClosePtr = koffi.register((connId: number) => {
            try {
                if (onClose) onClose(connId);
            } catch (e) {
                console.error("Error inside NativeServer onClose callback:", e);
            }
        }, koffi.pointer(OnCloseCallback));

        this.registeredCallbacks.push(onDataPtr, onClosePtr);

        // Chamada síncrona para o C/Go
        const resultStr = this.startFunc(
            httpPort,
            httpsPort,
            certPath,
            keyPath,
            onDataPtr,
            onClosePtr,
            http3Port || '',
            devMode || ''
        );

        // Tratamento profissional de erro / retorno JSON
        if (resultStr) {
            try {
                const parsed = JSON.parse(resultStr);
                if (parsed.error) {
                    throw new Error(`Native Server Start Error: ${parsed.error}`);
                }
                return parsed as NativeServerResult;
            } catch (e) {
                if (e instanceof SyntaxError) {
                    // Fallback caso não seja JSON (por proteção)
                    throw new Error(`Native Server Start Error: ${resultStr}`);
                }
                throw e;
            }
        }
    }

    public static write(connId: number, data: Buffer | string): void {
        if (!this.writeFunc) return;

        let buffer: Buffer;
        if (typeof data === 'string') {
            buffer = Buffer.from(data);
        } else {
            buffer = data;
        }

        const err = this.writeFunc(connId, buffer, buffer.length);
        if (err) {
            // console.error(`Write error to conn ${connId}: ${err}`);
        }
    }

    public static closeConnection(connId: number): void {
        if (!this.closeConnFunc) return;
        this.closeConnFunc(connId);
    }
}

export const startServer = (options: NativeServerOptions) => {
    return NativeServer.start(options);
};

export const writeToConnection = (id: number, data: Buffer | string) => {
    return NativeServer.write(id, data);
};

export const closeConnection = (id: number) => {
    return NativeServer.closeConnection(id);
};

export default { start: startServer, write: writeToConnection, close: closeConnection };