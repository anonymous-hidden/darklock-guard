/**
 * IDS Server (guild) routes:
 *
 * POST   /servers                — create a server
 * GET    /servers                — list user's servers
 * GET    /servers/:id            — get server details
 * PATCH  /servers/:id            — update server (name, icon, description)
 * DELETE /servers/:id            — delete server (owner only)
 * POST   /servers/:id/members    — add member
 * DELETE /servers/:id/members/:uid — remove / kick member
 * GET    /servers/:id/members    — list members with roles
 * GET    /servers/:id/channels   — list channels
 * POST   /servers/:id/channels   — create channel
 * PATCH  /servers/:sid/channels/:cid — update channel
 * DELETE /servers/:sid/channels/:cid — delete channel
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import {
  Permissions,
  DEFAULT_PERMISSIONS,
  resolvePermissions,
  hasPermission,
  canManageUser,
} from '../permissions.js';
import { auditLog } from './audit.js';

export const serversRouter = Router();

// ── POST /servers — create ───────────────────────────────────────────────────
serversRouter.post('/', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const { name, icon, description } = req.body;    console.log('[IDS] POST /servers userId=%s name=%s', userId, name);
    if (!name || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Server name must be 1-100 characters', code: 'bad_request' });
    }

    const serverId = uuidv4();
    const now = new Date().toISOString();

    // Create server
    db.prepare(
      'INSERT INTO servers (id, name, owner_id, icon, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(serverId, name.trim(), userId, icon ?? null, description ?? null, now, now);

    // Create @everyone role (position 0)
    const everyoneRoleId = uuidv4();
    db.prepare(
      'INSERT INTO roles (id, server_id, name, color_hex, position, permissions, is_admin, show_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(everyoneRoleId, serverId, '@everyone', '#99aab5', 0, DEFAULT_PERMISSIONS.toString(), 0, 0, now);

    // Add owner as member
    const memberId = uuidv4();
    db.prepare(
      'INSERT INTO server_members (id, server_id, user_id, joined_at) VALUES (?, ?, ?, ?)'
    ).run(memberId, serverId, userId, now);

    // Create default #general channel
    const channelId = uuidv4();
    db.prepare(
      'INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(channelId, serverId, 'general', 'text', 0, now);

    auditLog(db, serverId, userId, 'SERVER_CREATE', 'server', serverId, { name: name.trim() });

    res.status(201).json({
      id: serverId,
      name: name.trim(),
      owner_id: userId,
      icon: icon ?? null,
      description: description ?? null,
      created_at: now,
      everyone_role_id: everyoneRoleId,
      default_channel_id: channelId,
    });
  } catch (err) {
    console.error('Create server error:', err);
    res.status(500).json({ error: 'Failed to create server', code: 'internal' });
  }
});

// ── GET /servers — list user's servers ───────────────────────────────────────
serversRouter.get('/', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;    console.log('[IDS] GET /servers userId=%s', userId);
    const servers = db.prepare(`
      SELECT s.*, COUNT(sm2.id) as member_count
      FROM servers s
      JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
      LEFT JOIN server_members sm2 ON sm2.server_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `).all(userId);

    console.log('[IDS] GET /servers userId=%s => %d servers', userId, servers.length);
    res.json({ servers });
  } catch (err) {
    console.error('List servers error:', err);
    res.status(500).json({ error: 'Failed to list servers', code: 'internal' });
  }
});

// ── GET /servers/:id ─────────────────────────────────────────────────────────
serversRouter.get('/:id', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] GET /servers/:id serverId=%s userId=%s', serverId, userId);
    // Server must exist first
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) {
      console.warn('[IDS] GET /servers/:id NOT FOUND serverId=%s', serverId);
      return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    }

    // Must be member
    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, userId);
    if (!membership) {
      console.warn('[IDS] GET /servers/:id FORBIDDEN userId=%s not member of serverId=%s', userId, serverId);
      return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
    }

    const memberCount = db.prepare(
      'SELECT COUNT(*) as count FROM server_members WHERE server_id = ?'
    ).get(serverId).count;

    res.json({ ...server, member_count: memberCount });
  } catch (err) {
    console.error('Get server error:', err);
    res.status(500).json({ error: 'Failed to get server', code: 'internal' });
  }
});

// ── PATCH /servers/:id ───────────────────────────────────────────────────────
serversRouter.patch('/:id', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] PATCH /servers/:id serverId=%s userId=%s body=%j', serverId, userId, req.body);
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const { name, icon, description, banner_color } = req.body;
    const changes = {};

    if (name !== undefined) {
      if (!name || name.trim().length < 1 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Server name must be 1-100 characters', code: 'bad_request' });
      }
      changes.name = name.trim();
    }
    if (icon !== undefined) changes.icon = icon;
    if (description !== undefined) changes.description = description;
    if (banner_color !== undefined) changes.banner_color = banner_color;

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: 'No changes provided', code: 'bad_request' });
    }

    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    const vals = Object.values(changes);

    db.prepare(`UPDATE servers SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...vals, serverId);

    auditLog(db, serverId, userId, 'SERVER_UPDATE', 'server', serverId, changes);

    const updated = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    res.json(updated);
  } catch (err) {
    console.error('Update server error:', err);
    res.status(500).json({ error: 'Failed to update server', code: 'internal' });
  }
});

// ── DELETE /servers/:id ──────────────────────────────────────────────────────
serversRouter.delete('/:id', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] DELETE /servers/:id serverId=%s userId=%s', serverId, userId);
    const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
    if (!server) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (server.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the owner can delete a server', code: 'forbidden' });
    }

    db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete server error:', err);
    res.status(500).json({ error: 'Failed to delete server', code: 'internal' });
  }
});

// ── GET /servers/:id/members ─────────────────────────────────────────────────
serversRouter.get('/:id/members', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] GET /servers/:id/members serverId=%s userId=%s', serverId, userId);
    // Server must exist first
    const serverExists = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId);
    if (!serverExists) {
      console.warn('[IDS] GET /servers/:id/members NOT FOUND serverId=%s', serverId);
      return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    }

    // Must be member
    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, userId);
    if (!membership) {
      console.warn('[IDS] GET /servers/:id/members FORBIDDEN userId=%s not member of serverId=%s', userId, serverId);
      return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
    }

    // Join with users and roles
    const members = db.prepare(`
      SELECT sm.user_id, sm.nickname, sm.joined_at,
             u.username, u.avatar, u.profile_color
      FROM server_members sm
      JOIN users u ON u.id = sm.user_id
      WHERE sm.server_id = ?
      ORDER BY sm.joined_at ASC
    `).all(serverId);

    // Get roles for each member
    const memberRoles = db.prepare(`
      SELECT mr.user_id, r.id as role_id, r.name, r.color_hex, r.position, r.is_admin, r.show_tag
      FROM member_roles mr
      JOIN roles r ON r.id = mr.role_id
      WHERE mr.server_id = ?
      ORDER BY r.position DESC
    `).all(serverId);

    const rolesByUser = {};
    for (const mr of memberRoles) {
      if (!rolesByUser[mr.user_id]) rolesByUser[mr.user_id] = [];
      rolesByUser[mr.user_id].push({
        id: mr.role_id,
        name: mr.name,
        color_hex: mr.color_hex,
        position: mr.position,
        is_admin: mr.is_admin,
        show_tag: mr.show_tag,
      });
    }

    const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);

    const result = members.map((m) => ({
      user_id: m.user_id,
      username: m.username,
      nickname: m.nickname,
      avatar: m.avatar,
      profile_color: m.profile_color,
      joined_at: m.joined_at,
      is_owner: server?.owner_id === m.user_id,
      roles: rolesByUser[m.user_id] ?? [],
    }));

    res.json({ members: result });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Failed to list members', code: 'internal' });
  }
});

// ── POST /servers/:id/members ────────────────────────────────────────────────
serversRouter.post('/:id/members', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;
    const { target_user_id } = req.body;    console.log('[IDS] POST /servers/:id/members serverId=%s userId=%s target=%s', serverId, userId, target_user_id);
    if (!target_user_id) {
      return res.status(400).json({ error: 'target_user_id required', code: 'bad_request' });
    }

    // Check inviter has CREATE_INVITES permission
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.CREATE_INVITES)) {
      return res.status(403).json({ error: 'Missing CREATE_INVITES permission', code: 'forbidden' });
    }

    // Check user exists
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(target_user_id);
    if (!targetUser) return res.status(404).json({ error: 'User not found', code: 'not_found' });

    // Check not already member
    const existing = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, target_user_id);
    if (existing) return res.status(409).json({ error: 'Already a member', code: 'conflict' });

    const memberId = uuidv4();
    db.prepare(
      'INSERT INTO server_members (id, server_id, user_id, joined_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).run(memberId, serverId, target_user_id);

    auditLog(db, serverId, userId, 'MEMBER_ADD', 'user', target_user_id, null);

    res.status(201).json({ id: memberId, server_id: serverId, user_id: target_user_id });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member', code: 'internal' });
  }
});

// ── DELETE /servers/:id/members/:uid — kick member ───────────────────────────
serversRouter.delete('/:id/members/:uid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const targetUserId = req.params.uid;
    const userId = req.userId;    console.log('[IDS] DELETE /servers/:id/members/:uid serverId=%s userId=%s targetUserId=%s', serverId, userId, targetUserId);
    // Self-leave is always allowed
    if (targetUserId === userId) {
      const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
      if (server?.owner_id === userId) {
        return res.status(400).json({ error: 'Owner cannot leave. Transfer or delete the server.', code: 'bad_request' });
      }
      db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, targetUserId);
      db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(serverId, targetUserId);
      return res.json({ removed: true });
    }

    // Otherwise: kick — requires permission + hierarchy
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.KICK_MEMBERS)) {
      return res.status(403).json({ error: 'Missing KICK_MEMBERS permission', code: 'forbidden' });
    }
    if (!canManageUser({ actorId: userId, targetId: targetUserId, serverId, db })) {
      return res.status(403).json({ error: 'Cannot kick a user with higher or equal role', code: 'forbidden' });
    }

    db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, targetUserId);
    db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(serverId, targetUserId);

    auditLog(db, serverId, userId, 'MEMBER_KICK', 'user', targetUserId, null, req.body.reason);

    res.json({ removed: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member', code: 'internal' });
  }
});

// ── GET /servers/:id/channels ────────────────────────────────────────────────
serversRouter.get('/:id/channels', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] GET /servers/:id/channels serverId=%s userId=%s', serverId, userId);
    // Server must exist first
    const serverExists = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId);
    if (!serverExists) {
      console.warn('[IDS] GET /servers/:id/channels NOT FOUND serverId=%s', serverId);
      return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    }

    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, userId);
    if (!membership) {
      console.warn('[IDS] GET /servers/:id/channels FORBIDDEN userId=%s not member of serverId=%s', userId, serverId);
      return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
    }

    const channels = db.prepare(
      'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC'
    ).all(serverId);

    // Filter channels user can see
    const visible = channels.filter((ch) => {
      const { permissions: perms } = resolvePermissions({ userId, serverId, channelId: ch.id, db });
      return hasPermission(perms, Permissions.VIEW_CHANNEL);
    });

    res.json({ channels: visible });
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ error: 'Failed to list channels', code: 'internal' });
  }
});

// ── POST /servers/:id/channels ───────────────────────────────────────────────
serversRouter.post('/:id/channels', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;    console.log('[IDS] POST /servers/:id/channels serverId=%s userId=%s body=%j', serverId, userId, req.body);
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission', code: 'forbidden' });
    }

    const { name, topic, type } = req.body;
    if (!name || name.trim().length < 1 || name.trim().length > 50) {
      return res.status(400).json({ error: 'Channel name must be 1-50 characters', code: 'bad_request' });
    }

    const VALID_TYPES = ['text', 'voice', 'announcement', 'rules'];
    const channelType = VALID_TYPES.includes(type) ? type : 'text';
    const maxPos = db.prepare('SELECT MAX(position) as mp FROM channels WHERE server_id = ?').get(serverId);
    const position = (maxPos?.mp ?? -1) + 1;

    const channelId = uuidv4();
    db.prepare(
      "INSERT INTO channels (id, server_id, name, topic, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(channelId, serverId, name.trim().toLowerCase().replace(/\s+/g, '-'), topic ?? null, channelType, position);

    auditLog(db, serverId, userId, 'CHANNEL_CREATE', 'channel', channelId, { name: name.trim() });

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    res.status(201).json(channel);
  } catch (err) {
    console.error('Create channel error:', err);
    res.status(500).json({ error: 'Failed to create channel', code: 'internal' });
  }
});

// ── PATCH /servers/:sid/channels/:cid ────────────────────────────────────────
serversRouter.patch('/:sid/channels/:cid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, cid: channelId } = req.params;
    const userId = req.userId;    console.log('[IDS] PATCH /servers/:sid/channels/:cid serverId=%s channelId=%s userId=%s body=%j', serverId, channelId, userId, req.body);
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission', code: 'forbidden' });
    }

    const { name, topic, position } = req.body;
    const changes = {};
    if (name !== undefined) changes.name = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (topic !== undefined) changes.topic = topic;
    if (position !== undefined) changes.position = position;

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: 'No changes', code: 'bad_request' });
    }

    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE channels SET ${sets} WHERE id = ? AND server_id = ?`).run(
      ...Object.values(changes), channelId, serverId
    );

    auditLog(db, serverId, userId, 'CHANNEL_UPDATE', 'channel', channelId, changes);

    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    res.json(updated);
  } catch (err) {
    console.error('Update channel error:', err);
    res.status(500).json({ error: 'Failed to update channel', code: 'internal' });
  }
});

// ── DELETE /servers/:sid/channels/:cid ───────────────────────────────────────
serversRouter.delete('/:sid/channels/:cid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, cid: channelId } = req.params;
    const userId = req.userId;    console.log('[IDS] DELETE /servers/:sid/channels/:cid serverId=%s channelId=%s userId=%s', serverId, channelId, userId);
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission', code: 'forbidden' });
    }

    // Don't allow deleting the last channel
    const count = db.prepare('SELECT COUNT(*) as c FROM channels WHERE server_id = ?').get(serverId);
    if (count.c <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last channel', code: 'bad_request' });
    }

    const channel = db.prepare('SELECT name FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    db.prepare('DELETE FROM channels WHERE id = ? AND server_id = ?').run(channelId, serverId);

    auditLog(db, serverId, userId, 'CHANNEL_DELETE', 'channel', channelId, { name: channel?.name });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete channel error:', err);
    res.status(500).json({ error: 'Failed to delete channel', code: 'internal' });
  }
});
