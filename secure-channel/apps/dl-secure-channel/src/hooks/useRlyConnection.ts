/* ──────────────────────────────────────────────────────────
 *  useRlyConnection — opens the WebSocket to the RLY relay,
 *  handles incoming messages, and broadcasts presence
 *  subscriptions for all known contacts.
 * ────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { hasUsableSessionToken, useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useFriendStore } from '../stores/friendStore.js';
import { useProfileStore } from '../stores/profileStore.js';
import { useTagStore } from '../stores/tagStore.js';
import { useConvSecurityStore } from '../stores/convSecurityStore';
import { useConvThemeStore } from '../stores/convThemeStore';
import * as ws from '../net/wsClient.js';
import { decryptPayload, ensureKeysRegistered } from '../crypto/e2eeSessions.js';
import { pullSync, startAutoSync, stopAutoSync, resetSyncSession } from '../services/syncService.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { useCallStore } from '../stores/callStore';
import type { Attachment } from '../types.js';
import { makeGroupChannelConversationId } from '../utils/groupChannelKeys';
import { normalizeModerationSettings } from '../utils/groupModeration';
import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';
import {
  InvalidEnvelopeRateLimiter,
  parseDirectMessageEnvelope,
  UNSUPPORTED_DIRECT_MESSAGE_NOTICE,
} from '../security/directMessageEnvelope';
import { createLogger } from '../utils/logger';

const invalidEnvelopeLimiter = new InvalidEnvelopeRateLimiter();
const log = createLogger('relay-receive');

export function useRlyConnection() {
  const screen = useAuthStore(s => s.screen);
  const userId = useAuthStore(s => s.userId);
  const sessionToken = useAuthStore(s => s.sessionToken);
  const contacts = useChatStore(s => s.contacts);
  const hasValidSessionToken = hasUsableSessionToken(sessionToken);

  // Connect / disconnect based on whether we're on the main screen
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken) return;
    ws.connect(userId);
    return () => {
      ws.disconnect();
    };
  }, [screen, userId, hasValidSessionToken]);

  // Fetch friends once we have both a valid screen AND a session token.
  // Splitting this out of the WS effect prevents 401s from a race where
  // screen === 'main' but sessionToken hasn't been set yet.
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken || !sessionToken) return;
    useFriendStore.getState().fetchFriends(userId);
    useFriendStore.getState().fetchIncoming(userId);
    useFriendStore.getState().fetchOutgoing(userId);

    const idsUrl = useConnectionStore.getState().idsUrl;
    fetch(`${idsUrl}/users/me/tags`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Tag fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const grantedIds = Array.isArray(data.granted)
          ? data.granted.map((tag: { key?: string; id?: string }) => tag.key ?? tag.id).filter(Boolean)
          : [];
        useTagStore.getState().setUserTags(userId, grantedIds);
      })
      .catch(() => {});
  }, [screen, userId, sessionToken, hasValidSessionToken]);

  // Cross-device sync: runs once per authenticated session.
  // Depends on sessionToken so it fires AFTER unlock (token is not persisted;
  // userId IS persisted, so we must not fire until both are present).
  useEffect(() => {
    if (!userId || !sessionToken || !hasValidSessionToken) return;
    // Ensure E2EE keys are registered on IDS (covers sessions that persisted
    // across deploys and never went through a fresh login re-check).
    const idsUrl = useConnectionStore.getState().idsUrl;
    ensureKeysRegistered(userId, sessionToken, idsUrl);
    // Pull from server on first login, then start auto-push/poll
    pullSync().then(() => {
      // Ensure profile identity matches the authenticated user (never overwritten by sync)
      const auth = useAuthStore.getState();
      const profile = useProfileStore.getState();
      if (auth.userId && (!profile.username || profile.username !== auth.userId)) {
        useProfileStore.setState({
          username: auth.userId,
          displayName: auth.displayName || auth.userId,
        });
      }
      startAutoSync();
    });
    return () => {
      stopAutoSync();
      resetSyncSession();
    };
  }, [userId, sessionToken, hasValidSessionToken]);

  // When contacts change, re-subscribe to their presence
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken) return;
    const userIds = Object.keys(contacts);
    if (userIds.length === 0) return;
    // Small delay to let the WS auth complete first
    const t = setTimeout(() => {
      void ws.subscribePresence(userIds);
      // Also request cached profiles for these contacts
      void ws.requestProfiles(userIds);
    }, 500);
    return () => clearTimeout(t);
  }, [screen, userId, hasValidSessionToken, Object.keys(contacts).join(',')]);

  // Re-sync local profile to relay whenever it changes
  const profileData = useProfileStore();
  const userTags = useTagStore(s => s.userTags);
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken) return;
    // Debounce to avoid flooding on rapid edits
    const t = setTimeout(() => ws.syncProfile(), 400);
    return () => clearTimeout(t);
  }, [
    screen, userId,
    hasValidSessionToken,
    profileData.displayName, profileData.username, profileData.avatar,
    profileData.banner, profileData.bannerFit, profileData.bio, profileData.pronouns,
    profileData.usernameColor, profileData.accentColor, profileData.presence,
    profileData.statusText, profileData.statusEmoji,
    profileData.links,
    userTags,
  ]);

  // Periodic profile re-sync: re-request all contact profiles every 30s
  // This ensures pfp/bio changes propagate even if a real-time event is missed
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken) return;
    const t = setInterval(() => {
      const userIds = Object.keys(useChatStore.getState().contacts);
      if (userIds.length > 0) {
        void ws.requestProfiles(userIds);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [screen, userId, hasValidSessionToken]);

  // Handle incoming messages from the relay
  // NOTE: read from getState() inside callback to avoid stale closures
  useEffect(() => {
    if (screen !== 'main' || !userId || !hasValidSessionToken) return;

    const unsub = ws.onMessage(async (msg) => {
      if (typeof msg.type === 'string' && msg.type.startsWith('call_')) {
        await useCallStore.getState().handleRelayMessage(msg);
        return;
      }

      if (msg.type === 'message' || msg.type === 'group_message') {
        const from = typeof msg.from === 'string' ? msg.from.trim() : '';
        if (!from) return;
        const isGroupMessage = msg.type === 'group_message';
        if (isGroupMessage && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) return;
        if (!isGroupMessage && !invalidEnvelopeLimiter.canAttempt(from)) return;
        const groupId = isGroupMessage ? String(msg.groupId ?? '').trim() : '';
        const incomingChannelId = isGroupMessage ? String(msg.channelId ?? '').trim() : '';

        // Read fresh state to avoid stale closure
        const {
          conversations,
          contacts,
          groups,
          addMessage,
          addConversation,
          addContact,
          addChannel,
          setGroupInfo,
        } = useChatStore.getState();

        const fallbackChannelId = groupId ? (groups[groupId]?.channels?.[0]?.id ?? null) : null;
        const effectiveChannelId = incomingChannelId || (fallbackChannelId ?? '');
        const convId = isGroupMessage
          ? makeGroupChannelConversationId(groupId, effectiveChannelId || null)
          : [userId, from].sort().join(':');
        const rootConversationId = isGroupMessage ? groupId : convId;
        let conv = conversations[rootConversationId];

        if (isGroupMessage && !groupId) return;

        // Auto-create the conversation if it doesn't exist yet
        // (handles case where sender opened DM but receiver never created it)
        if (!conv && msg.type === 'message') {
          if (!contacts[from]) {
            addContact({ id: from, displayName: from, identityKey: '', trustLevel: 'unverified', addedAt: Date.now() });
          }
          addConversation({
            id: convId,
            type: 'dm',
            members: [userId, from],
            createdAt: Date.now(),
            unreadCount: 0,
          });
          conv = useChatStore.getState().conversations[convId];
        }

        // Auto-create group conversation if invite was missed/queued
        if (!conv && msg.type === 'group_message') {
          const localUserId = userId ?? '';
          if (!contacts[from]) {
            addContact({ id: from, displayName: from, identityKey: '', trustLevel: 'unverified', addedAt: Date.now() });
          }
          const bootstrapCategoryId = crypto.randomUUID();
          const bootstrapChannelId = effectiveChannelId || crypto.randomUUID();
          const bootstrapRoleId = crypto.randomUUID();
          addConversation({
            id: rootConversationId,
            type: 'group',
            name: 'Group',
            members: [localUserId, from],
            createdAt: Date.now(),
            unreadCount: 0,
          });
          setGroupInfo(groupId, {
            id: groupId,
            name: 'Group',
            members: [
              { userId: localUserId, role: 'member', joinedAt: Date.now(), roleIds: [bootstrapRoleId] },
              { userId: from, role: 'member', joinedAt: Date.now(), roleIds: [bootstrapRoleId] },
            ],
            channels: [
              {
                id: bootstrapChannelId,
                name: String(msg.channelName ?? 'general').trim().toLowerCase().replace(/\s+/g, '-') || 'general',
                type: 'text',
                categoryId: bootstrapCategoryId,
                position: 0,
              },
            ],
            categories: [
              { id: bootstrapCategoryId, name: 'Text Channels', position: 0 },
            ],
            roles: [
              {
                id: bootstrapRoleId,
                name: '@everyone',
                color: '#99aab5',
                permissions: { administrator: false, manageChannels: false, manageRoles: false, manageServer: false, kickMembers: false, banMembers: false, manageMessages: false, sendMessages: true, readMessages: true, attachFiles: true, useVoice: true, mentionEveryone: false, viewAuditLog: false, manageInvites: false },
                position: 0,
                isDefault: true,
              },
            ],
            auditLog: [
              { id: crypto.randomUUID(), action: 'member_join', userId: from, timestamp: Date.now(), detail: `${from} sent a group message` },
            ],
            createdAt: Date.now(),
            createdBy: from,
          });
          conv = useChatStore.getState().conversations[rootConversationId];
        }
        if (!conv) return;

        // If we receive a message for an unknown channel, create it locally.
        if (isGroupMessage && groupId && effectiveChannelId) {
          const group = useChatStore.getState().groups[groupId];
          const hasChannel = !!group?.channels?.some((ch) => ch.id === effectiveChannelId);
          if (group && !hasChannel) {
            const fallbackCategoryId = group.categories?.[0]?.id ?? null;
            const normalizedName = String(msg.channelName ?? '').trim().toLowerCase().replace(/\s+/g, '-');
            addChannel(groupId, {
              id: effectiveChannelId,
              name: normalizedName || `channel-${effectiveChannelId.slice(0, 8)}`,
              type: 'text',
              categoryId: fallbackCategoryId,
              position: group.channels.length,
            });
          }
        }

        let rawPayload: string;
        const parsedEnvelope = parseDirectMessageEnvelope(msg.payload);
        if (!parsedEnvelope.ok) {
          invalidEnvelopeLimiter.recordFailure(from);
          log.warn('SECURITY_DM_ENVELOPE_REJECTED');
          rawPayload = JSON.stringify({ text: UNSUPPORTED_DIRECT_MESSAGE_NOTICE });
        } else {
          const decrypted = await decryptPayload(from, parsedEnvelope.ciphertext, parsedEnvelope.x3dh);
          if (decrypted === null) {
            invalidEnvelopeLimiter.recordFailure(from);
            log.warn('SECURITY_DM_AUTHENTICATION_REJECTED');
            rawPayload = JSON.stringify({ text: UNSUPPORTED_DIRECT_MESSAGE_NOTICE });
          } else {
            rawPayload = decrypted;
          }
        }

        let content = rawPayload;
        let attachments: Attachment[] | undefined;
        let replyTo: string | undefined;
        try {
          const parsed = JSON.parse(rawPayload);
          if (parsed && typeof parsed.text === 'string') {
            content = parsed.text;
            if (parsed.replyTo) replyTo = parsed.replyTo;
            if (Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
              attachments = parsed.attachments.map((att: { id: string; name: string; mimeType: string; size: number; data: string; key: string; nonce: string }) => {
                // Decode base64 encrypted data → blob URL (chunked to avoid stack overflow)
                const bin = atob(att.data);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const blob = new Blob([bytes], { type: 'application/octet-stream' });
                // Also persist the raw base64 so decryption works after app restart
                useChatStore.getState().storeAttachmentData(att.id, att.data);
                return {
                  id: att.id,
                  name: att.name,
                  mimeType: att.mimeType,
                  size: att.size,
                  encryptedUrl: URL.createObjectURL(blob),
                  key: att.key,
                  nonce: att.nonce,
                } as Attachment;
              });
            }
          }
        } catch {
          // Authenticated plaintext may itself be a simple text payload.
        }

        addMessage(convId, {
          id: msg.id ?? crypto.randomUUID(),
          conversationId: convId,
          senderId: from,
          content,
          timestamp: msg.timestamp ?? Date.now(),
          status: 'delivered',
          ...(attachments ? { attachments } : {}),
          ...(replyTo ? { replyTo } : {}),
        });
      }

      // Someone sent us a friend request
      if (msg.type === 'friend_request') {
        if (typeof msg.requestId === 'string' && msg.requestId) {
          useFriendStore.getState().addIncomingRequest({
            id: msg.requestId,
            fromUser: msg.from,
            displayName: msg.displayName ?? msg.from,
            createdAt: new Date().toISOString(),
          });
        } else if (userId) {
          // A legacy relay packet may not include the server request ID.
          // Refresh from IDS rather than adding an action that cannot be accepted.
          void useFriendStore.getState().fetchIncoming(userId);
        }
      }

      // We've been invited to a group chat
      if (msg.type === 'group_invite') {
        const groupId: string = msg.groupId;
        const groupName: string = msg.groupName ?? 'Group';
        const members: { userId: string; role: string; joinedAt: number }[] = msg.members ?? [];
        const incomingChannels = Array.isArray(msg.channels) ? msg.channels : [];
        const incomingCategories = Array.isArray(msg.categories) ? msg.categories : [];
        const incomingRoles = Array.isArray(msg.roles) ? msg.roles : [];
        const incomingTheme = (msg.theme && typeof msg.theme === 'object' && !Array.isArray(msg.theme)) ? msg.theme : null;
        const incomingModeration = normalizeModerationSettings(msg.moderation);
        const from: string = msg.from;

        const { conversations, contacts, addConversation, addContact, setGroupInfo } = useChatStore.getState();

        // Ensure all group members exist as contacts
        for (const m of members) {
          if (m.userId !== userId && !contacts[m.userId]) {
            addContact({ id: m.userId, displayName: m.userId, identityKey: '', trustLevel: 'unverified', addedAt: Date.now() });
          }
        }

        // Create the conversation if it doesn't exist yet
        if (!conversations[groupId]) {
          const memberIds = members.map(m => m.userId);
          addConversation({
            id: groupId,
            type: 'group',
            name: groupName,
            members: memberIds,
            createdAt: Date.now(),
            unreadCount: 0,
          });
        }

        // Store group metadata (prefer inviter-provided IDs to keep channels in sync across members).
        const defaultCatId = crypto.randomUUID();
        const defaultChId = crypto.randomUUID();
        const defaultRoleId = crypto.randomUUID();

        const categories = incomingCategories.length > 0
          ? incomingCategories
              .map((category: any, index: number) => ({
                id: String(category?.id ?? '').trim() || crypto.randomUUID(),
                name: String(category?.name ?? 'Text Channels').trim() || 'Text Channels',
                position: typeof category?.position === 'number' ? category.position : index,
                ...(category?.collapsed ? { collapsed: true } : {}),
              }))
          : [{ id: defaultCatId, name: 'Text Channels', position: 0 }];

        const defaultCategoryId = categories[0]?.id ?? defaultCatId;

        const channels = incomingChannels.length > 0
          ? incomingChannels
              .map((channel: any, index: number) => ({
                id: String(channel?.id ?? '').trim() || crypto.randomUUID(),
                name: String(channel?.name ?? 'general').trim() || 'general',
                type: channel?.type ?? 'text',
                categoryId: channel?.categoryId ?? defaultCategoryId,
                position: typeof channel?.position === 'number' ? channel.position : index,
                ...(channel?.isNsfw ? { isNsfw: true } : {}),
                ...(typeof channel?.userLimit === 'number' ? { userLimit: channel.userLimit } : {}),
              }))
          : [{ id: defaultChId, name: 'general', type: 'text', categoryId: defaultCategoryId, position: 0 }];

        const roles = incomingRoles.length > 0
          ? incomingRoles
              .map((role: any, index: number) => ({
                id: String(role?.id ?? '').trim() || crypto.randomUUID(),
                name: String(role?.name ?? '@everyone').trim() || '@everyone',
                color: String(role?.color ?? '#99aab5').trim() || '#99aab5',
                permissions: role?.permissions ?? { administrator: false, manageChannels: false, manageRoles: false, manageServer: false, kickMembers: false, banMembers: false, manageMessages: false, sendMessages: true, readMessages: true, attachFiles: true, useVoice: true, mentionEveryone: false, viewAuditLog: false, manageInvites: false },
                position: typeof role?.position === 'number' ? role.position : index,
                ...(role?.isDefault || index === 0 ? { isDefault: true } : {}),
              }))
          : [{ id: defaultRoleId, name: '@everyone', color: '#99aab5', permissions: { administrator: false, manageChannels: false, manageRoles: false, manageServer: false, kickMembers: false, banMembers: false, manageMessages: false, sendMessages: true, readMessages: true, attachFiles: true, useVoice: true, mentionEveryone: false, viewAuditLog: false, manageInvites: false }, position: 0, isDefault: true }];

        setGroupInfo(groupId, {
          id: groupId,
          name: groupName,
          members: members.map(m => ({
            userId: m.userId,
            role: m.role as 'admin' | 'member',
            joinedAt: m.joinedAt,
            roleIds: [roles[0]?.id ?? defaultRoleId],
          })),
          channels,
          categories,
          roles,
          auditLog: [
            { id: crypto.randomUUID(), action: 'member_join', userId: from, timestamp: Date.now(), detail: `${from} created the group` },
          ],
          createdAt: Date.now(),
          createdBy: from,
          moderation: incomingModeration,
        });

        if (incomingTheme) {
          useConvThemeStore.getState().setTheme(groupId, incomingTheme);
        }
      }

      if (msg.type === 'group_settings_update') {
        const groupId = String(msg.groupId ?? '').trim();
        if (!groupId) return;
        const settings = msg.settings;
        if (!settings || typeof settings !== 'object') return;

        const themePatch = (settings as any).theme;
        if (themePatch && typeof themePatch === 'object' && !Array.isArray(themePatch)) {
          useConvThemeStore.getState().setTheme(groupId, themePatch);
        }

        const securityPatch = (settings as any).security;
        if (securityPatch && typeof securityPatch === 'object' && !Array.isArray(securityPatch)) {
          useConvSecurityStore.getState().set(groupId, securityPatch);
        }

        const moderationPatch = (settings as any).moderation;
        if (moderationPatch && typeof moderationPatch === 'object' && !Array.isArray(moderationPatch)) {
          const chat = useChatStore.getState();
          const existing = chat.groups[groupId];
          if (existing) {
            chat.setGroupInfo(groupId, {
              ...existing,
              moderation: normalizeModerationSettings({
                ...(existing.moderation ?? {}),
                ...moderationPatch,
              }),
            });
          }
        }
      }

      // Other user opened (or re-opened) a DM with us — mirror the conversation
      if (msg.type === 'open_dm') {
        const from: string = msg.from;
        const fromName: string = msg.displayName ?? from;
        const { contacts: cts, conversations: convs, addContact, addConversation } = useChatStore.getState();
        if (!cts[from]) {
          addContact({ id: from, displayName: fromName, identityKey: '', trustLevel: 'unverified', addedAt: Date.now() });
        }
        const convId = [userId, from].sort().join(':');
        if (!convs[convId]) {
          addConversation({ id: convId, type: 'dm', members: [userId, from], createdAt: Date.now(), unreadCount: 0 });
        }
      }

      // Someone accepted our friend request — create conversation on OUR side
      if (msg.type === 'friend_accept') {
        const from: string = msg.from;
        const fromName: string = msg.displayName ?? from;
        useFriendStore.getState().addFriend({ userId: from, displayName: fromName });

        const { addContact, addConversation: addConv, conversations: convs } = useChatStore.getState();
        addContact({ id: from, displayName: fromName, identityKey: '', trustLevel: 'unverified', addedAt: Date.now() });

        const convId = [userId, from].sort().join(':');
        if (!convs[convId]) {
          addConv({
            id: convId,
            type: 'dm',
            members: [userId, from],
            createdAt: Date.now(),
            unreadCount: 0,
          });
        }
      }
    });

    return unsub;
  }, [screen, userId, hasValidSessionToken]);
}
