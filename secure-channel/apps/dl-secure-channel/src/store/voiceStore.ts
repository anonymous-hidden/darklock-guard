import { create } from "zustand";
import * as api from "@/lib/tauri";
import type { VoiceMemberDto } from "@/lib/tauri";

export { type VoiceMemberDto };

interface VoiceConnection {
  serverId: string;
  channelId: string;
  localFingerprint: string;
}

export interface VoiceSignalEvent {
  from_user_id: string;
  signal_type: "offer" | "answer" | "ice" | string;
  payload: unknown;
  server_id: string;
  channel_id: string;
}

interface VoiceState {
  connection: VoiceConnection | null;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  wsConnected: boolean;
  channelMembers: Record<string, VoiceMemberDto[]>;
  incomingSignals: VoiceSignalEvent[];
  fingerprintWarnings: Record<string, string>;

  joinChannel: (serverId: string, channelId: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  fetchServerVoiceState: (serverId: string) => Promise<void>;
  fetchChannelMembers: (serverId: string, channelId: string) => Promise<void>;
  requestToSpeak: () => Promise<void>;
  promoteSpeaker: (targetUserId: string) => Promise<void>;
  demoteSpeaker: (targetUserId: string) => Promise<void>;
  sendSignal: (targetUserId: string, signalType: string, payload: unknown) => void;
  consumeSignals: () => VoiceSignalEvent[];
  handleVoiceEvent: (event: string, data: { channel_id: string; user_id: string; members?: VoiceMemberDto[] }) => void;
}

let ws: WebSocket | null = null;
let heartbeatIv: ReturnType<typeof setInterval> | null = null;
const seenFingerprints = new Map<string, string>();

function stopHeartbeat() {
  if (heartbeatIv) {
    clearInterval(heartbeatIv);
    heartbeatIv = null;
  }
}

function closeWs() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

function evaluateFingerprints(
  channelMembers: Record<string, VoiceMemberDto[]>,
): Record<string, string> {
  const warnings: Record<string, string> = {};
  for (const members of Object.values(channelMembers)) {
    for (const m of members) {
      if (!m.fingerprint) continue;
      const key = `${m.user_id}`;
      const prev = seenFingerprints.get(key);
      if (prev && prev !== m.fingerprint) {
        warnings[m.user_id] = "Peer fingerprint changed during active session. Possible MITM.";
      } else if (!prev) {
        seenFingerprints.set(key, m.fingerprint);
      }
    }
  }
  return warnings;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  connection: null,
  muted: false,
  deafened: false,
  cameraOn: false,
  wsConnected: false,
  channelMembers: {},
  incomingSignals: [],
  fingerprintWarnings: {},

  joinChannel: async (serverId, channelId) => {
    const localFingerprint = crypto.randomUUID().replace(/-/g, "");
    const members = await api.joinVoiceChannel(serverId, channelId, localFingerprint);
    set((s) => ({
      connection: { serverId, channelId, localFingerprint },
      muted: false,
      deafened: false,
      cameraOn: false,
      channelMembers: { ...s.channelMembers, [channelId]: members },
      fingerprintWarnings: evaluateFingerprints({ ...s.channelMembers, [channelId]: members }),
    }));

    try {
      const token = await api.getRealtimeToken();
      const baseUrl = await api.getIdsBaseUrl().catch(() => "http://localhost:4100");
      const wsBase = String(baseUrl).replace(/^http/, "ws");
      ws = new WebSocket(`${wsBase}/voice/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => set({ wsConnected: true });
      ws.onclose = () => set({ wsConnected: false });
      ws.onerror = () => set({ wsConnected: false });
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg?.type === "voice.signal") {
            set((s) => ({ incomingSignals: [...s.incomingSignals, msg] }));
          }
        } catch {}
      };
    } catch (err) {
      console.warn("[voice] failed to connect signaling ws", err);
    }

    stopHeartbeat();
    heartbeatIv = setInterval(() => {
      const conn = get().connection;
      if (!conn) return;
      api.voiceHeartbeat(conn.serverId, conn.channelId).catch(() => {});
    }, 15000);
  },

  leaveChannel: async () => {
    const conn = get().connection;
    if (conn) {
      await api.leaveVoiceChannel(conn.serverId, conn.channelId).catch(() => {});
    }
    stopHeartbeat();
    closeWs();
    set({ connection: null, muted: false, deafened: false, cameraOn: false, wsConnected: false, incomingSignals: [] });
  },

  toggleMute: async () => {
    const conn = get().connection;
    if (!conn) return;
    const next = !get().muted;
    set({ muted: next });
    await api.updateVoiceState(conn.serverId, conn.channelId, next, undefined, undefined, conn.localFingerprint)
      .catch(() => set({ muted: !next }));
  },

  toggleDeafen: async () => {
    const conn = get().connection;
    if (!conn) return;
    const next = !get().deafened;
    const nextMuted = next ? true : get().muted;
    set({ deafened: next, muted: nextMuted });
    await api.updateVoiceState(conn.serverId, conn.channelId, nextMuted, next, undefined, conn.localFingerprint)
      .catch(() => set({ deafened: !next, muted: !nextMuted }));
  },

  toggleCamera: async () => {
    const conn = get().connection;
    if (!conn) return;
    const next = !get().cameraOn;
    set({ cameraOn: next });
    await api.updateVoiceState(conn.serverId, conn.channelId, undefined, undefined, next, conn.localFingerprint)
      .catch(() => set({ cameraOn: !next }));
  },

  fetchServerVoiceState: async (serverId) => {
    const result = await api.getServerVoiceState(serverId).catch(() => null);
    if (!result?.channels) return;
    set((s) => {
      const merged = { ...s.channelMembers, ...result.channels };
      return {
        channelMembers: merged,
        fingerprintWarnings: evaluateFingerprints(merged),
      };
    });
  },

  fetchChannelMembers: async (serverId, channelId) => {
    const members = await api.getVoiceMembers(serverId, channelId).catch(() => []);
    set((s) => {
      const merged = { ...s.channelMembers, [channelId]: members };
      return {
        channelMembers: merged,
        fingerprintWarnings: evaluateFingerprints(merged),
      };
    });
  },

  requestToSpeak: async () => {
    const conn = get().connection;
    if (!conn) return;
    await api.stageRequestSpeak(conn.serverId, conn.channelId);
    await get().fetchChannelMembers(conn.serverId, conn.channelId);
  },

  promoteSpeaker: async (targetUserId) => {
    const conn = get().connection;
    if (!conn) return;
    await api.stagePromote(conn.serverId, conn.channelId, targetUserId);
    await get().fetchChannelMembers(conn.serverId, conn.channelId);
  },

  demoteSpeaker: async (targetUserId) => {
    const conn = get().connection;
    if (!conn) return;
    await api.stageDemote(conn.serverId, conn.channelId, targetUserId);
    await get().fetchChannelMembers(conn.serverId, conn.channelId);
  },

  sendSignal: (targetUserId, signalType, payload) => {
    const conn = get().connection;
    if (!conn || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (get().fingerprintWarnings[targetUserId]) return;
    ws.send(JSON.stringify({
      type: "voice.signal",
      server_id: conn.serverId,
      channel_id: conn.channelId,
      target_user_id: targetUserId,
      signal_type: signalType,
      payload,
    }));
  },

  consumeSignals: () => {
    const signals = get().incomingSignals;
    set({ incomingSignals: [] });
    return signals;
  },

  handleVoiceEvent: (_event, data) => {
    if (!data.channel_id || !data.members) return;
    set((s) => {
      const merged = { ...s.channelMembers, [data.channel_id]: data.members! };
      return {
        channelMembers: merged,
        fingerprintWarnings: evaluateFingerprints(merged),
      };
    });
  },
}));
