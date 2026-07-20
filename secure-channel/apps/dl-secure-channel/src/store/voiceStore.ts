/**
 * Voice store — manages voice channel connection state.
 *
 * Tracks which voice channel the current user is connected to,
 * who else is in each voice channel, and local mute/deafen state.
 */
import { create } from "zustand";
import * as api from "@/lib/tauri";
import type { VoiceMemberDto } from "@/lib/tauri";

export { type VoiceMemberDto };

interface VoiceConnection {
  serverId: string;
  channelId: string;
}

interface VoiceState {
  /** Current user's voice connection (null = not in any voice channel) */
  connection: VoiceConnection | null;
  /** Local muted state */
  muted: boolean;
  /** Local deafened state */
  deafened: boolean;
  /** Members per channel: channelId → VoiceMemberDto[] */
  channelMembers: Record<string, VoiceMemberDto[]>;

  // Actions
  joinChannel: (serverId: string, channelId: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  fetchServerVoiceState: (serverId: string) => Promise<void>;
  fetchChannelMembers: (serverId: string, channelId: string) => Promise<void>;

  /** Handle SSE voice events to update state in real time */
  handleVoiceEvent: (
    event: string,
    data: { channel_id: string; user_id: string; members?: VoiceMemberDto[] }
  ) => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  connection: null,
  muted: false,
  deafened: false,
  channelMembers: {},

  joinChannel: async (serverId, channelId) => {
    try {
      const members = await api.joinVoiceChannel(serverId, channelId);
      set({
        connection: { serverId, channelId },
        muted: false,
        deafened: false,
        channelMembers: {
          ...get().channelMembers,
          [channelId]: members,
        },
      });
    } catch (err) {
      console.error("[voice] join failed:");
      throw err;
    }
  },

  leaveChannel: async () => {
    const conn = get().connection;
    if (!conn) return;
    try {
      await api.leaveVoiceChannel(conn.serverId, conn.channelId);
    } catch (err) {
      console.error("[voice] leave failed:");
    }
    // Always clear local state even if API fails
    set((s) => {
      const updated = { ...s.channelMembers };
      // Remove ourselves from the local member list
      if (updated[conn.channelId]) {
        updated[conn.channelId] = updated[conn.channelId].filter(
          (m) => m.user_id !== "self" // will be filtered by SSE event
        );
      }
      return { connection: null, muted: false, deafened: false, channelMembers: updated };
    });
  },

  toggleMute: async () => {
    const conn = get().connection;
    if (!conn) return;
    const newMuted = !get().muted;
    set({ muted: newMuted });
    try {
      await api.updateVoiceState(conn.serverId, conn.channelId, newMuted, undefined);
    } catch (err) {
      console.error("[voice] toggle mute failed:");
      set({ muted: !newMuted }); // revert
    }
  },

  toggleDeafen: async () => {
    const conn = get().connection;
    if (!conn) return;
    const newDeafened = !get().deafened;
    // Deafening also mutes
    const newMuted = newDeafened ? true : get().muted;
    set({ deafened: newDeafened, muted: newMuted });
    try {
      await api.updateVoiceState(conn.serverId, conn.channelId, newMuted, newDeafened);
    } catch (err) {
      console.error("[voice] toggle deafen failed:");
      set({ deafened: !newDeafened, muted: !newMuted }); // revert
    }
  },

  fetchServerVoiceState: async (serverId) => {
    try {
      const result = await api.getServerVoiceState(serverId);
      if (result?.channels) {
        set((s) => ({
          channelMembers: { ...s.channelMembers, ...result.channels },
        }));
      }
    } catch (err) {
      console.error("[voice] fetch server state failed:");
    }
  },

  fetchChannelMembers: async (serverId, channelId) => {
    try {
      const members = await api.getVoiceMembers(serverId, channelId);
      set((s) => ({
        channelMembers: { ...s.channelMembers, [channelId]: members },
      }));
    } catch (err) {
      console.error("[voice] fetch members failed:");
    }
  },

  handleVoiceEvent: (event, data) => {
    if (!data.channel_id) return;

    if (data.members) {
      // Server sent updated member list — use it directly
      set((s) => ({
        channelMembers: {
          ...s.channelMembers,
          [data.channel_id]: data.members!,
        },
      }));
    }

    // If we were disconnected from a channel externally
    if (event === "voice.leave") {
      const conn = get().connection;
      if (conn && conn.channelId === data.channel_id) {
        // Leave event from our own action already clears connection in leaveChannel()
        // External kicks could check against user_id here in future
      }
    }
  },
}));
