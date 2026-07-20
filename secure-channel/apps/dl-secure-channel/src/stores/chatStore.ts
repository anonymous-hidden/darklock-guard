/* ──────────────────────────────────────────────────────────
 *  Chat Store — conversations, messages, contacts
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Contact, Conversation, Message, Attachment, GroupInfo, GroupChannel, GroupCategory, GroupRoleInfo, AuditLogEntry, AuditAction, TrustLevel } from '../types.js';
import { DEFAULT_PERMISSIONS } from '../types.js';
import { useAuthStore } from './authStore';
import { useConvSecurityStore } from './convSecurityStore';
import { useSettingsStore } from './settingsStore';
import { showNotification } from '../hooks/useSettingsEffects';
import { createLogger } from '../utils/logger';
import {
  belongsToGroupConversation,
  makeGroupChannelConversationId,
  parseGroupChannelConversationId,
} from '../utils/groupChannelKeys';
import { DEFAULT_GROUP_MODERATION, normalizeModerationSettings } from '../utils/groupModeration';

const log = createLogger('dl-chat');

const DISAPPEAR_MS: Record<string, number> = {
  '30s':  30_000,
  '1m':   60_000,
  '5m':   300_000,
  '1h':   3_600_000,
  '24h':  86_400_000,
  '7d':   604_800_000,
};

/* ── Remote Profile (received from relay) ───────────────── */

export interface RemoteProfile {
  displayName: string;
  username: string;
  avatar: string | null;
  banner: string | null;
  bannerFit?: 'cover' | 'contain';
  bio: string;
  pronouns: string;
  usernameColor: string;
  accentColor: string;
  accentColor2: string;
  gradientAngle: number;
  nameplate: string | null;
  sectionOrder: string[];
  presence: 'online' | 'idle' | 'dnd' | 'invisible';
  statusText: string;
  statusEmoji: string;
  tags: string[];
  selectedTags: string[];
  links: { id: string; label: string; url: string }[];
}

/* ── Extended UI types (add fields the UI needs) ────────── */

export interface UIContact extends Contact {
  online?: boolean;
  keyChangePending?: boolean;
  pinnedIdentityKey?: string;
  observedIdentityKey?: string;
  safetyNumber?: string;
  keyChangedAt?: number;
}

export interface UIConversation extends Conversation {
  /** Alias for unreadCount, used by Sidebar */
  unread: number;
  /** Preview text for sidebar */
  lastMessage?: string;
  /** Sorting timestamp — mirrors lastMessageAt ?? createdAt */
  lastActivity: number;
  /** Alias for members — kept for Sidebar compat */
  participantIds: string[];
}

function toUIConversation(c: Conversation): UIConversation {
  return {
    ...c,
    unread: c.unreadCount,
    lastMessage: undefined,
    lastActivity: c.lastMessageAt ?? c.createdAt,
    participantIds: c.members,
  };
}

/* ── Store interface ─────────────────────────────────────── */

interface ChatState {
  contacts: Record<string, UIContact>;
  conversations: Record<string, UIConversation>;
  messages: Record<string, Message[]>; // conversationId → messages
  activeConversation: string | null;
  groups: Record<string, GroupInfo>;
  sidebarMode: 'dm' | 'group';
  activeGroupId: string | null;
  activeChannelId: string | null;
  searchQuery: string;

  // Contacts
  addContact: (contact: UIContact) => void;
  removeContact: (id: string) => void;
  updateContactTrust: (id: string, level: TrustLevel) => void;
  setContactOnline: (id: string, online: boolean) => void;
  setContactSecurityState: (id: string, patch: Partial<UIContact>) => void;

  // Conversations
  addConversation: (convo: Conversation) => void;
  removeConversation: (conversationId: string) => void;
  setActiveConversation: (id: string | null) => void;
  markRead: (conversationId: string) => void;
  setDisappearingTimer: (conversationId: string, timer: number) => void;
  toggleMute: (conversationId: string) => void;

  // Messages
  sendMessage: (conversationId: string, content: string, replyTo?: string, attachments?: Attachment[], id?: string) => string;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessageStatus: (conversationId: string, messageId: string, status: Message['status']) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  expireMessage: (conversationId: string, messageId: string) => void;
  pruneExpiredMessages: () => void;
  addReaction: (conversationId: string, messageId: string, emoji: string) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;

