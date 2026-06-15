/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 */

export * from './session';
export * from './guards';

export { useSession, useAuth } from './session';
export { useAuthRedirect } from './guards';

// Importação e re-exportação dos componentes .svelte
import SessionProvider from "./SessionProvider.svelte";
import AuthGuard from "./AuthGuard.svelte";
import GuestOnly from "./GuestOnly.svelte";

export { SessionProvider, AuthGuard, GuestOnly };