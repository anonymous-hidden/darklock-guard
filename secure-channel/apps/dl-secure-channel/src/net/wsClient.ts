/* ──────────────────────────────────────────────────────────
 *  WebSocket client — persistent connection to RLY
 *  Auto-reconnect with exponential backoff.
 * ────────────────────────────────────────────────────────── */

import { useConnectionStore } from '../stores/connectionStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useProfileStore } from '../stores/profileStore.js';
import { useTagStore } from '../stores/tagStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { fetchRelaySendPermit } from './idsClient.js';
import type { GroupCategory, GroupChannel, GroupModerationSettings, GroupRoleInfo } from '../types';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let globalUserId: string | null = null;
const MAX_WS_MESSAGE_BYTES = 16 * 1024 * 1024;

type MessageHandler = (msg: any) => void;
const handlers: MessageHandler[] = [];

const DIRECT_PERMIT_EVENT_TYPES = new Set([
  'typing',
  'receipt',
  'delete_message',
  'edit_message',
  'friend_accept',
  'open_dm',
  'tag_update',
  'friend_request',
  'message',
  'call_invite',
  'call_accept',
  'call_reject',
  'call_end',
  'call_signal',
  'call_media',
]);

const GROUP_PERMIT_EVENT_TYPES = new Set([
  'group_invite',
  'group_message',
  'group_settings_update',
]);

const METADATA_PERMIT_EVENT_TYPES = new Set([
  'subscribe_presence',
  'profile_request',
]);

export type CallPermitEventType =
  | 'call_invite'
  | 'call_accept'
  | 'call_reject'
  | 'call_end'
  | 'call_signal'
  | 'call_media';

export function onMessage(handler: MessageHandler) {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

export function connect(userId: string) {
  const { wsUrl, setStatus } = useConnectionStore.getState();
  if (ws && ws.readyState <= 1) return;

  globalUserId = userId;
  setStatus('connecting');

  ws = new WebSocket(wsUrl);

  ws.onopen = async () => {
    reconnectAttempt = 0;
    setStatus('connected');
    // Authenticate — include session token for server-side validation (CRIT-1)
    const token = useAuthStore.getState().sessionToken;
    ws!.send(JSON.stringify({ type: 'auth', userId, token }));
    // Send current profile to the relay for other users
    syncProfile();
    // Start heartbeat
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === 1) {
        const start = Date.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  };

  ws.onmessage = (event) => {
    try {
      // Allow encrypted attachment payloads while still capping untrusted frame size.
      if (typeof event.data === 'string' && event.data.length > MAX_WS_MESSAGE_BYTES) {
        return; // Drop oversized messages
      }
      const msg = JSON.parse(event.data);
      // DARK-021: Validate message has a type field
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'pong') {
        useConnectionStore.getState().setLatency(Date.now() - (msg.timestamp || Date.now()));
        return;
      }

      // Update contact online status + rich presence from presence broadcasts
      if (msg.type === 'presence') {
        useChatStore.getState().setContactOnline(msg.userId, msg.online);
        // Always request the latest profile when a user comes online
        // (catches avatar/bio changes made while they were offline)
        if (msg.online) {
          void requestProfiles([msg.userId]);
        }
        return;
      }

      // Incoming profile data for a remote user
      if (msg.type === 'profile_data') {
        useChatStore.getState().setRemoteProfile(msg.userId, msg.profile);
        return;
      }

      // MED-6: Server sends lightweight profile_changed — fetch full profile on demand
      if (msg.type === 'profile_changed') {
        void requestProfiles([msg.userId]);
        return;
      }

      // Remote user deleted a message
      if (msg.type === 'delete_message') {
        useChatStore.getState().deleteMessage(msg.conversationId, msg.messageId);
        return;
      }

      // Remote user edited a message
      if (msg.type === 'edit_message') {
        useChatStore.getState().editMessage(msg.conversationId, msg.messageId, msg.newText);
        return;
      }

      // Remote user is typing
      if (msg.type === 'typing') {
        const { typingUsers } = useChatStore.getState();
        const convId = msg.conversationId as string;
        const from = msg.from as string;
        const existing = typingUsers[convId] ?? {};
        useChatStore.getState().setTypingUsers(convId, { ...existing, [from]: Date.now() });
        return;
      }

      // Admin gave or removed a tag
      if (msg.type === 'tag_update') {
        const { tagId, action } = msg;
        const targetUserId =
          (typeof msg.targetUserId === 'string' && msg.targetUserId)
          || (typeof msg.to === 'string' && msg.to)
          || globalUserId;
        if (targetUserId && tagId && typeof tagId === 'string') {
          if (action === 'give') {
            useTagStore.getState().giveTag(targetUserId, tagId);
          } else if (action === 'remove') {
            useTagStore.getState().removeTag(targetUserId, tagId);
          }
        }
        return;
      }

      for (const handler of handlers) {
        handler(msg);
      }
    } catch {
      // Malformed message — ignore silently
    }
  };

  ws.onclose = () => {
    setStatus('reconnecting');
    if (pingInterval) clearInterval(pingInterval);
    scheduleReconnect(userId);
  };

  ws.onerror = () => {
    // Error will trigger onclose
  };
}

