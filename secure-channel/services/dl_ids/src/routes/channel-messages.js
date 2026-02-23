/**
 * Channel Messages routes — CRUD for server text-channel messages.
 *
 * GET    /servers/:id/channels/:channelId/messages        — list messages (paginated)
 * POST   /servers/:id/channels/:channelId/messages        — send a message
 * PATCH  /servers/:id/channels/:channelId/messages/:msgId — edit a message
 * DELETE /servers/:id/channels/:channelId/messages/:msgId — delete a message
 * POST   /servers/:id/channels/:channelId/pins            — pin a message
 * GET    /servers/:id/channels/:channelId/pins            — get pinned messages
 * DELETE /servers/:id/channels/:channelId/pins/:pinId     — unpin a message
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  Permissions,
  resolvePermissions,
  hasPermission,
} from '../permissions.js';
import {
  canUserAccessChannel,
  logSecureAudit,
} from '../channel-rbac-engine.js';
import {
  checkSecureChannelAccess,
} from '../security-channel-rules.js';
import { eventBus } from '../core/event-bus.js';
import { broadcast } from '../sse.js';

const router = Router();
router.use(requireAuth); // all channel message routes require authentication

const INVITE_URL_RE = /(?:darklock:\/\/invite\/|https?:\/\/(?:www\.)?darklock\.(?:net|app)\/invite\/)([A-Za-z0-9_-]+)/i;
const USER_MENTION_RE = /<@([a-zA-Z0-9_-]+)>/g;
const ROLE_MENTION_RE = /<@&([a-zA-Z0-9_-]+)>/g;

function extractInviteCode(content) {
  const m = String(content || '').match(INVITE_URL_RE);
  return m ? m[1] : null;
}

function parseMentions(content) {
  const text = String(content || '');
  const userIds = new Set();
  const roleIds = new Set();
  let match;
  USER_MENTION_RE.lastIndex = 0;
  ROLE_MENTION_RE.lastIndex = 0;
  while ((match = USER_MENTION_RE.exec(text)) !== null) userIds.add(match[1]);
  while ((match = ROLE_MENTION_RE.exec(text)) !== null) roleIds.add(match[1]);
  return {
    userIds: [...userIds],
    roleIds: [...roleIds],
    mentionEveryone: /(^|\s)@everyone(\s|$)/.test(text),
    mentionHere: /(^|\s)@here(\s|$)/.test(text),
  };
}

function upsertReadState(db, { userId, serverId, channelId, messageId, readAt }) {
  db.prepare(`
    INSERT INTO channel_read_state (user_id, server_id, channel_id, last_read_message_id, last_read_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      last_read_at = excluded.last_read_at
  `).run(userId, serverId, channelId, messageId ?? null, readAt ?? new Date().toISOString());
}

function queueMentionNotifications(db, { serverId, channelId, messageId, authorId, mentions }) {
  const insertMention = db.prepare(`
    INSERT INTO message_mentions (id, message_id, server_id, channel_id, mention_type, mentioned_user_id, mentioned_role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNotif = db.prepare(`
    INSERT OR IGNORE INTO mention_notifications (id, user_id, server_id, channel_id, message_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const userTargets = new Set(mentions.userIds);

  if (mentions.roleIds.length > 0) {
    for (const roleId of mentions.roleIds) {
      insertMention.run(randomUUID(), messageId, serverId, channelId, 'role', null, roleId);
      const roleMembers = db.prepare(`
        SELECT mr.user_id
        FROM member_roles mr
        WHERE mr.server_id = ? AND mr.role_id = ?
      `).all(serverId, roleId);
      for (const rm of roleMembers) userTargets.add(rm.user_id);
    }
  }

  if (mentions.mentionEveryone || mentions.mentionHere) {
    const mentionType = mentions.mentionEveryone ? 'everyone' : 'here';
    insertMention.run(randomUUID(), messageId, serverId, channelId, mentionType, null, null);
    const allMembers = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId);
    for (const m of allMembers) userTargets.add(m.user_id);
  }

  for (const userId of mentions.userIds) {
    insertMention.run(randomUUID(), messageId, serverId, channelId, 'user', userId, null);
  }

  for (const userId of userTargets) {
    if (!userId || userId === authorId) continue;
    insertNotif.run(randomUUID(), userId, serverId, channelId, messageId);
  }
}

// ── GET /servers/:id/channels/:channelId/messages ─────────────────────────────
router.get('/servers/:id/channels/:channelId/messages', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Verify membership
    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member of this server' });

    // Verify channel belongs to server
    const channel = db.prepare('SELECT 1 FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // ── RBAC: Check VIEW_CHANNEL permission (fixes gap where any member could read) ──
    const viewResult = canUserAccessChannel({ userId, serverId, channelId, permissionKey: 'channel.view', db });
    if (!viewResult.allowed) {
      return res.status(403).json({ error: 'Missing VIEW_CHANNEL permission', code: 'forbidden', reason: viewResult.reason });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // cursor: message ID or ISO timestamp

    let rows;
    if (before) {
      rows = db.prepare(`
        SELECT m.*, u.username as author_username, u.identity_pubkey
        FROM channel_messages m
        JOIN users u ON m.author_id = u.id
        WHERE m.channel_id = ? AND m.deleted = 0 AND m.created_at < (
          SELECT created_at FROM channel_messages WHERE id = ? OR created_at < ?
        )
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(channelId, before, before, limit);
    } else {
      rows = db.prepare(`
        SELECT m.*, u.username as author_username, u.identity_pubkey
        FROM channel_messages m
        JOIN users u ON m.author_id = u.id
        WHERE m.channel_id = ? AND m.deleted = 0
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(channelId, limit);
    }

    // Return oldest-first
    res.json(rows.reverse());
  } catch (err) {
    console.error('[channel-messages] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /servers/:id/channels/:channelId/messages ────────────────────────────
router.post('/servers/:id/channels/:channelId/messages', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member of this server' });

    const channel = db.prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // ── Secure channel + RBAC: check SEND_MESSAGES with security rules ──
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
    const sendResult = checkSecureChannelAccess({
      userId, serverId, channelId,
      permissionKey: 'channel.send',
      action: 'send_message',
      db, ip,
    });
    if (!sendResult.allowed) {
      return res.status(403).json({ error: 'Missing SEND_MESSAGES permission', code: 'forbidden', reason: sendResult.reason });
    }

    const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });

    const { content, type, reply_to_id } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

    const inviteCode = extractInviteCode(content);
    const mentions = parseMentions(content);
    if ((mentions.mentionEveryone || mentions.mentionHere) && !hasPermission(perms, Permissions.MENTION_EVERYONE)) {
      return res.status(403).json({ error: 'Missing MENTION_EVERYONE permission', code: 'forbidden' });
    }

    // If role mention is present, require either mention-everyone bit or manage-roles.
    if (mentions.roleIds.length > 0 && !hasPermission(perms, Permissions.MENTION_EVERYONE) && !hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing permission to mention roles', code: 'forbidden' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const finalType = inviteCode ? 'invite' : (type || 'text');
    const finalContent = finalType === 'invite' ? inviteCode : content.trim();

    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, reply_to_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, serverId, channelId, userId, finalContent, finalType, reply_to_id || null, now);

    queueMentionNotifications(db, {
      serverId,
      channelId,
      messageId: id,
      authorId: userId,
      mentions,
    });
    upsertReadState(db, { userId, serverId, channelId, messageId: id, readAt: now });

    const user = db.prepare('SELECT username, identity_pubkey FROM users WHERE id = ?').get(userId);

    const message = {
      id,
      server_id: serverId,
      channel_id: channelId,
      author_id: userId,
      author_username: user?.username,
      content: finalContent,
      type: finalType,
      reply_to_id: reply_to_id || null,
      edited_at: null,
      deleted: 0,
      created_at: now,
    };

    // Fire event bus for real-time WS gateway delivery
    eventBus.fire('message.created', { serverId, channelId, message });
    broadcast(serverId, 'channel.message.created', { channel_id: channelId, message }, userId);

    res.status(201).json(message);
  } catch (err) {
    console.error('[channel-messages] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /servers/:id/channels/:channelId/messages/:msgId ───────────────────
router.patch('/servers/:id/channels/:channelId/messages/:msgId', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId, msgId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ? AND server_id = ?').get(msgId, channelId, serverId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.author_id !== userId) return res.status(403).json({ error: 'You can only edit your own messages' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

    const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });
    const now = new Date().toISOString();
    const inviteCode = extractInviteCode(content);
    const finalType = inviteCode ? 'invite' : msg.type;
    const finalContent = inviteCode ? inviteCode : content.trim();
    const mentions = parseMentions(content);
    if ((mentions.mentionEveryone || mentions.mentionHere) && !hasPermission(perms, Permissions.MENTION_EVERYONE)) {
      return res.status(403).json({ error: 'Missing MENTION_EVERYONE permission', code: 'forbidden' });
    }
    if (mentions.roleIds.length > 0 && !hasPermission(perms, Permissions.MENTION_EVERYONE) && !hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing permission to mention roles', code: 'forbidden' });
    }

    db.prepare('UPDATE channel_messages SET content = ?, type = ?, edited_at = ? WHERE id = ?')
      .run(finalContent, finalType, now, msgId);

    db.prepare('DELETE FROM message_mentions WHERE message_id = ?').run(msgId);
    db.prepare('DELETE FROM mention_notifications WHERE message_id = ?').run(msgId);
    queueMentionNotifications(db, {
      serverId,
      channelId,
      messageId: msgId,
      authorId: userId,
      mentions,
    });

    res.json({ ...msg, content: finalContent, type: finalType, edited_at: now });

    // Fire event bus for real-time WS gateway delivery
    eventBus.fire('message.edited', { serverId, channelId, messageId: msgId, message: { ...msg, content: finalContent, type: finalType, edited_at: now } });
    broadcast(serverId, 'channel.message.edited', { channel_id: channelId, message: { ...msg, content: finalContent, type: finalType, edited_at: now } });
  } catch (err) {
    console.error('[channel-messages] PATCH error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /servers/:id/channels/:channelId/messages/:msgId ──────────────────
router.delete('/servers/:id/channels/:channelId/messages/:msgId', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId, msgId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ? AND server_id = ?').get(msgId, channelId, serverId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    // Author can delete own messages, or check for manage_messages permission
    if (msg.author_id !== userId) {
      // ── Secure channel + RBAC: check DELETE_MESSAGES with security rules ──
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      const delResult = checkSecureChannelAccess({
        userId, serverId, channelId,
        permissionKey: 'channel.delete_messages',
        action: 'delete_message',
        db, ip,
        extra: { isOwnMessage: false },
      });
      if (!delResult.allowed) {
        return res.status(403).json({ error: 'Missing permission: Manage Messages', code: 'forbidden', reason: delResult.reason });
      }
    }

    db.prepare('UPDATE channel_messages SET deleted = 1 WHERE id = ?').run(msgId);

    // Fire event bus for real-time WS gateway delivery
    eventBus.fire('message.deleted', { serverId, channelId, messageId: msgId });
    broadcast(serverId, 'channel.message.deleted', { channel_id: channelId, message_id: msgId });

    res.json({ ok: true });
  } catch (err) {
    console.error('[channel-messages] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /servers/:id/channels/:channelId/pins ───────────────────────────────
router.post('/servers/:id/channels/:channelId/pins', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });
    const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });
    if (!hasPermission(perms, Permissions.MANAGE_MESSAGES)) {
      return res.status(403).json({ error: 'Missing MANAGE_MESSAGES permission', code: 'forbidden' });
    }

    const { message_id, content_preview } = req.body;
    if (!message_id) return res.status(400).json({ error: 'message_id is required' });

    const id = randomUUID();
    db.prepare(`
      INSERT OR IGNORE INTO pinned_messages (id, dm_id, message_id, pinned_by)
      VALUES (?, ?, ?, ?)
    `).run(id, `${serverId}:${channelId}`, message_id, userId);

    res.status(201).json({
      id,
      session_id: `${serverId}:${channelId}`,
      message_id,
      pinned_by: userId,
      content_preview: content_preview || '',
      pinned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[channel-messages] PIN POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /servers/:id/channels/:channelId/pins ────────────────────────────────
router.get('/servers/:id/channels/:channelId/pins', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const dmId = `${serverId}:${channelId}`;
    const pins = db.prepare('SELECT * FROM pinned_messages WHERE dm_id = ? ORDER BY pinned_at DESC').all(dmId);
    res.json(pins.map(p => ({
      id: p.id,
      session_id: p.dm_id,
      message_id: p.message_id,
      pinned_by: p.pinned_by,
      content_preview: '',
      pinned_at: p.pinned_at,
    })));
  } catch (err) {
    console.error('[channel-messages] PIN GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /servers/:id/channels/:channelId/pins/:pinId ──────────────────────
router.delete('/servers/:id/channels/:channelId/pins/:pinId', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId, pinId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });
    const { permissions: perms } = resolvePermissions({ userId, serverId, channelId, db });
    if (!hasPermission(perms, Permissions.MANAGE_MESSAGES)) {
      return res.status(403).json({ error: 'Missing MANAGE_MESSAGES permission', code: 'forbidden' });
    }

    db.prepare('DELETE FROM pinned_messages WHERE id = ?').run(pinId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[channel-messages] PIN DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /servers/:id/channels/:channelId/read ───────────────────────────────
router.put('/servers/:id/channels/:channelId/read', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });
    const channel = db.prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { last_read_message_id, last_read_at } = req.body ?? {};
    const readAt = typeof last_read_at === 'string' ? last_read_at : new Date().toISOString();
    upsertReadState(db, {
      userId,
      serverId,
      channelId,
      messageId: last_read_message_id ?? null,
      readAt,
    });

    db.prepare(`
      UPDATE mention_notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE user_id = ? AND server_id = ? AND channel_id = ? AND read_at IS NULL
    `).run(readAt, userId, serverId, channelId);

    res.json({ ok: true, last_read_at: readAt, last_read_message_id: last_read_message_id ?? null });
  } catch (err) {
    console.error('[channel-messages] READ PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /servers/:id/unread ─────────────────────────────────────────────────
router.get('/servers/:id/unread', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId } = req.params;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const channels = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(serverId);
    const unread = {};
    let serverHasUnread = false;
    let serverMentionCount = 0;
    for (const ch of channels) {
      const readState = db.prepare(`
        SELECT last_read_at, last_read_message_id
        FROM channel_read_state
        WHERE user_id = ? AND server_id = ? AND channel_id = ?
      `).get(userId, serverId, ch.id);

      const unreadCount = db.prepare(`
        SELECT COUNT(*) AS c
        FROM channel_messages
        WHERE channel_id = ? AND deleted = 0 AND author_id != ?
          AND created_at > COALESCE(?, '1970-01-01T00:00:00.000Z')
      `).get(ch.id, userId, readState?.last_read_at ?? null).c ?? 0;

      const mentionCount = db.prepare(`
        SELECT COUNT(*) AS c
        FROM mention_notifications
        WHERE user_id = ? AND server_id = ? AND channel_id = ? AND read_at IS NULL
      `).get(userId, serverId, ch.id).c ?? 0;

      if (unreadCount > 0) serverHasUnread = true;
      serverMentionCount += mentionCount;

      unread[ch.id] = {
        unread_count: unreadCount,
        mention_count: mentionCount,
        last_read_at: readState?.last_read_at ?? null,
        last_read_message_id: readState?.last_read_message_id ?? null,
      };
    }

    res.json({
      server_id: serverId,
      has_unread: serverHasUnread,
      mention_count: serverMentionCount,
      channels: unread,
    });
  } catch (err) {
    console.error('[channel-messages] UNREAD GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /users/me/mentions ──────────────────────────────────────────────────
router.get('/users/me/mentions', (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const rows = db.prepare(`
      SELECT mn.*, cm.content, cm.type, cm.author_id, cm.created_at as message_created_at, u.username as author_username
      FROM mention_notifications mn
      JOIN channel_messages cm ON cm.id = mn.message_id
      JOIN users u ON u.id = cm.author_id
      WHERE mn.user_id = ?
      ORDER BY mn.created_at DESC
      LIMIT ?
    `).all(userId, limit);
    res.json({ mentions: rows });
  } catch (err) {
    console.error('[channel-messages] mentions list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /users/me/mentions/read ───────────────────────────────────────────
router.patch('/users/me/mentions/read', (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { notification_ids, all } = req.body ?? {};
    const now = new Date().toISOString();

    if (all) {
      db.prepare('UPDATE mention_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
      return res.json({ ok: true, read_at: now, updated: 'all' });
    }

    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return res.status(400).json({ error: 'notification_ids array required' });
    }

    const stmt = db.prepare('UPDATE mention_notifications SET read_at = ? WHERE id = ? AND user_id = ?');
    const tx = db.transaction(() => {
      for (const id of notification_ids) stmt.run(now, id, userId);
    });
    tx();
    res.json({ ok: true, read_at: now, updated: notification_ids.length });
  } catch (err) {
    console.error('[channel-messages] mentions read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
