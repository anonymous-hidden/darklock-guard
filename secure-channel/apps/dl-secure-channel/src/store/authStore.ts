import { create } from "zustand";
import type { AuthResult } from "../types";

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
    console.log("[authStore] setAuth → userId=", result.user_id, "username=", result.username, "keyChange=", result.key_change_detected, "role=", result.system_role);
    set({
      isAuthenticated: true,
      userId: result.user_id,
      username: result.username,
      keyChangeDetected: result.key_change_detected,
      systemRole: result.system_role ?? null,
    });
  },

  setSecurityCheckComplete: (done) => {
    console.log("[authStore] setSecurityCheckComplete", done);
    set({ securityCheckComplete: done });
  },

  clearAuth: () => {
    console.log("[authStore] clearAuth called");
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
