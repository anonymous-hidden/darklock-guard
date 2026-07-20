/* ──────────────────────────────────────────────────────────
 *  Group channel conversation key helpers
 * ────────────────────────────────────────────────────────── */

export const GROUP_CHANNEL_KEY_SEPARATOR = '::channel::';

export function makeGroupChannelConversationId(groupId: string, channelId: string | null | undefined): string {
  const normalizedGroupId = String(groupId ?? '').trim();
  const normalizedChannelId = String(channelId ?? '').trim();

  if (!normalizedGroupId) return '';
  if (!normalizedChannelId || normalizedChannelId === normalizedGroupId) {
    return normalizedGroupId;
  }

  return `${normalizedGroupId}${GROUP_CHANNEL_KEY_SEPARATOR}${normalizedChannelId}`;
}

export function parseGroupChannelConversationId(conversationId: string): {
  groupId: string;
  channelId: string | null;
} {
  const normalized = String(conversationId ?? '').trim();
  if (!normalized) return { groupId: '', channelId: null };

  const splitIdx = normalized.indexOf(GROUP_CHANNEL_KEY_SEPARATOR);
  if (splitIdx < 0) {
    return { groupId: normalized, channelId: null };
  }

  const groupId = normalized.slice(0, splitIdx).trim();
  const channelId = normalized
    .slice(splitIdx + GROUP_CHANNEL_KEY_SEPARATOR.length)
    .trim();

  if (!groupId || !channelId) {
    return { groupId: normalized, channelId: null };
  }

  return { groupId, channelId };
}

export function isGroupChannelConversationId(conversationId: string): boolean {
  return parseGroupChannelConversationId(conversationId).channelId !== null;
}

export function belongsToGroupConversation(conversationId: string, groupId: string): boolean {
  const normalizedGroupId = String(groupId ?? '').trim();
  if (!normalizedGroupId) return false;

  const parsed = parseGroupChannelConversationId(conversationId);
  return parsed.groupId === normalizedGroupId;
}
