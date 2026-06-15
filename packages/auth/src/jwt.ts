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
import crypto from 'crypto';
import type { User, Session } from './types';

export class JWTManager {
    private secret: string;

    constructor(secret?: string) {
        if (!secret && !process.env.NYTLEX_AUTH_SECRET) {
            throw new Error('JWT secret is required. Set NYTLEX_AUTH_SECRET environment variable or provide secret parameter.');
        }

        this.secret = secret || process.env.NYTLEX_AUTH_SECRET!;

        // SECURITY: Enforce minimum secret length
        if (this.secret.length < 32) {
            throw new Error('JWT secret must be at least 32 characters long for security.');
        }

        // SECURITY: Warn about weak/common secrets in development
        const weakSecrets = [
            'your-secret-key',
            'nytlex-test-secret-key-change-in-production',
            'secret',
            'changeme',
            'password',
            '12345678',
            'test-secret',
            'development-secret'
        ];

        if (weakSecrets.some(weak => this.secret.toLowerCase().includes(weak))) {
            console.warn('\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: You are using a weak/common JWT secret!');
            console.warn('\x1b[33m%s\x1b[0m', '   This is a CRITICAL security risk in production.');
            console.warn('\x1b[33m%s\x1b[0m', '   Generate a strong secret: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'base64\'))"');

            // SECURITY: Refuse to start in production with weak secret
            if (process.env.NODE_ENV === 'production') {
                throw new Error('PRODUCTION: Weak JWT secret detected. Application refused to start for security reasons.');
            }
        }

        // SECURITY: Check for sufficient entropy (basic check)
        const uniqueChars = new Set(this.secret).size;
        if (uniqueChars < 16) {
            console.warn('\x1b[33m%s\x1b[0m', '⚠️  WARNING: JWT secret has low entropy (few unique characters). Consider using a more random secret.');
        }
    }

    /**
     * Cria um JWT token com validação de algoritmo
     */
    sign(payload: any, expiresIn: number = 86400): string {
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Math.floor(Date.now() / 1000);

        // Sanitize payload to prevent injection
        const sanitizedPayload = this.sanitizePayload(payload);

        const tokenPayload = {
            ...sanitizedPayload,
            iat: now,
            exp: now + expiresIn,
            alg: 'HS256' // Prevent algorithm confusion attacks
        };

        const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
        const encodedPayload = this.base64UrlEncode(JSON.stringify(tokenPayload));

        const signature = this.createSignature(encodedHeader + '.' + encodedPayload);

        return `${encodedHeader}.${encodedPayload}.${signature}`;
    }

    /**
     * Verifica e decodifica um JWT token com validação rigorosa
     */
    verify(token: string): any | null {
        try {
            if (!token || typeof token !== 'string') return null;

            const parts = token.split('.');
            if (parts.length !== 3) return null;

            const [headerEncoded, payloadEncoded, signature] = parts;

            // Decode and validate header
            const header = JSON.parse(this.base64UrlDecode(headerEncoded));
            if (header.alg !== 'HS256' || header.typ !== 'JWT') {
                return null; // Prevent algorithm confusion attacks
            }

            // Verifica a assinatura usando constant-time comparison
            const expectedSignature = this.createSignature(headerEncoded + '.' + payloadEncoded);
            if (!this.constantTimeEqual(signature, expectedSignature)) return null;

            // Decodifica o payload
            const decodedPayload = JSON.parse(this.base64UrlDecode(payloadEncoded));

            // Validate algorithm in payload matches header
            if (decodedPayload.alg !== 'HS256') return null;

            // SECURITY: Verifica expiração com margem de erro de 5 segundos (clock skew)
            // Reduzido de 30s para minimizar janela de replay attacks
            const now = Math.floor(Date.now() / 1000);
            if (decodedPayload.exp && decodedPayload.exp < (now - 5)) {
                return null;
            }

            // SECURITY: Validate issued at time (not too far in future - 60s tolerance)
            if (decodedPayload.iat && decodedPayload.iat > (now + 60)) {
                return null;
            }

            return decodedPayload;
        } catch (error) {
            return null;
        }
    }

    private sanitizePayload(payload: any): any {
        if (typeof payload !== 'object' || payload === null) {
            return {};
        }

        const sanitized: any = {};
        for (const [key, value] of Object.entries(payload)) {
            // SECURITY: Skip dangerous properties that could lead to prototype pollution
            if (key.startsWith('__') || key === 'constructor' || key === 'prototype') {
                continue;
            }

            // SECURITY: Recursively sanitize nested objects to prevent deep prototype pollution
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                sanitized[key] = this.sanitizePayload(value);
            } else if (Array.isArray(value)) {
                // Sanitize arrays recursively
                sanitized[key] = value.map(item =>
                    (item && typeof item === 'object') ? this.sanitizePayload(item) : item
                );
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    private constantTimeEqual(a: string, b: string): boolean {
        if (a.length !== b.length) return false;

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    private base64UrlEncode(str: string): string {
        return Buffer.from(str)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    private base64UrlDecode(str: string): string {
        // SECURITY: Prevent DoS attacks with extremely large strings
        // JWT tokens are typically < 4KB, we allow up to 16KB to be safe
        if (str.length > 16384) {
            throw new Error('Token too large');
        }

        str += '='.repeat(4 - str.length % 4);
        return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    }

    private createSignature(data: string): string {
        return crypto
            .createHmac('sha256', this.secret)
            .update(data)
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }
}

export class SessionManager {
    private jwtManager: JWTManager;
    private maxAge: number;

    constructor(secret?: string, maxAge: number = 86400) {
        this.jwtManager = new JWTManager(secret);
        this.maxAge = maxAge;
    }

    /**
     * Cria uma nova sessão
     */
    createSession(user: User): { session: Session; token: string } {
        const expires = new Date(Date.now() + this.maxAge * 1000).toISOString();

        const session: Session = {
            user,
            expires
        };

        const token = this.jwtManager.sign({
            ...user
        }, this.maxAge);

        return { session, token };
    }

    /**
     * Verifica uma sessão a partir do token
     */
    verifySession(token: string): Session | null {
        try {
            const payload = this.jwtManager.verify(token);
            if (!payload) return null;

            const session: Session = {
                user: payload,
                expires: new Date(payload.exp * 1000).toISOString()
            };

            return session;
        } catch (error) {
            return null;
        }
    }

    /**
     * Atualiza uma sessão existente
     */
    updateSession(token: string): { session: Session; token: string } | null {
        const currentSession = this.verifySession(token);
        if (!currentSession) return null;

        return this.createSession(currentSession.user);
    }


    updateUserSession(user: User): { session: Session; token: string } | null {
        return this.createSession(user);
    }
}
