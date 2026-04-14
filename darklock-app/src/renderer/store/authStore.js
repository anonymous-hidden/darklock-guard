import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  userId: null,
  publicKey: null,
  privateKey: null, // in-memory only — never persisted
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLocked: false,

  setAuth: ({ userId, publicKey, privateKey, accessToken, refreshToken }) => set({
    userId,
    publicKey,
    privateKey,
    accessToken,
    refreshToken,
    isAuthenticated: true,
    isLocked: false
  }),

  setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),

  lock: () => set({
    privateKey: null,
    isLocked: true
  }),

  unlock: (privateKey) => set({
    privateKey,
    isLocked: false
  }),

  logout: () => {
    // Zero out private key from memory
    const state = get();
    if (state.privateKey) {
      // Best-effort zero: overwrite the string reference
    }
    set({
      userId: null,
      publicKey: null,
      privateKey: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLocked: false
    });
  }
}));