function scheduleReconnect(userId: string) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30_000);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => connect(userId), delay);
}

export function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingInterval) clearInterval(pingInterval);
  reconnectTimer = null;
  reconnectAttempt = 0;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  useConnectionStore.getState().setStatus('disconnected');
}

export function send(msg: Record<string, unknown>) {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export async function sendMessage(to: string, payload: string, id?: string) {
  return sendDirectEventWithPermit('message', to, { payload, id });
}

export async function sendGroupMessage(
  groupId: string,
  recipients: string[],
  payload: string,
  id?: string,
  channelId?: string,
  channelName?: string,
) {
  const normalizedChannelId = String(channelId ?? '').trim();
  const normalizedChannelName = String(channelName ?? '').trim();

  return sendGroupEventWithPermit('group_message', groupId, recipients, {
    payload,
    id,
    ...(normalizedChannelId ? { channelId: normalizedChannelId } : {}),
    ...(normalizedChannelName ? { channelName: normalizedChannelName.slice(0, 64) } : {}),
  });
}

function normalizeRecipients(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const self = globalUserId;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const userId = raw.trim();
    if (!userId) continue;
    if (self && userId === self) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }

  return out;
}

async function requestRelayPermit(payload: {
  type: string;
  to?: string;
  recipients?: string[];
  groupId?: string;
}): Promise<string | null> {
  if (
    !DIRECT_PERMIT_EVENT_TYPES.has(payload.type)
    && !GROUP_PERMIT_EVENT_TYPES.has(payload.type)
    && !METADATA_PERMIT_EVENT_TYPES.has(payload.type)
  ) {
    return null;
  }

  const sessionToken = useAuthStore.getState().sessionToken;
  if (!sessionToken) {
    console.warn('[RELAY_PERMIT_SESSION_MISSING]');
    return null;
  }

  try {
    const result = await fetchRelaySendPermit(sessionToken, payload);
    if (!result || typeof result.permit !== 'string' || result.permit.trim().length === 0) {
      console.warn('[RELAY_PERMIT_RESPONSE_INVALID]');
      return null;
    }
    return result.permit;
  } catch {
    console.warn('[RELAY_PERMIT_FETCH_FAILED]');
    return null;
  }
}

async function sendDirectEventWithPermit(
  type: string,
  to: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const target = String(to || '').trim();
  if (!target) return false;

  const permit = await requestRelayPermit({ type, to: target });
  if (!permit) return false;

  return send({ type, to: target, ...payload, permit });
}

