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

const router = Router();

// ── GET /servers/:id/channels/:channelId/messages ─────────────────────────────
router.get('/servers/:id/channels/:channelId/messages', (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Verify membership
    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member of this server' });

    // Verify channel belongs to server
    const channel = db.prepare('SELECT 1 FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

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
    const db = req.app.locals.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member of this server' });

    const channel = db.prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { content, type, reply_to_id } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO channel_messages (id, server_id, channel_id, author_id, content, type, reply_to_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, serverId, channelId, userId, content.trim(), type || 'text', reply_to_id || null, now);

    const user = db.prepare('SELECT username, identity_pubkey FROM users WHERE id = ?').get(userId);

    res.status(201).json({
      id,
      server_id: serverId,
      channel_id: channelId,
      author_id: userId,
      author_username: user?.username,
      content: content.trim(),
      type: type || 'text',
      reply_to_id: reply_to_id || null,
      edited_at: null,
      deleted: 0,
      created_at: now,
    });
  } catch (err) {
    console.error('[channel-messages] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /servers/:id/channels/:channelId/messages/:msgId ───────────────────
router.patch('/servers/:id/channels/:channelId/messages/:msgId', (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id: serverId, channelId, msgId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ? AND server_id = ?').get(msgId, channelId, serverId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.author_id !== userId) return res.status(403).json({ error: 'You can only edit your own messages' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

    const now = new Date().toISOString();
    db.prepare('UPDATE channel_messages SET content = ?, edited_at = ? WHERE id = ?').run(content.trim(), now, msgId);

    res.json({ ...msg, content: content.trim(), edited_at: now });
  } catch (err) {
    console.error('[channel-messages] PATCH error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /servers/:id/channels/:channelId/messages/:msgId ──────────────────
router.delete('/servers/:id/channels/:channelId/messages/:msgId', (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id: serverId, channelId, msgId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ? AND server_id = ?').get(msgId, channelId, serverId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    // Author can delete own messages, or check for manage_messages permission
    if (msg.author_id !== userId) {
      // Check permission (bit 4 = manage_messages in the permission system)
      const memberRoles = db.prepare(`
        SELECT r.permissions FROM roles r
        JOIN member_roles mr ON mr.role_id = r.id
        WHERE mr.user_id = ? AND r.server_id = ?
      `).all(userId, serverId);

      const hasPermission = memberRoles.some(r => (parseInt(r.permissions) & (1 << 4)) !== 0);
      const isOwner = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId)?.owner_id === userId;

      if (!hasPermission && !isOwner) {
        return res.status(403).json({ error: 'Missing permission: Manage Messages' });
      }
    }

    db.prepare('UPDATE channel_messages SET deleted = 1 WHERE id = ?').run(msgId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[channel-messages] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /servers/:id/channels/:channelId/pins ───────────────────────────────
router.post('/servers/:id/channels/:channelId/pins', (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    if (!member) return res.status(403).json({ error: 'Not a member' });

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
    const db = req.app.locals.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.user?.id;
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
    const db = req.app.locals.db;
    const { pinId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    db.prepare('DELETE FROM pinned_messages WHERE id = ?').run(pinId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[channel-messages] PIN DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
