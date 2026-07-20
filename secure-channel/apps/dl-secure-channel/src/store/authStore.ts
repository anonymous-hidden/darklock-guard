import { create } from 'zustand';
import type { AuthResult } from '../types';

interface AuthState {
  isAuthenticated: boolean;
  securityCheckComplete: boolean;
  userId: string | null;
  username: string | null;
  keyChangeDetected: boolean;
  systemRole: string | null;

  setAuth: (result: AuthResult) => void;
  setSecurityCheckComplete: (done: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  securityCheckComplete: false,
  userId: null,
  username: null,
  keyChangeDetected: false,
  systemRole: null,

  setAuth: (result) => {
    console.log('[AUTH_STORE_SESSION_SET]');
    set({
      isAuthenticated: true,
      userId: result.user_id,
      username: result.username,
      keyChangeDetected: result.key_change_detected,
      systemRole: result.system_role ?? null,
    });
  },

  setSecurityCheckComplete: (done) => {
    console.log('[AUTH_STORE_SECURITY_CHECK_UPDATED]');
    set({ securityCheckComplete: done });
  },

  clearAuth: () => {
    console.log('[AUTH_STORE_CLEARED]');
    set({
      isAuthenticated: false,
      securityCheckComplete: false,
      userId: null,
      username: null,
      keyChangeDetected: false,
      systemRole: null,
    });
  },
}));