async function sendDirectEventFanoutWithPermit(
  type: string,
  packets: Array<{ to: string; payload: Record<string, unknown> }>,
): Promise<boolean> {
  if (!DIRECT_PERMIT_EVENT_TYPES.has(type)) return false;

  const normalizedPackets: Array<{ to: string; payload: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  for (const packet of packets) {
    const target = String(packet.to || '').trim();
    if (!target) continue;
    if (globalUserId && target === globalUserId) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    normalizedPackets.push({ to: target, payload: packet.payload });
  }

  if (normalizedPackets.length === 0) return false;

  // Acquire all permits first to avoid partially sending fanout events.
  const permitByRecipient = new Map<string, string>();
  for (const packet of normalizedPackets) {
    const permit = await requestRelayPermit({ type, to: packet.to });
    if (!permit) return false;
    permitByRecipient.set(packet.to, permit);
  }

  let allSent = true;
  for (const packet of normalizedPackets) {
    const permit = permitByRecipient.get(packet.to);
    if (!permit) {
      allSent = false;
      continue;
    }
    if (!send({ type, to: packet.to, ...packet.payload, permit })) {
      allSent = false;
    }
  }

  return allSent;
}

async function sendDirectEventToRecipientsWithPermit(
  type: string,
  recipients: string[] | undefined,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const targets = normalizeRecipients(recipients);
  if (targets.length === 0) return false;

  return sendDirectEventFanoutWithPermit(
    type,
    targets.map((to) => ({ to, payload })),
  );
}

async function sendGroupEventWithPermit(
  type: 'group_invite' | 'group_message' | 'group_settings_update',
  groupId: string,
  recipients: string[] | undefined,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const normalizedRecipients = normalizeRecipients(recipients);
  if (normalizedRecipients.length === 0) return false;

  const normalizedGroupId = String(groupId || '').trim();
  if (!normalizedGroupId) return false;

  const permit = await requestRelayPermit({
    type,
    groupId: normalizedGroupId,
    recipients: normalizedRecipients,
  });
  if (!permit) return false;

  return send({
    type,
    groupId: normalizedGroupId,
    recipients: normalizedRecipients,
    ...payload,
    permit,
  });
}

async function sendMetadataEventWithPermit(
  type: 'subscribe_presence' | 'profile_request',
  userIds: string[] | undefined,
): Promise<boolean> {
  const recipients = normalizeRecipients(userIds);
  if (recipients.length === 0) return false;

  const permit = await requestRelayPermit({
    type,
    recipients,
  });
  if (!permit) return false;

  return send({
    type,
    userIds: recipients,
    permit,
  });
}

export async function sendTyping(to: string, conversationId: string, recipients?: string[]) {
  if (to) {
    return sendDirectEventWithPermit('typing', to, { conversationId });
  }
  return sendDirectEventToRecipientsWithPermit('typing', recipients, { conversationId });
}

export async function sendReceipt(to: string, messageId: string, status: string) {
  return sendDirectEventWithPermit('receipt', to, { messageId, status });
}

export async function sendDeleteMessage(to: string | null, messageId: string, conversationId: string, recipients?: string[]) {
  if (to) {
    return sendDirectEventWithPermit('delete_message', to, { messageId, conversationId });
  }
  return sendDirectEventToRecipientsWithPermit('delete_message', recipients, { messageId, conversationId });
}

export async function sendEditMessage(to: string | null, messageId: string, conversationId: string, newText: string, recipients?: string[]) {
  if (to) {
    return sendDirectEventWithPermit('edit_message', to, { messageId, conversationId, newText });
  }
  return sendDirectEventToRecipientsWithPermit('edit_message', recipients, { messageId, conversationId, newText });
}

/** Push current local profile to the relay so others can see it */
export function syncProfile() {
  const p = useProfileStore.getState();
  const tags = useTagStore.getState().userTags;
  const userId = (globalUserId ?? '');
  return send({
    type: 'profile_sync',
    profile: {
      displayName: p.displayName,
      username: p.username,
      avatar: p.avatar,
      banner: p.banner,
      bannerFit: p.bannerFit ?? 'cover',
      bio: p.bio,
      pronouns: p.pronouns,
      usernameColor: p.usernameColor,
      accentColor: p.accentColor,
      accentColor2: p.accentColor2 ?? '',
      gradientAngle: p.gradientAngle ?? 135,
      nameplate: p.nameplate ?? '',
      sectionOrder: p.sectionOrder ?? ['tags', 'status', 'bio', 'links'],
      presence: p.presence,
      statusText: p.statusText,
      statusEmoji: p.statusEmoji,
      tags: tags[userId] ?? [],
      selectedTags: (p as any).selectedTags ?? [],
      links: p.links ?? [],
    },
  });
}

/** Tell the relay our presence changed */
export function sendPresenceUpdate(presence: string) {
  return send({ type: 'presence_update', presence });
}

/** Ask the relay for profiles of given userIds */
export async function requestProfiles(userIds: string[]) {
  return sendMetadataEventWithPermit('profile_request', userIds);
}

/** Subscribe to presence updates for given userIds */
export async function subscribePresence(userIds: string[]) {
  return sendMetadataEventWithPermit('subscribe_presence', userIds);
}

export async function sendFriendAccept(to: string, displayName: string) {
  return sendDirectEventWithPermit('friend_accept', to, { displayName });
}

export async function sendOpenDm(to: string, displayName: string) {
  return sendDirectEventWithPermit('open_dm', to, { displayName });
}

export async function sendFriendRequest(to: string, requestId: number | string | undefined, displayName: string) {
  const payload: Record<string, unknown> = { displayName };
  if (requestId !== undefined) payload.requestId = requestId;
  return sendDirectEventWithPermit('friend_request', to, payload);
}

export async function sendCallEvent(
  type: CallPermitEventType,
  to: string,
  payload: string,
  timestamp = Date.now(),
) {
  return sendDirectEventWithPermit(type, to, { payload, timestamp });
}

export async function sendCallEventFanout(
  type: CallPermitEventType,
  packets: Array<{ to: string; payload: string; timestamp?: number }>,
) {
  return sendDirectEventFanoutWithPermit(
    type,
    packets.map((packet) => ({
      to: packet.to,
      payload: {
        payload: packet.payload,
        timestamp: packet.timestamp ?? Date.now(),
      },
    })),
  );
}

/** Notify recipients about a new group they've been added to */
export function sendGroupInvite(
  groupId: string,
  groupName: string,
  members: { userId: string; role: string; joinedAt: number }[],
  recipients: string[],
  channels?: GroupChannel[],
  categories?: GroupCategory[],
  roles?: GroupRoleInfo[],
  theme?: Record<string, unknown>,
  moderation?: GroupModerationSettings,
) {
  const payload: Record<string, unknown> = {
    groupName,
    members,
  };

  if (Array.isArray(channels) && channels.length > 0) {
    payload.channels = channels.map((channel) => ({
      id: String(channel.id ?? '').trim(),
      name: String(channel.name ?? '').trim().slice(0, 64),
      type: channel.type,
      categoryId: channel.categoryId,
      position: channel.position,
      ...(channel.isNsfw ? { isNsfw: true } : {}),
      ...(typeof channel.userLimit === 'number' ? { userLimit: channel.userLimit } : {}),
    }));
  }

  if (Array.isArray(categories) && categories.length > 0) {
    payload.categories = categories.map((category) => ({
      id: String(category.id ?? '').trim(),
      name: String(category.name ?? '').trim().slice(0, 64),
      position: category.position,
      ...(category.collapsed ? { collapsed: true } : {}),
    }));
  }

  if (Array.isArray(roles) && roles.length > 0) {
    payload.roles = roles.map((role) => ({
      id: String(role.id ?? '').trim(),
      name: String(role.name ?? '').trim().slice(0, 64),
      color: role.color,
      position: role.position,
      permissions: role.permissions,
      ...(role.isDefault ? { isDefault: true } : {}),
    }));
  }

  if (theme && typeof theme === 'object') {
    payload.theme = theme;
  }

  if (moderation && typeof moderation === 'object') {
    payload.moderation = {
      enabled: !!moderation.enabled,
      blockedTerms: Array.isArray(moderation.blockedTerms)
        ? moderation.blockedTerms.map((term) => String(term ?? '').trim()).filter(Boolean)
        : [],
      mode: moderation.mode === 'warn' || moderation.mode === 'mask' ? moderation.mode : 'block',
      notifyMembers: moderation.notifyMembers !== false,
      exemptRoleIds: Array.isArray(moderation.exemptRoleIds)
        ? moderation.exemptRoleIds.map((roleId) => String(roleId ?? '').trim()).filter(Boolean)
        : [],
      ...(typeof moderation.updatedAt === 'number' ? { updatedAt: moderation.updatedAt } : {}),
      ...(typeof moderation.updatedBy === 'string' && moderation.updatedBy.trim()
        ? { updatedBy: moderation.updatedBy.trim() }
        : {}),
    };
  }

  return sendGroupEventWithPermit('group_invite', groupId, recipients, payload);
}

export async function sendGroupSettingsUpdate(
  groupId: string,
  recipients: string[],
  settings: Record<string, unknown>,
) {
  return sendGroupEventWithPermit('group_settings_update', groupId, recipients, {
    settings,
  });
}

/** Notify a user that they've been given or had a tag removed */
export async function sendTagUpdate(targetUserId: string, tagId: string, action: 'give' | 'remove') {
  return sendDirectEventWithPermit('tag_update', targetUserId, {
    targetUserId,
    tagId,
    action,
    timestamp: Date.now(),
  });
}
