/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * ...
 */
import type { AuthProviderClass, AuthRoute, User } from '../types';
import { NytlexRequest, NytlexResponse } from 'nytlex';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    type RegistrationResponseJSON,
    type AuthenticationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Funções auxiliares para serializar/desserializar Buffer
 */
function bufferToBase64(buffer: Uint8Array | Buffer | any): string {
    if (typeof buffer === 'string') return buffer; // Já é string
    if (buffer instanceof Uint8Array || Buffer.isBuffer(buffer)) {
        return Buffer.from(buffer).toString('base64');
    }
    return String(buffer);
}

type JsonBuffer1 = { type: "Buffer"; data: number[] };
type JsonBuffer2 = { data: number[] };
type JsonBytes = { bytes: number[] };
type WithBuffer = { buffer: unknown; byteOffset?: number; byteLength?: number };

function toUint8Array(input: unknown): Uint8Array<ArrayBuffer> {
  if (input == null) throw new TypeError("toUint8Array: input is null/undefined");

  // Uint8Array / Buffer
  if (input instanceof Uint8Array) {
    const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
    return new Uint8Array(ab) as Uint8Array<ArrayBuffer>;
  }

  // ArrayBuffer
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input) as Uint8Array<ArrayBuffer>;
  }

  // number[]
  if (Array.isArray(input) && input.every(n => typeof n === "number")) {
    const u8 = Uint8Array.from(input);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    return new Uint8Array(ab) as Uint8Array<ArrayBuffer>;
  }

  // base64/base64url string
  if (typeof input === "string") {
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const buf = Buffer.from(b64 + pad, "base64");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new Uint8Array(ab) as Uint8Array<ArrayBuffer>;
  }

  // object cases
  if (typeof input === "object") {
    const obj = input as any;

    // { type:"Buffer", data:[...] }
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      return toUint8Array(obj.data);
    }

    // { data:[...] }
    if (Array.isArray(obj.data)) {
      return toUint8Array(obj.data);
    }

    // { bytes:[...] }
    if (Array.isArray(obj.bytes)) {
      return toUint8Array(obj.bytes);
    }

    // { buffer: ... } wrapper
    if (obj.buffer != null) {
      // às vezes vem { buffer: { type:"Buffer", data:[...] } }
      return toUint8Array(obj.buffer);
    }

    // array-like: {0:12,1:34,length:2}
    if (typeof obj.length === "number") {
      const arr = Array.from({ length: obj.length }, (_, i) => obj[i]);
      if (arr.every(n => typeof n === "number")) {
        return toUint8Array(arr);
      }
    }

        // numeric-key object without length: {"0":165,"1":1,...}
        const numericKeys = Object.keys(obj).filter(key => /^\d+$/.test(key));
        if (numericKeys.length > 0) {
            const arr = numericKeys
                .sort((a, b) => Number(a) - Number(b))
                .map(key => obj[key]);
            if (arr.every(n => typeof n === "number")) {
                return toUint8Array(arr);
            }
        }
  }

  throw new TypeError(`toUint8Array: unsupported input type: ${Object.prototype.toString.call(input)}`);
}

/**
 * Interface que o desenvolvedor final DEVE implementar para conectar o próprio Banco de Dados.
 * Como Passkeys exigem guardar "Challenges" temporários e as Chaves Públicas,
 * abstraímos isso para dar liberdade total.
 */
export interface PasskeyStorage {
    // ---- Desafios Temporários (Challenges) ----
    saveChallenge: (username: string, challenge: string) => Promise<void>;
    getChallenge: (username: string) => Promise<string | null>;
    deleteChallenge: (username: string) => Promise<void>;

    // ---- Credenciais (Chaves Públicas) ----
    // O credential agora pode receber um "name" (Ex: "Meu iPhone")
    saveCredential: (username: string, credential: any) => Promise<void>;
    getUserCredentials: (username: string) => Promise<any[]>;
    updateCredentialCounter: (credentialID: string, newCounter: number) => Promise<void>;

    // ---- Usuário ----
    // Retorna o formato final do User pro Nytlex.js gerar a sessão após o login
    getUserByUsername: (username: string) => Promise<User | null>;
}

export interface PasskeysConfig {
    id?: string;
    name?: string;
    rpName: string; // Nome do seu site (Ex: "Meu App")
    rpID?: string;   // Opcional: Domínio (Ex: "localhost" ou "meuapp.com")
    origin?: string; // Opcional: URL completa (Ex: "http://localhost:3000")
    storage: PasskeyStorage; // A interface implementada pelo usuário
}

/**
 * Provider para autenticação sem senha usando Passkeys (WebAuthn / FIDO2)
 * * Fluxo de Registro:
 * 1. POST /api/auth/passkeys/register/start -> Gera opções pro dispositivo
 * 2. POST /api/auth/passkeys/register/finish -> Valida e salva no DB (via Storage)
 * * Fluxo de Login:
 * 1. POST /api/auth/passkeys/login/start -> Gera opções de login
 * 2. POST /api/auth/signin -> O Nytlex direciona para o `handleSignIn` deste provider
 */