  // Groups
  createGroup: (name: string, memberIds: string[]) => string;
  setGroupInfo: (groupId: string, info: GroupInfo) => void;
  deleteGroup: (groupId: string) => void;
  toggleCategory: (groupId: string, categoryId: string) => void;

  // Group CRUD — channels, categories, roles, members
  addChannel: (groupId: string, channel: GroupChannel) => void;
  updateChannel: (groupId: string, channelId: string, patch: Partial<GroupChannel>) => void;
  deleteChannel: (groupId: string, channelId: string) => void;
  addCategory: (groupId: string, category: GroupCategory) => void;
  deleteCategory: (groupId: string, categoryId: string) => void;
  addRole: (groupId: string, role: GroupRoleInfo) => void;
  updateRole: (groupId: string, roleId: string, patch: Partial<GroupRoleInfo>) => void;
  deleteRole: (groupId: string, roleId: string) => void;
  updateMember: (groupId: string, userId: string, patch: { role?: 'admin' | 'member'; roleIds?: string[]; nickname?: string; banned?: boolean }) => void;
  kickMember: (groupId: string, userId: string) => void;
  appendAuditLog: (groupId: string, entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
  updateGroupOverview: (groupId: string, patch: { name?: string; description?: string; avatar?: string | null }) => void;

  // Sidebar mode
  setSidebarMode: (mode: 'dm' | 'group', groupId?: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;

  // Nicknames (per-contact, only visible to the setter)
  nicknames: Record<string, string>;
  setNickname: (userId: string, nickname: string) => void;
  clearNickname: (userId: string) => void;

  // Search
  setSearchQuery: (query: string) => void;

  // Remote profiles (from relay)
  remoteProfiles: Record<string, RemoteProfile>;
  setRemoteProfile: (userId: string, profile: RemoteProfile) => void;

  // Typing indicators: { [convId]: { [userId]: lastTimestamp } }
  typingUsers: Record<string, Record<string, number>>;
  setTypingUsers: (convId: string, users: Record<string, number>) => void;

  // Encrypted attachment data (base64) — persisted so blob URLs can be recreated after restart
  attachmentData: Record<string, string>;
  storeAttachmentData: (id: string, base64: string) => void;
}

function resolveConversationRootId(
  conversations: Record<string, UIConversation>,
  conversationId: string,
): string {
  if (conversations[conversationId]) return conversationId;

  const parsed = parseGroupChannelConversationId(conversationId);
  if (parsed.channelId && conversations[parsed.groupId]) {
    return parsed.groupId;
  }

  return conversationId;
}

function getActiveMessageContextId(state: Pick<
  ChatState,
  'activeConversation' | 'activeGroupId' | 'activeChannelId' | 'conversations' | 'groups'
>): string | null {
  if (!state.activeConversation) return null;

  const activeConversation = state.conversations[state.activeConversation];
  if (!activeConversation || activeConversation.type !== 'group') {
    return state.activeConversation;
  }

  const groupId = activeConversation.id;
  const group = state.groups[groupId];
  const selectedChannelId = state.activeGroupId === groupId
    ? (state.activeChannelId ?? group?.channels?.[0]?.id ?? null)
    : (group?.channels?.[0]?.id ?? null);

  return makeGroupChannelConversationId(groupId, selectedChannelId);
}

function removeGroupConversationMessages(
  messages: Record<string, Message[]>,
  groupId: string,
): Record<string, Message[]> {
  return Object.fromEntries(
    Object.entries(messages).filter(([conversationId]) => !belongsToGroupConversation(conversationId, groupId)),
  );
}

export const useChatStore = create<ChatState>()(persist((set, get) => ({
  contacts: {},
  conversations: {},
  messages: {},
  activeConversation: null,
  groups: {},
  sidebarMode: 'dm' as const,
  activeGroupId: null,
  activeChannelId: null,
  nicknames: {},
  searchQuery: '',
  remoteProfiles: {},
  typingUsers: {},
  attachmentData: {},

  // ── Contacts ─────────────────────
  addContact: (contact) =>
    set((s) => ({ contacts: { ...s.contacts, [contact.id]: contact } })),
  removeContact: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.contacts;
      return { contacts: rest };
    }),
  updateContactTrust: (id, level) =>
    set((s) => {
      const c = s.contacts[id];
      if (!c) return s;
      return { contacts: { ...s.contacts, [id]: { ...c, trustLevel: level } } };
    }),
  setContactOnline: (id, online) =>
    set((s) => {
      const c = s.contacts[id];
      if (!c) return s;
      return { contacts: { ...s.contacts, [id]: { ...c, online, lastSeen: online ? undefined : Date.now() } } };
    }),
  setContactSecurityState: (id, patch) =>
    set((s) => {
      const existing = s.contacts[id];
      const base: UIContact = existing ?? {
        id,
        displayName: id,
        identityKey: '',
        trustLevel: 'unverified',
        addedAt: Date.now(),
      };
      const next: UIContact = {
        ...base,
        ...patch,
      };
      if (patch.observedIdentityKey) {
        next.identityKey = patch.observedIdentityKey;
      }
      return { contacts: { ...s.contacts, [id]: next } };
    }),

  // ── Conversations ────────────────
  addConversation: (convo) =>
    set((s) => ({
      conversations: { ...s.conversations, [convo.id]: toUIConversation(convo) },
    })),
  removeConversation: (conversationId) =>
    set((s) => {
      const { [conversationId]: _c, ...conversations } = s.conversations;
      const messages = removeGroupConversationMessages(s.messages, conversationId);
      return {
        conversations,
        messages,
        activeConversation: s.activeConversation === conversationId ? null : s.activeConversation,
      };
    }),
  setActiveConversation: (id) => {
    set({ activeConversation: id });
    if (id) {
      const c = get().conversations[id];
      if (c && (c.unreadCount > 0 || c.unread > 0)) {
        set((s) => {
          const conv = s.conversations[id];
          if (!conv) return s;
          return { conversations: { ...s.conversations, [id]: { ...conv, unreadCount: 0, unread: 0 } } };
        });
      }
    }
  },
  markRead: (conversationId) =>
    set((s) => {
      const c = s.conversations[conversationId];
      if (!c) return s;
      return { conversations: { ...s.conversations, [conversationId]: { ...c, unreadCount: 0, unread: 0 } } };
    }),
  setDisappearingTimer: (conversationId, timer) =>
    set((s) => {
      const c = s.conversations[conversationId];
      if (!c) return s;
      return { conversations: { ...s.conversations, [conversationId]: { ...c, disappearingTimer: timer } } };
    }),
  toggleMute: (conversationId) =>
    set((s) => {
      const c = s.conversations[conversationId];
      if (!c) return s;
      return { conversations: { ...s.conversations, [conversationId]: { ...c, muted: !c.muted } } };
    }),

  // ── Messages ─────────────────────
  sendMessage: (conversationId, content, replyTo, attachments, id) => {
    const state = get();
    const rootConversationId = resolveConversationRootId(state.conversations, conversationId);
    const currentUserId: string = useAuthStore.getState().userId ?? '';
    const sec = useConvSecurityStore.getState().get(conversationId);
    const disappearMs = sec.disappearTimer !== 'off' ? (DISAPPEAR_MS[sec.disappearTimer] ?? 0) : 0;
    const retentionDays = useSettingsStore.getState().messageRetentionDays;
    // Conversation-specific disappearing messages take precedence. Otherwise,
    // retention is applied locally when the message enters this device's store.
    const retentionMs = retentionDays > 0 ? retentionDays * 86_400_000 : 0;
    const expiryMs = disappearMs || retentionMs;
    const msgId = id ?? crypto.randomUUID();
    const msg: Message = {
      id: msgId,
      conversationId,
      senderId: currentUserId,
      content,
      timestamp: Date.now(),
      replyTo,
      status: 'sent',
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(expiryMs > 0 ? { disappearAt: Date.now() + expiryMs } : {}),
    };

    // Update messages list
    const existing = state.messages[conversationId] ?? [];
    const conv = state.conversations[rootConversationId];
    set({
      messages: {
        ...state.messages,
        [conversationId]: [...existing, msg],
      },
      ...(conv ? {
        conversations: {
          ...state.conversations,
          [rootConversationId]: { ...conv, lastMessage: content || (attachments && attachments.length > 0 ? '📎 Attachment' : ''), lastActivity: msg.timestamp, lastMessageAt: msg.timestamp },
        },
      } : {}),
    });
    return msgId;
  },
  addMessage: (conversationId, message) =>
    set((s) => {
      const rootConversationId = resolveConversationRootId(s.conversations, conversationId);
      const activeMessageContextId = getActiveMessageContextId(s);
      const existing = s.messages[conversationId] ?? [];
      if (existing.some(m => m.id === message.id)) return s;
      const conv = s.conversations[rootConversationId];
      const retentionDays = useSettingsStore.getState().messageRetentionDays;
      const localRetentionAt = retentionDays > 0
        ? message.timestamp + retentionDays * 86_400_000
        : undefined;
      const storedMessage = message.disappearAt || !localRetentionAt
        ? message
        : { ...message, disappearAt: localRetentionAt };
      // Fire notification for messages from others when conversation isn't active
      if (activeMessageContextId !== conversationId && message.senderId !== useAuthStore.getState().userId && !conv?.muted) {
        const title = conv?.name ?? 'Secure Channel';
        showNotification(title, message.content, conversationId);
      }
      return {
        messages: {
          ...s.messages,
          [conversationId]: [...existing, storedMessage].sort((a, b) => a.timestamp - b.timestamp),
        },
        ...(conv ? {
          conversations: {
            ...s.conversations,
            [rootConversationId]: {
              ...conv,
              lastMessage: message.content.slice(0, 80),
              lastActivity: message.timestamp,
              lastMessageAt: message.timestamp,
              unread: activeMessageContextId === conversationId ? conv.unread : conv.unread + 1,
              unreadCount: activeMessageContextId === conversationId ? conv.unreadCount : conv.unreadCount + 1,
            },
          },
        } : {}),
      };
    }),
  updateMessageStatus: (conversationId, messageId, status) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).map(m =>
          m.id === messageId ? { ...m, status } : m,
        ),
      },
    })),
  editMessage: (conversationId, messageId, newContent) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).map(m =>
          m.id === messageId ? { ...m, content: newContent, editedAt: Date.now() } : m,
        ),
      },
    })),
  deleteMessage: (conversationId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).filter(m => m.id !== messageId),
      },
    })),
  expireMessage: (conversationId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).filter(m => m.id !== messageId),
      },
    })),
  pruneExpiredMessages: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const messages = Object.fromEntries(Object.entries(s.messages).map(([conversationId, entries]) => {
        const remaining = entries.filter(message => !message.disappearAt || message.disappearAt > now);
        if (remaining.length !== entries.length) changed = true;
        return [conversationId, remaining];
      }));
      return changed ? { messages } : s;
    }),
  addReaction: (conversationId, messageId, emoji) =>
    set((s) => {
      const userId = useAuthStore.getState().userId ?? '';
      if (!userId) return s;
      return ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).map(m => {
          if (m.id !== messageId) return m;
          const reactions = { ...(m.reactions ?? {}) };
          if (!reactions[emoji]) reactions[emoji] = [];
          if (reactions[emoji].includes(userId)) {
            reactions[emoji] = reactions[emoji].filter(id => id !== userId);
            if (reactions[emoji].length === 0) delete reactions[emoji];
          } else {
            reactions[emoji] = [...reactions[emoji], userId];
          }
          return { ...m, reactions };
        }),
      },
      });
    }),
  setMessages: (conversationId, messages) =>
    set((s) => ({
      messages: { ...s.messages, [conversationId]: messages },
    })),

  // ── Groups ───────────────────────
  createGroup: (name, memberIds) => {
    const currentUserId = useAuthStore.getState().userId ?? '';
    const id = crypto.randomUUID();
    const now = Date.now();
    const allMembers = [currentUserId, ...memberIds.filter(mid => mid !== currentUserId)];
    const defaultCatId = crypto.randomUUID();
    const defaultChannelId = crypto.randomUUID();
    const defaultRoleId = crypto.randomUUID();
    const info: GroupInfo = {
      id,
      name,
      members: allMembers.map((uid, i) => ({ userId: uid, role: i === 0 ? 'admin' as const : 'member' as const, roleIds: [defaultRoleId], joinedAt: now })),
      channels: [
        { id: defaultChannelId, name: 'general', type: 'text', categoryId: defaultCatId, position: 0 },
      ],
      categories: [
        { id: defaultCatId, name: 'Text Channels', position: 0 },
      ],
      roles: [
        { id: defaultRoleId, name: '@everyone', color: '#99aab5', position: 0, permissions: { ...DEFAULT_PERMISSIONS }, isDefault: true },
      ],
      auditLog: [
        { id: crypto.randomUUID(), action: 'server_update', userId: currentUserId, detail: 'Server created', timestamp: now },
      ],
      createdAt: now,
      createdBy: currentUserId,
      moderation: {
        ...DEFAULT_GROUP_MODERATION,
        updatedAt: now,
        updatedBy: currentUserId,
      },
    };
    const conv: Conversation = {
      id,
      type: 'group',
      name,
      members: allMembers,
      createdAt: now,
      unreadCount: 0,
    };
    set((s) => ({
      groups: { ...s.groups, [id]: info },
      conversations: { ...s.conversations, [id]: toUIConversation(conv) },
      activeConversation: id,
      sidebarMode: 'group' as const,
      activeGroupId: id,
      activeChannelId: defaultChannelId,
    }));
    return id;
  },
  setGroupInfo: (groupId, info) =>
    set((s) => ({
      groups: {
        ...s.groups,
        [groupId]: {
          ...info,
          moderation: normalizeModerationSettings(info.moderation),
        },
      },
    })),
  deleteGroup: (groupId) =>
    set((s) => {
      const { [groupId]: _g, ...groups } = s.groups;
      const { [groupId]: _c, ...conversations } = s.conversations;
      const messages = removeGroupConversationMessages(s.messages, groupId);
      const wasActive = s.activeGroupId === groupId;
      const clearActiveConversation = s.activeConversation ? belongsToGroupConversation(s.activeConversation, groupId) : false;
      return {
        groups,
        conversations,
        messages,
        activeConversation: clearActiveConversation ? null : s.activeConversation,
        ...(wasActive ? { sidebarMode: 'dm' as const, activeGroupId: null, activeChannelId: null } : {}),
      };
    }),
  toggleCategory: (groupId, categoryId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return {
        groups: {
          ...s.groups,
          [groupId]: {
            ...g,
            categories: g.categories.map(cat =>
              cat.id === categoryId ? { ...cat, collapsed: !cat.collapsed } : cat,
            ),
          },
        },
      };
    }),

  // ── Sidebar mode ─────────────────
  setSidebarMode: (mode, groupId) =>
    set((s) => {
      if (mode === 'dm') {
        return { sidebarMode: 'dm' as const, activeGroupId: null, activeChannelId: null };
      }
      const gid = groupId ?? null;
      const group = gid ? s.groups[gid] : null;
      const firstChannel = group?.channels?.[0]?.id ?? null;
      return {
        sidebarMode: 'group' as const,
        activeGroupId: gid,
        activeChannelId: firstChannel,
        activeConversation: gid,
      };
    }),
  setActiveChannel: (channelId) =>
    set((s) => ({
      activeChannelId: channelId,
      ...(s.activeGroupId ? { activeConversation: s.activeGroupId } : {}),
    })),

  // ── Group CRUD ───────────────────
  addChannel: (groupId, channel) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const nextGroup = { ...g, channels: [...g.channels, channel] };
      return {
        groups: { ...s.groups, [groupId]: nextGroup },
        ...(s.activeGroupId === groupId && !s.activeChannelId ? { activeChannelId: channel.id } : {}),
      };
    }),
  updateChannel: (groupId, channelId, patch) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, channels: g.channels.map(ch => ch.id === channelId ? { ...ch, ...patch } : ch) } } };
    }),
  deleteChannel: (groupId, channelId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const nextChannels = g.channels.filter(ch => ch.id !== channelId);
      const channelConversationId = makeGroupChannelConversationId(groupId, channelId);
      const nextMessages = Object.fromEntries(
        Object.entries(s.messages).filter(([conversationId]) => conversationId !== channelConversationId),
      );
      return {
        groups: { ...s.groups, [groupId]: { ...g, channels: nextChannels } },
        messages: nextMessages,
        ...(s.activeGroupId === groupId && s.activeChannelId === channelId
          ? { activeChannelId: nextChannels[0]?.id ?? null }
          : {}),
      };
    }),
  addCategory: (groupId, category) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, categories: [...g.categories, category] } } };
    }),
  deleteCategory: (groupId, categoryId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, categories: g.categories.filter(c => c.id !== categoryId), channels: g.channels.map(ch => ch.categoryId === categoryId ? { ...ch, categoryId: null } : ch) } } };
    }),
  addRole: (groupId, role) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, roles: [...(g.roles ?? []), role] } } };
    }),
  updateRole: (groupId, roleId, patch) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, roles: (g.roles ?? []).map(r => r.id === roleId ? { ...r, ...patch } : r) } } };
    }),
  deleteRole: (groupId, roleId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, roles: (g.roles ?? []).filter(r => r.id !== roleId), members: g.members.map(m => ({ ...m, roleIds: (m.roleIds ?? []).filter(id => id !== roleId) })) } } };
    }),
  updateMember: (groupId, userId, patch) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, members: g.members.map(m => m.userId === userId ? { ...m, ...patch } : m) } } };
    }),
  kickMember: (groupId, userId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { groups: { ...s.groups, [groupId]: { ...g, members: g.members.filter(m => m.userId !== userId) } } };
    }),
  appendAuditLog: (groupId, entry) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const full: AuditLogEntry = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
      return { groups: { ...s.groups, [groupId]: { ...g, auditLog: [...(g.auditLog ?? []), full] } } };
    }),
  updateGroupOverview: (groupId, patch) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const updated: GroupInfo = {
        ...g,
        ...patch,
        avatar: patch.avatar === null ? undefined : (patch.avatar ?? g.avatar),
      };
      // Also update the conversation name if name changed
      const conv = s.conversations[groupId];
      return {
        groups: { ...s.groups, [groupId]: updated },
        ...(conv && patch.name ? { conversations: { ...s.conversations, [groupId]: { ...conv, name: patch.name } } } : {}),
      };
    }),

  // ── Nicknames ────────────────────
  setNickname: (userId, nickname) =>
    set((s) => ({ nicknames: { ...s.nicknames, [userId]: nickname } })),
  clearNickname: (userId) =>
    set((s) => {
      const { [userId]: _, ...rest } = s.nicknames;
      return { nicknames: rest };
    }),

  // ── Search ───────────────────────
  setSearchQuery: (query) => set({ searchQuery: query }),

  // ── Remote profiles ──────────────
  setRemoteProfile: (userId, profile) =>
    set((s) => ({ remoteProfiles: { ...s.remoteProfiles, [userId]: profile } })),
  setTypingUsers: (convId, users) =>
    set((s) => ({ typingUsers: { ...s.typingUsers, [convId]: users } })),
  storeAttachmentData: (id, base64) =>
    set((s) => ({ attachmentData: { ...s.attachmentData, [id]: base64 } })),
}), {
  name: 'dl-chat',
  version: 1,
  storage: {
    getItem: (name) => {
      try {
        const str = localStorage.getItem(name);
        return str ? JSON.parse(str) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, JSON.stringify(value));
      } catch (e) {
        // Quota exceeded — try to trim messages further and retry
        log.warn('localStorage write failed, trimming messages:', e);
        try {
          if (value?.state?.messages) {
            const trimmed = { ...value };
            const trimmedMsgs: Record<string, any[]> = {};
            for (const [k, msgs] of Object.entries(value.state.messages as Record<string, any[]>)) {
              if (Array.isArray(msgs) && msgs.length > 0) trimmedMsgs[k] = msgs.slice(-10);
            }
            trimmed.state = { ...trimmed.state, messages: trimmedMsgs };
            localStorage.setItem(name, JSON.stringify(trimmed));
          }
        } catch {
          log.error('localStorage write failed even after trim');
        }
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  },
  partialize: (s) => {
    // Cap messages to last 50 per conversation to stay within localStorage ~5MB limit
    const cappedMessages: Record<string, any[]> = {};
    for (const [convId, msgs] of Object.entries(s.messages)) {
      if (Array.isArray(msgs) && msgs.length > 0) {
        cappedMessages[convId] = msgs.slice(-50);
      }
    }
    return {
      contacts: s.contacts,
      conversations: s.conversations,
      messages: cappedMessages,
      groups: s.groups,
      nicknames: s.nicknames,
      sidebarMode: s.sidebarMode,
      activeGroupId: s.activeGroupId,
      activeChannelId: s.activeChannelId,
    } as ChatState;
    // NOTE: attachmentData excluded — too large for localStorage's ~5MB limit
  },
}));
