/* ──────────────────────────────────────────────────────────
 *  Connection Store — WebSocket and server connectivity
 *
 *  Default URLs resolve at build time from env vars
 *  (VITE_IDS_URL / VITE_RLY_URL) or fall back to the
 *  Pi5 LAN address, then localhost.
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// HIGH-6: Default to HTTPS/WSS for TLS — fall back to insecure only in dev
const DEFAULT_IDS = import.meta.env.VITE_IDS_URL ?? 'http://localhost:4100';
const DEFAULT_RLY = import.meta.env.VITE_RLY_URL ?? 'http://localhost:4101';

interface ConnectionState {
  status: ConnectionStatus;
  idsUrl: string;
  rlyUrl: string;
  wsUrl: string;
  latencyMs: number | null;
  lastPong: number | null;

  setStatus: (status: ConnectionStatus) => void;
  setUrls: (ids: string, rly: string) => void;
  setLatency: (ms: number) => void;
}

// DARK-018: Proper WS URL derivation
function deriveWsUrl(rly: string): string {
  try {
    const u = new URL(rly);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    return u.toString();
  } catch {
    return rly.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws';
  }
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  idsUrl: DEFAULT_IDS,
  rlyUrl: DEFAULT_RLY,
  wsUrl: deriveWsUrl(DEFAULT_RLY),
  latencyMs: null,
  lastPong: null,

  setStatus: (status) => set({ status }),
  // DARK-018: Use URL parsing for correct protocol conversion instead of string replace
  setUrls: (ids, rly) => {
    let wsUrl: string;
    try {
      const u = new URL(rly);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = '/ws';
      wsUrl = u.toString();
    } catch {
      wsUrl = rly.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws';
    }
    set({ idsUrl: ids, rlyUrl: rly, wsUrl });
  },
  setLatency: (ms) => set({ latencyMs: ms, lastPong: Date.now() }),
}));
