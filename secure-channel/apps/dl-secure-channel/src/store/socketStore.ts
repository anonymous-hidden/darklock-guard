/**
 * socketStore — WebSocket connection to the messaging gateway.
 *
 * Handles: real-time messages, typing indicators, read receipts,
 * security alerts, channel lockdown/secure status.
 *
 * Connect with: `useSocketStore.getState().connect()`
 * Subscribe to a channel: `useSocketStore.getState().subscribe(serverId, channelId)`
 */
import { create } from "zustand";
import * as api from "@/lib/tauri";
import type {
  ChannelMessageDto,
  GatewayMessage,
  SecurityAlertDto,
} from "@/types";

// ── Typing state ────────────────────────────────────────────────────────────

export interface TypingUser {
  userId: string;
  username: string;
  startedAt: number;
}

// ── Store interface ─────────────────────────────────────────────────────────

interface SocketState {
  connected: boolean;
  subscribedChannels: Set<string>;

  /** Messages keyed by channelId (append-only, newest at end) */
  messages: Record<string, ChannelMessageDto[]>;
  /** Users currently typing, keyed by channelId */
  typingUsers: Record<string, TypingUser[]>;
  /** Read receipts keyed by `channelId:userId` */
  readReceipts: Record<string, string>; // `chId:userId` → lastReadMessageId
  /** Security alerts for the current server */
  securityAlerts: SecurityAlertDto[];
  /** Channel lockdown status changes */
  lockdownChannels: Set<string>;
  /** Channel secure status changes */
  secureChannels: Set<string>;

  // ── Actions ─────────────────────────────────────────────────────

  /** Connect to the messaging gateway WebSocket */
  connect: () => Promise<void>;
  /** Disconnect from the gateway */
  disconnect: () => void;
  /** Subscribe to real-time updates for a channel */
  subscribe: (serverId: string, channelId: string) => void;
  /** Unsubscribe from a channel */
  unsubscribe: (channelId: string) => void;
  /** Send typing start indicator */
  sendTypingStart: (serverId: string, channelId: string) => void;
  /** Send typing stop indicator */
  sendTypingStop: (serverId: string, channelId: string) => void;
  /** Acknowledge reading up to a message */
  sendReadAck: (serverId: string, channelId: string, messageId: string) => void;
  /** Set initial messages for a channel (from REST fetch) */
  setMessages: (channelId: string, messages: ChannelMessageDto[]) => void;
  /** Append an optimistic message (from local send) */
  appendMessage: (channelId: string, message: ChannelMessageDto) => void;
  /** Replace a message (e.g., after optimistic update confirmation) */
  replaceMessage: (channelId: string, tempId: string, message: ChannelMessageDto) => void;
  /** Remove a message */
  removeMessage: (channelId: string, messageId: string) => void;
  /** Clear all messages for a channel */
  clearMessages: (channelId: string) => void;
  /** Get typing users for a channel (excluding self) */
  getTypingUsers: (channelId: string) => TypingUser[];
  /** Clear security alerts */
  clearAlerts: () => void;
  /** Reset store */
  reset: () => void;
}

// ── WebSocket singleton ─────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let heartbeatIv: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY = 1000;

function stopHeartbeat() {
  if (heartbeatIv) {
    clearInterval(heartbeatIv);
    heartbeatIv = null;
  }
}

function closeWs() {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
}

function clearReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

// ── Store implementation ────────────────────────────────────────────────────

