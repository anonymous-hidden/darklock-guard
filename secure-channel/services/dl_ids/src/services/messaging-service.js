/**
 * Messaging Service — business logic for channel messages.
 * Wraps DB operations and fires events to the event bus.
 */
import { randomUUID } from 'crypto';
import { eventBus } from '../core/event-bus.js';
import { broadcast } from '../sse.js';

/**
 * Create a new channel message.
 * @param {object} db - better-sqlite3 database
 * @param {{ serverId, channelId, authorId, content, type, replyToId, inviteCode }} opts
 * @returns {object} The created message row
 */
export function createMessage(db, { serverId, channelId, authorId, content, type, replyToId, inviteCode }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const finalType = inviteCode ? 'invite' : (type || 'text');
  const finalContent = finalType === 'invite' ? inviteCode : content.trim();

  db.prepare(`
    INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, serverId, channelId, authorId, finalContent, finalType, replyToId || null, now);

  const user = db.prepare('SELECT username, identity_pubkey FROM users WHERE id = ?').get(authorId);

  const message = {
    id,
    server_id: serverId,
    channel_id: channelId,
    author_id: authorId,
    author_username: user?.username ?? 'Unknown',
    content: finalContent,
    type: finalType,
    reply_to_id: replyToId || null,
    edited_at: null,
    deleted: 0,
    created_at: now,
  };

  // Fire event bus for real-time gateway
  eventBus.fire('message.created', { serverId, channelId, message });

  // Also broadcast via SSE for legacy clients
  broadcast(serverId, 'channel.message.created', {
    channel_id: channelId,
    message,
  }, authorId);

  return message;
}

/**
 * Edit an existing message.
 */
export function editMessage(db, { serverId, channelId, messageId, content, type }) {
  const now = new Date().toISOString();
  db.prepare('UPDATE channel_messages SET content = ?, type = ?, edited_at = ? WHERE id = ?')
    .run(content, type, now, messageId);

  const updated = db.prepare(`
    SELECT m.*, u.username as author_username
    FROM channel_messages m
    JOIN users u ON m.author_id = u.id
    WHERE m.id = ?
  `).get(messageId);

  eventBus.fire('message.edited', { serverId, channelId, messageId, message: updated });
  broadcast(serverId, 'channel.message.edited', { channel_id: channelId, message: updated });

  return updated;
}

/**
 * Soft-delete a message.
 */
export function deleteMessage(db, { serverId, channelId, messageId }) {
  db.prepare('UPDATE channel_messages SET deleted = 1 WHERE id = ?').run(messageId);

  eventBus.fire('message.deleted', { serverId, channelId, messageId });
  broadcast(serverId, 'channel.message.deleted', { channel_id: channelId, message_id: messageId });
}

/**
 * Get paginated messages for a channel.
 */
export function getMessages(db, { channelId, limit = 50, before }) {
  const safeLimit = Math.min(limit, 100);

  if (before) {
    return db.prepare(`
      SELECT m.*, u.username as author_username, u.identity_pubkey
      FROM channel_messages m
      JOIN users u ON m.author_id = u.id
      WHERE m.channel_id = ? AND m.deleted = 0 AND m.created_at < (
        SELECT created_at FROM channel_messages WHERE id = ? OR created_at < ?
      )
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(channelId, before, before, safeLimit).reverse();
  }

  return db.prepare(`
    SELECT m.*, u.username as author_username, u.identity_pubkey
    FROM channel_messages m
    JOIN users u ON m.author_id = u.id
    WHERE m.channel_id = ? AND m.deleted = 0
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(channelId, safeLimit).reverse();
}

/**
 * Update the read state for a user in a channel.
 */
export function upsertReadState(db, { userId, serverId, channelId, messageId }) {
  const readAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO channel_read_state (user_id, server_id, channel_id, last_read_message_id, last_read_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      last_read_at = excluded.last_read_at
  `).run(userId, serverId, channelId, messageId ?? null, readAt);

  // Fire read receipt event for real-time gateway
  eventBus.fire('read.receipt', { serverId, channelId, userId, lastReadMessageId: messageId });
}
