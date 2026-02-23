/**
 * IDS Role routes:
 *
 * GET    /servers/:sid/roles                — list roles
 * POST   /servers/:sid/roles                — create role
 * PATCH  /servers/:sid/roles/:rid           — update role
 * DELETE /servers/:sid/roles/:rid           — delete role
 * PUT    /servers/:sid/roles/reorder        — reorder roles
 * POST   /servers/:sid/members/:uid/roles   — assign role to member
 * DELETE /servers/:sid/members/:uid/roles/:rid — remove role from member
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import {
  Permissions,
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  resolvePermissions,
  hasPermission,
  getHighestRolePosition,
} from '../permissions.js';
import { auditLog } from './audit.js';
import { broadcast } from '../sse.js';

export const rolesRouter = Router();

const MAX_BADGE_BYTES = 512 * 1024; // 512 KB
const ALLOWED_BADGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function validateBadgeImageDataUrl(dataUrl) {
  if (dataUrl == null) return { ok: true };
  if (typeof dataUrl !== 'string') return { ok: false, error: 'badge_image_url must be a data URL string or null' };
  const m = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'Invalid badge image encoding' };
  const mime = m[1].toLowerCase();
  if (!ALLOWED_BADGE_MIME.has(mime)) return { ok: false, error: 'Unsupported badge image type' };
  const bytes = Buffer.from(m[2], 'base64').byteLength;
  if (bytes > MAX_BADGE_BYTES) return { ok: false, error: 'Badge image too large (max 512KB)' };
  return { ok: true };
}

// ── GET /servers/:sid/roles ──────────────────────────────────────────────────
rolesRouter.get('/:sid/roles', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.sid;
    const userId = req.userId;
    console.log('[IDS] GET /servers/:sid/roles serverId=%s userId=%s', serverId, userId);

    // Must be member
    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, userId);
    if (!membership) {
      console.warn('[IDS] GET /servers/:sid/roles FORBIDDEN userId=%s not member of serverId=%s', userId, serverId);
      return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
    }

    const roles = db.prepare(
      'SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC'
    ).all(serverId);

    // Add member count per role
    const roleCounts = db.prepare(`
      SELECT role_id, COUNT(*) as count FROM member_roles WHERE server_id = ? GROUP BY role_id
    `).all(serverId);
    const countMap = Object.fromEntries(roleCounts.map((r) => [r.role_id, r.count]));

    // @everyone count = all members
    const totalMembers = db.prepare(
      'SELECT COUNT(*) as count FROM server_members WHERE server_id = ?'
    ).get(serverId).count;

    const result = roles.map((r) => ({
      ...r,
      is_admin: !!r.is_admin,
      show_tag: !!r.show_tag,
      hoist: !!r.hoist,
      separate_members: !!r.separate_members,
      badge_image_url: r.badge_image_url ?? null,
      member_count: r.position === 0 ? totalMembers : (countMap[r.id] ?? 0),
    }));

    res.json({ roles: result });
  } catch (err) {
    console.error('List roles error:', err);
    res.status(500).json({ error: 'Failed to list roles', code: 'internal' });
  }
});

// ── POST /servers/:sid/roles — create ────────────────────────────────────────
rolesRouter.post('/:sid/roles', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.sid;
    const userId = req.userId;

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const { name, color_hex, permissions: rolePerms, is_admin, show_tag, hoist, tag_style, separate_members, badge_image_url } = req.body;
    if (!name || name.trim().length < 1 || name.trim().length > 50) {
      return res.status(400).json({ error: 'Role name must be 1-50 characters', code: 'bad_request' });
    }
    const badgeValidation = validateBadgeImageDataUrl(badge_image_url);
    if (!badgeValidation.ok) {
      return res.status(400).json({ error: badgeValidation.error, code: 'bad_request' });
    }

    // Cannot create admin role unless you're owner
    if (is_admin && !isOwner) {
      return res.status(403).json({ error: 'Only the owner can create admin roles', code: 'forbidden' });
    }

    // Get highest current position and place new role above @everyone
    const maxPos = db.prepare(
      'SELECT MAX(position) as mp FROM roles WHERE server_id = ?'
    ).get(serverId);
    const position = (maxPos?.mp ?? 0) + 1;

    // Actor's highest position
    const actorPos = getHighestRolePosition({ userId, serverId, db });
    // Non-owner can only create roles below their own highest position
    if (!isOwner && position >= actorPos) {
      // Place it just below actor
      // Actually for creation, the new role goes right below the creator's highest role
    }

    const roleId = uuidv4();

    // `permissions` may arrive as `null` from some clients (e.g., Rust Option serialized
    // via serde_json), so treat null/undefined as "not provided".
    let finalPerms = '0';
    if (rolePerms != null) {
      try {
        finalPerms = BigInt(rolePerms).toString();
      } catch {
        return res.status(400).json({ error: 'Invalid permissions bitfield', code: 'bad_request' });
      }
    }

    db.prepare(
      "INSERT INTO roles (id, server_id, name, color_hex, position, permissions, is_admin, show_tag, hoist, tag_style, separate_members, badge_image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(
      roleId, serverId, name.trim(),
      color_hex ?? '#99aab5',
      position,
      finalPerms,
      is_admin ? 1 : 0,
      show_tag !== false ? 1 : 0,
      hoist ? 1 : 0,
      tag_style ?? 'dot',
      separate_members ? 1 : 0,
      badge_image_url ?? null,
    );

    auditLog(db, serverId, userId, 'ROLE_CREATE', 'role', roleId, { name: name.trim() });

    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
    const roleJson = { ...role, is_admin: !!role.is_admin, show_tag: !!role.show_tag, hoist: !!role.hoist, separate_members: !!role.separate_members, badge_image_url: role.badge_image_url ?? null };
    try {
      broadcast(serverId, 'role.created', roleJson);
    } catch (err) {
      console.warn('[IDS] role.created broadcast failed:', err);
    }
    res.status(201).json(roleJson);
  } catch (err) {
    console.error('Create role error:', err);
    res.status(500).json({ error: 'Failed to create role', code: 'internal' });
  }
});

// ── PATCH /servers/:sid/roles/:rid ───────────────────────────────────────────
rolesRouter.patch('/:sid/roles/:rid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, rid: roleId } = req.params;
    const userId = req.userId;

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(roleId, serverId);
    if (!role) return res.status(404).json({ error: 'Role not found', code: 'not_found' });

    // Cannot edit roles at or above your position (unless owner)
    if (!isOwner) {
      const actorPos = getHighestRolePosition({ userId, serverId, db });
      if (role.position >= actorPos) {
        return res.status(403).json({ error: 'Cannot edit a role at or above your position', code: 'forbidden' });
      }
    }

    const { name, color_hex, permissions: rolePerms, is_admin, show_tag, hoist, tag_style, separate_members, badge_image_url } = req.body;
    const changes = {};

    // Cannot promote to admin unless owner
    if (is_admin !== undefined) {
      if (is_admin && !isOwner) {
        return res.status(403).json({ error: 'Only the owner can grant admin', code: 'forbidden' });
      }
      changes.is_admin = is_admin ? 1 : 0;
    }

    if (name !== undefined) changes.name = name.trim();
    if (color_hex !== undefined) changes.color_hex = color_hex;
    if (rolePerms !== undefined) changes.permissions = BigInt(rolePerms).toString();
    if (show_tag !== undefined) changes.show_tag = show_tag ? 1 : 0;
    if (hoist !== undefined) changes.hoist = hoist ? 1 : 0;
    if (tag_style !== undefined) changes.tag_style = tag_style;
    if (separate_members !== undefined) changes.separate_members = separate_members ? 1 : 0;
    if (badge_image_url !== undefined) {
      const badgeValidation = validateBadgeImageDataUrl(badge_image_url);
      if (!badgeValidation.ok) return res.status(400).json({ error: badgeValidation.error, code: 'bad_request' });
      changes.badge_image_url = badge_image_url ?? null;
    }

    // Don't allow renaming @everyone
    if (role.position === 0 && changes.name && changes.name !== '@everyone') {
      return res.status(400).json({ error: 'Cannot rename @everyone', code: 'bad_request' });
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: 'No changes', code: 'bad_request' });
    }

    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE roles SET ${sets} WHERE id = ?`).run(...Object.values(changes), roleId);

    auditLog(db, serverId, userId, 'ROLE_UPDATE', 'role', roleId, changes);

    const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
    const updatedJson = { ...updated, is_admin: !!updated.is_admin, show_tag: !!updated.show_tag, hoist: !!updated.hoist, separate_members: !!updated.separate_members, badge_image_url: updated.badge_image_url ?? null };
    broadcast(serverId, 'role.updated', updatedJson);
    res.json(updatedJson);
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role', code: 'internal' });
  }
});

// ── DELETE /servers/:sid/roles/:rid ──────────────────────────────────────────
rolesRouter.delete('/:sid/roles/:rid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, rid: roleId } = req.params;
    const userId = req.userId;

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(roleId, serverId);
    if (!role) return res.status(404).json({ error: 'Role not found', code: 'not_found' });

    // Cannot delete @everyone
    if (role.position === 0) {
      return res.status(400).json({ error: 'Cannot delete @everyone role', code: 'bad_request' });
    }

    // Cannot delete roles at or above your position
    if (!isOwner) {
      const actorPos = getHighestRolePosition({ userId, serverId, db });
      if (role.position >= actorPos) {
        return res.status(403).json({ error: 'Cannot delete a role at or above your position', code: 'forbidden' });
      }
    }

    // Remove all member_roles references first
    db.prepare('DELETE FROM member_roles WHERE role_id = ?').run(roleId);
    db.prepare('DELETE FROM channel_permission_overrides WHERE role_id = ?').run(roleId);
    db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);

    auditLog(db, serverId, userId, 'ROLE_DELETE', 'role', roleId, { name: role.name });
    broadcast(serverId, 'role.deleted', { id: roleId, name: role.name });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ error: 'Failed to delete role', code: 'internal' });
  }
});

// ── PUT /servers/:sid/roles/reorder ──────────────────────────────────────────
rolesRouter.put('/:sid/roles/reorder', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.sid;
    const userId = req.userId;

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const { role_ids } = req.body; // ordered array of role IDs, position 0 = lowest
    if (!Array.isArray(role_ids)) {
      return res.status(400).json({ error: 'role_ids must be an array', code: 'bad_request' });
    }

    const actorPos = isOwner ? Infinity : getHighestRolePosition({ userId, serverId, db });

    const updatePos = db.prepare('UPDATE roles SET position = ? WHERE id = ? AND server_id = ?');
    const txn = db.transaction(() => {
      for (let i = 0; i < role_ids.length; i++) {
        const rid = role_ids[i];
        const role = db.prepare('SELECT position FROM roles WHERE id = ? AND server_id = ?').get(rid, serverId);
        if (!role) continue;
        // @everyone always stays at 0
        if (role.position === 0) continue;
        // Cannot reorder roles at or above your position (unless owner)
        if (!isOwner && role.position >= actorPos) continue;
        updatePos.run(i + 1, rid, serverId); // +1 because 0 is reserved for @everyone
      }
    });
    txn();

    auditLog(db, serverId, userId, 'ROLES_REORDER', 'server', serverId, { role_ids });
    broadcast(serverId, 'role.reordered', { role_ids });

    const roles = db.prepare(
      'SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC'
    ).all(serverId);

    res.json({
      roles: roles.map((r) => ({
        ...r,
        is_admin: !!r.is_admin,
        show_tag: !!r.show_tag,
        hoist: !!r.hoist,
        separate_members: !!r.separate_members,
        badge_image_url: r.badge_image_url ?? null,
      })),
    });
  } catch (err) {
    console.error('Reorder roles error:', err);
    res.status(500).json({ error: 'Failed to reorder roles', code: 'internal' });
  }
});

// ── POST /servers/:sid/members/:uid/roles — assign role ──────────────────────
rolesRouter.post('/:sid/members/:uid/roles', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, uid: targetUserId } = req.params;
    const userId = req.userId;
    const { role_id } = req.body;

    if (!role_id) return res.status(400).json({ error: 'role_id required', code: 'bad_request' });

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(role_id, serverId);
    if (!role) return res.status(404).json({ error: 'Role not found', code: 'not_found' });

    // Cannot assign roles at or above your position
    if (!isOwner) {
      const actorPos = getHighestRolePosition({ userId, serverId, db });
      if (role.position >= actorPos) {
        return res.status(403).json({ error: 'Cannot assign a role at or above your position', code: 'forbidden' });
      }
    }

    // Check target is a member
    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, targetUserId);
    if (!membership) {
      return res.status(404).json({ error: 'User is not a member of this server', code: 'not_found' });
    }

    // Check not already assigned
    const existing = db.prepare(
      'SELECT id FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?'
    ).get(serverId, targetUserId, role_id);
    if (existing) return res.status(409).json({ error: 'Role already assigned', code: 'conflict' });

    const mrId = uuidv4();
    db.prepare(
      'INSERT INTO member_roles (id, server_id, user_id, role_id) VALUES (?, ?, ?, ?)'
    ).run(mrId, serverId, targetUserId, role_id);

    auditLog(db, serverId, userId, 'ROLE_ASSIGN', 'user', targetUserId, { role_id, role_name: role.name });
    broadcast(serverId, 'member.roles.updated', { user_id: targetUserId, role_id, action: 'assign' });

    res.status(201).json({ id: mrId, server_id: serverId, user_id: targetUserId, role_id });
  } catch (err) {
    console.error('Assign role error:', err);
    res.status(500).json({ error: 'Failed to assign role', code: 'internal' });
  }
});

// ── DELETE /servers/:sid/members/:uid/roles/:rid — remove role ───────────────
rolesRouter.delete('/:sid/members/:uid/roles/:rid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, uid: targetUserId, rid: roleId } = req.params;
    const userId = req.userId;

    const { permissions: perms, isOwner, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ error: 'Missing MANAGE_ROLES permission', code: 'forbidden' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(roleId, serverId);
    if (!role) return res.status(404).json({ error: 'Role not found', code: 'not_found' });

    // Cannot remove roles at or above your position
    if (!isOwner) {
      const actorPos = getHighestRolePosition({ userId, serverId, db });
      if (role.position >= actorPos) {
        return res.status(403).json({ error: 'Cannot remove a role at or above your position', code: 'forbidden' });
      }
    }

    db.prepare(
      'DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?'
    ).run(serverId, targetUserId, roleId);

    auditLog(db, serverId, userId, 'ROLE_REMOVE', 'user', targetUserId, { role_id: roleId, role_name: role.name });
    broadcast(serverId, 'member.roles.updated', { user_id: targetUserId, role_id: roleId, action: 'remove' });

    res.json({ removed: true });
  } catch (err) {
    console.error('Remove role error:', err);
    res.status(500).json({ error: 'Failed to remove role', code: 'internal' });
  }
});

// ── Channel Permission Overrides ─────────────────────────────────────────────

// GET /servers/:sid/channels/:cid/overrides
rolesRouter.get('/:sid/channels/:cid/overrides', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, cid: channelId } = req.params;
    const userId = req.userId;

    const membership = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(serverId, userId);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member', code: 'forbidden' });
    }

    const overrides = db.prepare(`
      SELECT cpo.*, r.name as role_name, r.color_hex
      FROM channel_permission_overrides cpo
      JOIN roles r ON r.id = cpo.role_id
      WHERE cpo.channel_id = ?
      ORDER BY r.position DESC
    `).all(channelId);

    res.json({ overrides });
  } catch (err) {
    console.error('List overrides error:', err);
    res.status(500).json({ error: 'Failed to list overrides', code: 'internal' });
  }
});

// PUT /servers/:sid/channels/:cid/overrides
rolesRouter.put('/:sid/channels/:cid/overrides', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, cid: channelId } = req.params;
    const userId = req.userId;

    const { permissions: perms, notFound: nf1 } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (nf1) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission', code: 'forbidden' });
    }

    const { role_id, allow_permissions, deny_permissions } = req.body;
    if (!role_id) return res.status(400).json({ error: 'role_id required', code: 'bad_request' });

    const allow = BigInt(allow_permissions ?? 0).toString();
    const deny = BigInt(deny_permissions ?? 0).toString();

    // Upsert
    const existing = db.prepare(
      'SELECT id FROM channel_permission_overrides WHERE channel_id = ? AND role_id = ?'
    ).get(channelId, role_id);

    if (existing) {
      db.prepare(
        'UPDATE channel_permission_overrides SET allow_permissions = ?, deny_permissions = ? WHERE id = ?'
      ).run(allow, deny, existing.id);
    } else {
      const ovrId = uuidv4();
      db.prepare(
        'INSERT INTO channel_permission_overrides (id, channel_id, role_id, allow_permissions, deny_permissions) VALUES (?, ?, ?, ?, ?)'
      ).run(ovrId, channelId, role_id, allow, deny);
    }

    auditLog(db, serverId, userId, 'CHANNEL_OVERRIDE_UPDATE', 'channel', channelId, { role_id, allow, deny });
    broadcast(serverId, 'override.updated', { channel_id: channelId, role_id, allow, deny });

    res.json({ ok: true });
  } catch (err) {
    console.error('Update override error:', err);
    res.status(500).json({ error: 'Failed to update override', code: 'internal' });
  }
});

// DELETE /servers/:sid/channels/:cid/overrides/:rid
rolesRouter.delete('/:sid/channels/:cid/overrides/:rid', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const { sid: serverId, cid: channelId, rid: roleId } = req.params;
    const userId = req.userId;

    const { permissions: perms, notFound: nf2 } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (nf2) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission', code: 'forbidden' });
    }

    db.prepare(
      'DELETE FROM channel_permission_overrides WHERE channel_id = ? AND role_id = ?'
    ).run(channelId, roleId);

    auditLog(db, serverId, userId, 'CHANNEL_OVERRIDE_DELETE', 'channel', channelId, { role_id: roleId });
    broadcast(serverId, 'override.deleted', { channel_id: channelId, role_id: roleId });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete override error:', err);
    res.status(500).json({ error: 'Failed to delete override', code: 'internal' });
  }
});