export class PasskeysProvider implements AuthProviderClass {
    public readonly id: string;
    public readonly name: string;
    public readonly type: string = 'passkeys';

    private config: PasskeysConfig;
    // Map para armazenar challenges temporários de login (não-persistentes)
    private loginChallenges: Map<string, { challenge: string; timestamp: number }> = new Map();

    constructor(config: PasskeysConfig) {
        this.config = config;
        this.id = config.id || 'passkeys';
        this.name = config.name || 'Passkeys';
        
        // Limpa challenges expirados a cada 5 minutos (TTL de 10 minutos)
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.loginChallenges.entries()) {
                if (now - value.timestamp > 10 * 60 * 1000) {
                    this.loginChallenges.delete(key);
                }
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Função auxiliar para pegar a origem e o RPID dinamicamente pela requisição, 
     * se não foram informados estaticamente na configuração.
     */
    private getRequestInfo(req?: NytlexRequest) {
        let origin = this.config.origin;
        
        if (!origin && req) {
            // Lida tanto com API Fetch nativa (headers.get) quanto Node.js plain (headers.origin)
            if (typeof req.headers?.get === 'function') {
                
                const originHeader = req.headers['origin'] || req.headers['host'];
                origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
                if (!origin) {
                    const hostHeader = req.headers['host'];
                    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
                    if (host) origin = `http://${host}`; // Fallback para host
                }
            } else if (req.headers) {
                // @ts-ignore
                origin = req.headers.origin || (req.headers.host ? `http://${req.headers.host}` : undefined);
            }
        }
        
        // Fallback final
        origin = origin || 'http://localhost:3000';

        let rpID = this.config.rpID;
        if (!rpID) {
            try {
                rpID = new URL(origin).hostname;
            } catch (e) {
                rpID = 'localhost';
            }
        }

        return { origin, rpID };
    }

    /**
     * O Nytlex chama este método quando o front-end envia as credenciais para o endpoint genérico de login.
     * Para Passkeys, o "credentials" conterá o username e o response JSON gerado pelo navegador.
     */
    async handleSignIn(credentials: Record<string, string>, req?: NytlexRequest): Promise<User | null> {
        try {
            const { response: responseString, sessionId } = credentials;

            if (!responseString || !sessionId) {
                console.error(`[${this.id} Provider] Missing response payload or sessionId`);
                return null;
            }

            const { origin, rpID } = this.getRequestInfo(req);
            const response = JSON.parse(responseString) as AuthenticationResponseJSON;
            
            // Recupera o challenge do Map de login (temporário, não do storage)
            const challengeData = this.loginChallenges.get(`passkey:${sessionId}`);
            const expectedChallenge = challengeData?.challenge || null;

            if (!expectedChallenge) {
                console.error(`[${this.id} Provider] No active challenge found`);
                return null;
            }

            // O response.id é a credentialID. Precisamos encontrar qual usuário possui essa chave
            // Como não sabemos o username, a implementação do storage deve permitir buscar por credentialID
            // Para isso, você pode adicionar um método como findUsernameByCredentialID
            // 
            // Alternativa: Como o userHandle é enviado no response da discoverable credential,
            // podemos decodificá-lo para obter o username original
            let username: string | null = null;
            
            // Tenta extrair username do userHandle (armazenado durante registro)
            if (response.response.userHandle) {
                try {
                    username = Buffer.from(response.response.userHandle, 'base64').toString('utf-8');
                } catch (e) {
                    console.error(`[${this.id} Provider] Could not decode userHandle`);
                }
            }

            if (!username) {
                console.error(`[${this.id} Provider] Could not determine username from credential`);
                return null;
            }

            // Agora que temos o username, busca a chave específica
            const userPasskeys = await this.config.storage.getUserCredentials(username);
            const passkey = userPasskeys.find(key => key.credentialID === response.id);

            if (!passkey) {
                console.error(`[${this.id} Provider] Credential not found for user`);
                return null;
            }

            // Valida a resposta com a biblioteca (V13+)
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                credential: {
                    id: passkey.credentialID,
                    publicKey: toUint8Array(passkey.credentialPublicKey),
                    counter: passkey.counter,
                    transports: passkey.transports,
                },
            });

            if (verification.verified) {
                // Atualiza o contador de segurança e deleta o challenge do Map
                await this.config.storage.updateCredentialCounter(passkey.credentialID, verification.authenticationInfo.newCounter);
                this.loginChallenges.delete(`passkey:${sessionId}`);

                // Busca o objeto completo do usuário no banco para o Nytlex.js iniciar a sessão
                const user = await this.config.storage.getUserByUsername(username);
                
                if (!user) return null;

                return {
                    ...user,
                    provider: this.id,
                    providerId: username
                };
            }

            return null;

        } catch (error) {
            console.error(`[${this.id} Provider] Error during sign in (WebAuthn):`, error);
            return null;
        }
    }

    /**
     * Retorna configuração pública do provider
     */
    getConfig(): any {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            rpName: this.config.rpName,
            rpID: this.config.rpID, // Se omitido, continuará extraindo on-the-fly
        };
    }

    /**
     * Rotas adicionais para lidar com a geração de chaves (Registro) e inicio de Login
     */
    public additionalRoutes: AuthRoute[] = [
        // ==========================================
        // REGISTRO - PASSO 1 (START)
        // ==========================================
        {
            method: 'POST',
            path: '/api/auth/passkeys/register/start',
            handler: async (req: NytlexRequest) => {
                try {
                    const body = await req.json();
                    const { username } = body;
                    const { rpID } = this.getRequestInfo(req);

                    if (!username) return NytlexResponse.json({ error: 'Username required' }, { status: 400 });

                    // Usando buffer corretamente para V13+
                    const options = await generateRegistrationOptions({
                        rpName: this.config.rpName,
                        rpID,
                        userID: new Uint8Array(Buffer.from(username)),
                        userName: username,
                        attestationType: 'none',
                        authenticatorSelection: {
                            residentKey: 'required', // Obrigatório para discoverable credentials
                            userVerification: 'preferred',
                        },
                    });

                    // Salva desafio no banco de dados customizado do usuário
                    await this.config.storage.saveChallenge(username, options.challenge);

                    return NytlexResponse.json(options);
                } catch (error: any) {
                    return NytlexResponse.json({ error: error.message }, { status: 500 });
                }
            }
        },
        // ==========================================
        // REGISTRO - PASSO 2 (FINISH)
        // ==========================================
        {
            method: 'POST',
            path: '/api/auth/passkeys/register/finish',
            handler: async (req: NytlexRequest) => {
                try {
                    const body = await req.json();
                    const { origin, rpID } = this.getRequestInfo(req);
                    
                    // Agora aceitamos um "name" opcional no body (Ex: "PC do Trabalho")
                    const { username, response, name } = body as { 
                        username: string; 
                        response: RegistrationResponseJSON;
                        name?: string;
                    };

                    const expectedChallenge = await this.config.storage.getChallenge(username);
                    if (!expectedChallenge) return NytlexResponse.json({ error: 'Challenge expired/not found' }, { status: 400 });

                    const verification = await verifyRegistrationResponse({
                        response,
                        expectedChallenge,
                        expectedOrigin: origin,
                        expectedRPID: rpID,
                    });

                    if (verification.verified && verification.registrationInfo) {
                        const { credential } = verification.registrationInfo;
                        
                        // Formata a credencial e salva no DB do dev
                        await this.config.storage.saveCredential(username, {
                            credentialID: credential.id,
                            credentialPublicKey: bufferToBase64(credential.publicKey),
                            counter: credential.counter,
                            transports: response.response.transports,
                            name: name || 'Chave de Acesso', // Salva o nome ou um padrão
                        });

                        await this.config.storage.deleteChallenge(username);
                        return NytlexResponse.json({ success: true });
                    }

                    return NytlexResponse.json({ success: false }, { status: 400 });
                } catch (error: any) {
                    return NytlexResponse.json({ error: error.message }, { status: 500 });
                }
            }
        },
        // ==========================================
        // LOGIN - PASSO 1 (START)
        // ==========================================
        {
            method: 'POST',
            path: '/api/auth/passkeys/login/start',
            handler: async (req: NytlexRequest) => {
                try {
                    const { rpID } = this.getRequestInfo(req);

                    // Não precisa de username - usa discoverable credentials
                    // O navegador mostrará as keys disponíveis automaticamente
                    const options = await generateAuthenticationOptions({
                        rpID,
                        userVerification: 'preferred',
                        // Omitindo allowCredentials para permitir discoverable credentials
                    });

                    // Gera um sessionId único para esta tentativa de login
                    const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID 
                        ? crypto.randomUUID() 
                        : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

                    // Salva o challenge no Map temporário (não usa storage)
                    this.loginChallenges.set(`passkey:${sessionId}`, {
                        challenge: options.challenge,
                        timestamp: Date.now()
                    });

                    return NytlexResponse.json({ options, sessionId });
                } catch (error: any) {
                    return NytlexResponse.json({ error: error.message }, { status: 500 });
                }
            }
        },
        // ==========================================
        // LISTAR CREDENCIAIS (Para mostrar na UI)
        // ==========================================
        {
            method: 'POST', // Usando POST para facilitar o envio do username no body
            path: '/api/auth/passkeys/list',
            handler: async (req: NytlexRequest) => {
                try {
                    const body = await req.json();
                    const { username } = body;

                    if (!username) return NytlexResponse.json({ error: 'Username required' }, { status: 400 });

                    const credentials = await this.config.storage.getUserCredentials(username);
                    
                    // Retorna as credenciais limpando a chave pública (boa prática de segurança para o Front-end)
                    const safeCredentials = credentials.map(cred => ({
                        id: cred.credentialID,
                        name: cred.name || 'Chave de Acesso',
                        transports: cred.transports,
                        createdAt: cred.createdAt // Caso o dev salve a data no banco dele
                    }));

                    return NytlexResponse.json({ success: true, credentials: safeCredentials });
                } catch (error: any) {
                    return NytlexResponse.json({ error: error.message }, { status: 500 });
                }
            }
        }
    ];
}