export const useSocketStore = create<SocketState>((set, get) => ({
  connected: false,
  subscribedChannels: new Set(),
  messages: {},
  typingUsers: {},
  readReceipts: {},
  securityAlerts: [],
  lockdownChannels: new Set(),
  secureChannels: new Set(),

  connect: async () => {
    // Don't double-connect
    if (ws && ws.readyState === WebSocket.OPEN) return;
    closeWs();
    stopHeartbeat();
    clearReconnect();

    try {
      const token = await api.getRealtimeToken();
      const baseUrl = await api.getIdsBaseUrl().catch(() => "http://localhost:4100");
      const wsBase = String(baseUrl).replace(/^http/, "ws");
      ws = new WebSocket(`${wsBase}/gateway/ws?token=${encodeURIComponent(token)}`);

      ws.onopen = () => {
        set({ connected: true });
        reconnectAttempts = 0;
        console.log("[socketStore] Connected to messaging gateway");

        // Re-subscribe to previously subscribed channels
        const state = get();
        // Note: re-subscription happens at the component level on reconnect
        void state;

        // Start heartbeat every 25s
        stopHeartbeat();
        heartbeatIv = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "heartbeat" }));
          }
        }, 25000);
      };

      ws.onclose = () => {
        set({ connected: false });
        stopHeartbeat();
        console.log("[socketStore] Disconnected from messaging gateway");

        // Auto-reconnect with exponential backoff
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          console.log(`[socketStore] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          reconnectTimeout = setTimeout(() => get().connect(), delay);
        }
      };

      ws.onerror = () => {
        console.warn("[socketStore] WebSocket error");
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as GatewayMessage;
          handleGatewayMessage(msg, set, get);
        } catch {
          // Ignore malformed messages
        }
      };
    } catch (err) {
      console.warn("[socketStore] Failed to connect:", err);
      set({ connected: false });
    }
  },

  disconnect: () => {
    closeWs();
    stopHeartbeat();
    clearReconnect();
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
    set({ connected: false });
  },

  subscribe: (serverId, channelId) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", server_id: serverId, channel_id: channelId }));
    }
    set((s) => {
      const newSet = new Set(s.subscribedChannels);
      newSet.add(channelId);
      return { subscribedChannels: newSet };
    });
  },

  unsubscribe: (channelId) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", channel_id: channelId }));
    }
    set((s) => {
      const newSet = new Set(s.subscribedChannels);
      newSet.delete(channelId);
      return { subscribedChannels: newSet };
    });
  },

  sendTypingStart: (serverId, channelId) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing.start", server_id: serverId, channel_id: channelId }));
    }
  },

  sendTypingStop: (serverId, channelId) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing.stop", server_id: serverId, channel_id: channelId }));
    }
  },

  sendReadAck: (serverId, channelId, messageId) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "read.ack", server_id: serverId, channel_id: channelId, message_id: messageId }));
    }
  },

  setMessages: (channelId, messages) => {
    set((s) => ({
      messages: { ...s.messages, [channelId]: messages },
    }));
  },

  appendMessage: (channelId, message) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...(s.messages[channelId] || []), message],
      },
    }));
  },

  replaceMessage: (channelId, tempId, message) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] || []).map((m) =>
          m.id === tempId ? message : m
        ),
      },
    }));
  },

  removeMessage: (channelId, messageId) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] || []).filter((m) => m.id !== messageId),
      },
    }));
  },

  clearMessages: (channelId) => {
    set((s) => ({
      messages: { ...s.messages, [channelId]: [] },
    }));
  },

  getTypingUsers: (channelId) => {
    return get().typingUsers[channelId] || [];
  },

  clearAlerts: () => set({ securityAlerts: [] }),

  reset: () => {
    closeWs();
    stopHeartbeat();
    clearReconnect();
    set({
      connected: false,
      subscribedChannels: new Set(),
      messages: {},
      typingUsers: {},
      readReceipts: {},
      securityAlerts: [],
      lockdownChannels: new Set(),
      secureChannels: new Set(),
    });
  },
}));

// ── Gateway message handler ─────────────────────────────────────────────────

function handleGatewayMessage(
  msg: GatewayMessage,
  set: (fn: (s: SocketState) => Partial<SocketState>) => void,
  _get: () => SocketState
) {
  switch (msg.type) {
    case "connected":
      console.log("[socketStore] Gateway authenticated as", msg.user_id);
      break;

    case "subscribed":
      console.log("[socketStore] Subscribed to channel", msg.channel_id);
      break;

    case "message.created": {
      const channelId = msg.channel_id;
      const message = msg.message;
      if (!channelId || !message) break;

      set((s) => {
        const existing = s.messages[channelId] || [];
        // Deduplicate by id
        if (existing.some((m) => m.id === message.id)) return {};
        return {
          messages: {
            ...s.messages,
            [channelId]: [...existing, message],
          },
        };
      });
      break;
    }

    case "message.edited": {
      const channelId = msg.channel_id;
      const message = msg.message;
      if (!channelId || !message) break;

      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: (s.messages[channelId] || []).map((m) =>
            m.id === message.id ? message : m
          ),
        },
      }));
      break;
    }

    case "message.deleted": {
      const channelId = msg.channel_id;
      const messageId = msg.message_id;
      if (!channelId || !messageId) break;

      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: (s.messages[channelId] || []).filter(
            (m) => m.id !== messageId
          ),
        },
      }));
      break;
    }

    case "typing.update": {
      const channelId = msg.channel_id;
      if (!channelId || !msg.user_id) break;

      set((s) => {
        const current = [...(s.typingUsers[channelId] || [])];
        const idx = current.findIndex((t) => t.userId === msg.user_id);

        if (msg.active) {
          if (idx >= 0) {
            current[idx] = { ...current[idx], startedAt: Date.now() };
          } else {
            current.push({
              userId: msg.user_id!,
              username: msg.username || "Someone",
              startedAt: Date.now(),
            });
          }
        } else {
          if (idx >= 0) current.splice(idx, 1);
        }

        return {
          typingUsers: { ...s.typingUsers, [channelId]: current },
        };
      });
      break;
    }

    case "read.receipt": {
      const channelId = msg.channel_id;
      const userId = msg.user_id;
      const lastReadId = msg.last_read_message_id;
      if (!channelId || !userId || !lastReadId) break;

      set((s) => ({
        readReceipts: {
          ...s.readReceipts,
          [`${channelId}:${userId}`]: lastReadId,
        },
      }));
      break;
    }

    case "security.alert": {
      if (!msg.alert) break;
      set((s) => ({
        securityAlerts: [msg.alert!, ...s.securityAlerts].slice(0, 100),
      }));
      break;
    }

    case "channel.lockdown": {
      const channelId = msg.channel_id;
      if (!channelId) break;
      set((s) => {
        const newSet = new Set(s.lockdownChannels);
        if (msg.active) {
          newSet.add(channelId);
        } else {
          newSet.delete(channelId);
        }
        return { lockdownChannels: newSet };
      });
      break;
    }

    case "channel.secured": {
      const channelId = msg.channel_id;
      if (!channelId) break;
      set((s) => {
        const newSet = new Set(s.secureChannels);
        if (msg.is_secure) {
          newSet.add(channelId);
        } else {
          newSet.delete(channelId);
        }
        return { secureChannels: newSet };
      });
      break;
    }

    case "error":
      console.warn("[socketStore] Gateway error:", msg.code, msg.error);
      break;

    default:
      break;
  }
}
