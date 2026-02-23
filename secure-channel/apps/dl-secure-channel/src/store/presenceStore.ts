/**
 * presenceStore — real-time presence tracking for contacts and server members.
 * Sends heartbeats every 30s, fetches batch presence for visible users.
 */
import { create } from "zustand";
import type { PresenceDto, PresenceStatus } from "../types";
import * as api from "../lib/tauri";

interface PresenceState {
  /** userId → presence */
  presences: Record<string, PresenceDto>;
  /** Local user's chosen status override */
  localStatus: PresenceStatus;
  /** Local user's custom status text */
  localCustomStatus: string;

  // Actions
  setLocalStatus: (status: PresenceStatus, customStatus?: string) => void;
  heartbeat: () => Promise<void>;
  fetchPresence: (userId: string) => Promise<PresenceDto | null>;
  fetchBatchPresence: (userIds: string[]) => Promise<void>;
  getStatus: (userId: string) => PresenceStatus;
  reset: () => void;
}

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export const usePresenceStore = create<PresenceState>((set, get) => ({
  presences: {},
  localStatus: "online",
  localCustomStatus: "",

  setLocalStatus: async (status, customStatus) => {
    set({ localStatus: status, localCustomStatus: customStatus ?? "" });
    try {
      await api.setPresenceStatus(status, customStatus);
    } catch (e) {
      console.warn("[presenceStore] setPresenceStatus failed:", e);
    }
  },

  heartbeat: async () => {
    const { localStatus, localCustomStatus } = get();
    try {
      await api.presenceHeartbeat(localStatus, localCustomStatus || undefined);
    } catch {
      // silent — not critical
    }
  },

  fetchPresence: async (userId) => {
    try {
      const p = await api.getPresence(userId);
      set((s) => ({ presences: { ...s.presences, [userId]: p } }));
      return p;
    } catch {
      return null;
    }
  },

  fetchBatchPresence: async (userIds) => {
    if (userIds.length === 0) return;
    try {
      const presences = await api.getBatchPresence(userIds);
      const map: Record<string, PresenceDto> = {};
      for (const p of presences) map[p.user_id] = p;
      set((s) => ({ presences: { ...s.presences, ...map } }));
    } catch {
      // silent
    }
  },

  getStatus: (userId) => {
    const p = get().presences[userId];
    return (p?.status as PresenceStatus) ?? "offline";
  },

  reset: () => {
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval);
      _heartbeatInterval = null;
    }
    set({ presences: {}, localStatus: "online", localCustomStatus: "" });
  },
}));

/** Start the global heartbeat loop. Call once after login. */
export function startPresenceHeartbeat() {
  if (_heartbeatInterval) clearInterval(_heartbeatInterval);
  const store = usePresenceStore.getState();
  store.heartbeat(); // initial
  _heartbeatInterval = setInterval(() => {
    usePresenceStore.getState().heartbeat();
  }, 30_000);
}

/** Stop the global heartbeat loop. Call on logout. */
export function stopPresenceHeartbeat() {
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
}
