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

type RouteListener = () => void;

export class Router {
    private listeners: Set<RouteListener> = new Set();

    constructor() {
        // Só adiciona listener no lado do cliente
        if (typeof window !== 'undefined') {
            window.addEventListener('popstate', () => {
                this.notify();
            });
        }
    }

    get pathname() {
        if (typeof window === 'undefined') {
            return '/'; // Retorno seguro para SSR
        }
        return window.location.pathname;
    }

    get search() {
        if (typeof window === 'undefined') {
            return '';
        }
        return window.location.search;
    }

    get hash() {
        if (typeof window === 'undefined') {
            return '';
        }
        return window.location.hash;
    }

    push(path: string) {
        if (typeof window !== 'undefined') {
            window.history.pushState({}, '', path);
            this.notify();
        }
    }



    replace(path: string) {
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', path);
            this.notify();
        }
    }

    back() {
        if (typeof window !== 'undefined') {
            window.history.back();
        }
    }

    subscribe(listener: RouteListener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        this.listeners.forEach(listener => listener());
    }
}

export const router = new Router();