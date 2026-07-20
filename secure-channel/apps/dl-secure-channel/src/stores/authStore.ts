/* ──────────────────────────────────────────────────────────
 *  Auth Store — vault unlock, identity, session
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Bytes, KdfParams, IdentityKeyPair, Contact, TrustLevel } from '../types.js';
import { wipeSessions } from '../crypto/e2eeSessions.js';

export type AppScreen = 'login' | 'unlock' | 'onboarding' | 'main' | 'settings' | 'me' | 'verify' | 'admin' | 'shop';

interface AuthState {
  screen: AppScreen;
  isUnlocked: boolean;
  userId: string | null;
  displayName: string | null;
  systemRole: string | null;
  encryptionKey: Bytes | null;
  identityKeyPair: IdentityKeyPair | null;
  kdfParams: KdfParams | null;
  vaultExists: boolean;
  autoLockMs: number;
  sessionToken: string | null;

  setScreen: (screen: AppScreen) => void;
  unlock: (args: {
    userId: string;
    displayName: string;
    encryptionKey: Bytes;
    identityKeyPair: IdentityKeyPair;
    kdfParams: KdfParams;
    sessionToken: string;
    systemRole?: string | null;
  }) => void;
  lock: () => void;
  setVaultExists: (exists: boolean) => void;
  setAutoLock: (ms: number) => void;
}

export const useAuthStore = create<AuthState>()(persist((set, get) => ({
  screen: 'login',
  isUnlocked: false,
  userId: null,
  displayName: null,
  systemRole: null,
  encryptionKey: null,
  identityKeyPair: null,
  kdfParams: null,
  vaultExists: false,
  autoLockMs: 5 * 60 * 1000, // 5 minutes default
  sessionToken: null,

  setScreen: (screen) => set({ screen }),

  unlock: ({ userId, displayName, encryptionKey, identityKeyPair, kdfParams, sessionToken, systemRole }) =>
    set({
      isUnlocked: true,
      userId,
      displayName,
      encryptionKey,
      identityKeyPair,
      kdfParams,
      sessionToken,
      screen: 'main',
      // Preserve the persisted role when unlocking offline (vault unlock has no server data)
      ...(systemRole !== undefined ? { systemRole } : {}),
    }),

  lock: () => {
    const state = get();
    // Wipe sensitive data from memory using sodium.memzero when available
    if (state.encryptionKey) {
      try { state.encryptionKey.fill(0); } catch {}
    }
    if (state.identityKeyPair?.secretKey) {
      try { state.identityKeyPair.secretKey.fill(0); } catch {}
    }
    // Wipe all E2EE ratchet sessions
    wipeSessions();
    set({
      isUnlocked: false,
      encryptionKey: null,
      identityKeyPair: null,
      sessionToken: null,
      screen: 'unlock',
    });
  },

  setVaultExists: (exists) => set({ vaultExists: exists, screen: exists ? 'unlock' : 'login' }),
  setAutoLock: (ms) => set({ autoLockMs: ms }),
}), {
  name: 'dl-auth',
  // Only persist non-sensitive identity fields — NEVER key material or tokens
  partialize: (s) => ({
    userId:      s.userId,
    displayName: s.displayName,
    systemRole:  s.systemRole,
    vaultExists: s.vaultExists,
    autoLockMs:  s.autoLockMs,
  }),
}));

export function hasUsableSessionToken(token: string | null | undefined): token is string {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every(Boolean);
}

// Preserve store state across Vite HMR (clear sensitive fields)
if (import.meta.hot) {
  import.meta.hot.accept();
  const prev = (import.meta.hot.data as any)?.authState;
  if (prev) useAuthStore.setState(prev);
  import.meta.hot.dispose((data: any) => {
    const state = useAuthStore.getState();
    // Strip sensitive fields before HMR transfer
    data.authState = {
      ...state,
      encryptionKey: null,
      identityKeyPair: null,
      sessionToken: null,
    };
  });
}
