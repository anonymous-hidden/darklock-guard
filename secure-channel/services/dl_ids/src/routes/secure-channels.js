/**
 * Secure Channel Routes
 *
 * REST endpoints for secure channel management, audit log retrieval,
 * lockdown control, and per-user channel permission overrides.
 *
 * All routes mount under /servers (via server.js).
 *
 * POST   /servers/:id/channels/:channelId/secure          — mark channel as secure (owner only)
 * DELETE /servers/:id/channels/:channelId/secure          — remove secure flag (owner only)
 * POST   /servers/:id/channels/:channelId/lockdown        — trigger lockdown (admin+)
 * DELETE /servers/:id/channels/:channelId/lockdown        — release lockdown (admin+)
 * GET    /servers/:id/channels/:channelId/secure/audit    — view secure audit log (security_admin+)
 * GET    /servers/:id/channels/:channelId/user-overrides  — list user overrides (manage_channels)
 * PUT    /servers/:id/channels/:channelId/user-overrides/:uid — set user override
 * DELETE /servers/:id/channels/:channelId/user-overrides/:uid — remove user override
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  requireSecurityRole,
  requireSecureChannelOnly,
  SecurityLevel,
} from '../middleware/channel-rbac.js';
import {
  resolveSecurityLevel,
  logSecureAudit,
} from '../channel-rbac-engine.js';
import {
  evaluateSecurityRules,
} from '../security-channel-rules.js';

export const secureChannelRouter = Router();

// All routes require authentication
secureChannelRouter.use(requireAuth);

// ── Helper ───────────────────────────────────────────────────────────────────
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || null;
}

// ── POST /:id/channels/:channelId/secure — mark as secure ───────────────────
secureChannelRouter.post('/:id/channels/:channelId/secure', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    // Only owner can set secure flag
    const ruleResult = evaluateSecurityRules({
      userId,
      serverId,
      channelId,
      action: 'set_secure',
      db,
      ip: getClientIp(req),
    });

    if (!ruleResult.allowed) {
      return res.status(403).json({
        error: 'Only the server owner can mark a channel as secure',
        code: 'forbidden',
        reason: ruleResult.reason,
      });
    }

    const channel = db.prepare('SELECT id, is_secure FROM channels WHERE id = ? AND server_id = ?')
      .get(channelId, serverId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found', code: 'not_found' });
    }
    if (channel.is_secure) {
      return res.status(400).json({ error: 'Channel is already secure', code: 'already_secure' });
    }

    db.prepare('UPDATE channels SET is_secure = 1 WHERE id = ?').run(channelId);

    logSecureAudit(db, {
      serverId,
      channelId,
      userId,
      action: 'set_secure',
      permissionChecked: 'secure.full_access',
      result: 'allowed',
      ip: getClientIp(req),
    });

    res.json({ ok: true, is_secure: true });
  } catch (err) {
    console.error('[secure-channels] set secure error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── DELETE /:id/channels/:channelId/secure — remove secure flag ─────────────
secureChannelRouter.delete('/:id/channels/:channelId/secure', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    const ruleResult = evaluateSecurityRules({
      userId,
      serverId,
      channelId,
      action: 'remove_secure',
      db,
      ip: getClientIp(req),
    });

    if (!ruleResult.allowed) {
      return res.status(403).json({
        error: 'Only the server owner can remove the secure flag',
        code: 'forbidden',
        reason: ruleResult.reason,
      });
    }

    db.prepare('UPDATE channels SET is_secure = 0, lockdown = 0 WHERE id = ?').run(channelId);

    logSecureAudit(db, {
      serverId,
      channelId,
      userId,
      action: 'remove_secure',
      permissionChecked: 'secure.full_access',
      result: 'allowed',
      ip: getClientIp(req),
    });

    res.json({ ok: true, is_secure: false });
  } catch (err) {
    console.error('[secure-channels] remove secure error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── POST /:id/channels/:channelId/lockdown — trigger lockdown ───────────────
secureChannelRouter.post('/:id/channels/:channelId/lockdown', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    const ruleResult = evaluateSecurityRules({
      userId,
      serverId,
      channelId,
      action: 'trigger_lockdown',
      db,
      ip: getClientIp(req),
    });

    if (!ruleResult.allowed) {
      return res.status(403).json({
        error: 'Insufficient permissions to trigger lockdown',
        code: 'forbidden',
        reason: ruleResult.reason,
      });
    }

    db.prepare('UPDATE channels SET lockdown = 1 WHERE id = ? AND server_id = ?').run(channelId, serverId);

    logSecureAudit(db, {
      serverId,
      channelId,
      userId,
      action: 'trigger_lockdown',
      permissionChecked: 'secure.trigger_lockdown',
      result: 'allowed',
      metadata: { reason: req.body?.reason },
      ip: getClientIp(req),
    });

    res.json({ ok: true, lockdown: true });
  } catch (err) {
    console.error('[secure-channels] lockdown error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── DELETE /:id/channels/:channelId/lockdown — release lockdown ─────────────
secureChannelRouter.delete('/:id/channels/:channelId/lockdown', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    const ruleResult = evaluateSecurityRules({
      userId,
      serverId,
      channelId,
      action: 'release_lockdown',
      db,
      ip: getClientIp(req),
    });

    if (!ruleResult.allowed) {
      return res.status(403).json({
        error: 'Insufficient permissions to release lockdown',
        code: 'forbidden',
        reason: ruleResult.reason,
      });
    }

    db.prepare('UPDATE channels SET lockdown = 0 WHERE id = ? AND server_id = ?').run(channelId, serverId);

    logSecureAudit(db, {
      serverId,
      channelId,
      userId,
      action: 'release_lockdown',
      permissionChecked: 'secure.trigger_lockdown',
      result: 'allowed',
      ip: getClientIp(req),
    });

    res.json({ ok: true, lockdown: false });
  } catch (err) {
    console.error('[secure-channels] release lockdown error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── GET /:id/channels/:channelId/secure/audit — view secure audit log ───────
secureChannelRouter.get('/:id/channels/:channelId/secure/audit', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    const ruleResult = evaluateSecurityRules({
      userId,
      serverId,
      channelId,
      action: 'view_logs',
      db,
      ip: getClientIp(req),
    });

    if (!ruleResult.allowed) {
      return res.status(403).json({
        error: 'Requires security_admin or higher to view secure audit logs',
        code: 'forbidden',
        reason: ruleResult.reason,
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before; // ISO timestamp cursor

    let rows;
    if (before) {
      rows = db.prepare(`
        SELECT sca.*, u.username as actor_username
        FROM secure_channel_audit sca
        JOIN users u ON u.id = sca.user_id
        WHERE sca.server_id = ? AND sca.channel_id = ? AND sca.created_at < ?
        ORDER BY sca.created_at DESC
        LIMIT ?
      `).all(serverId, channelId, before, limit);
    } else {
      rows = db.prepare(`
        SELECT sca.*, u.username as actor_username
        FROM secure_channel_audit sca
        JOIN users u ON u.id = sca.user_id
        WHERE sca.server_id = ? AND sca.channel_id = ?
        ORDER BY sca.created_at DESC
        LIMIT ?
      `).all(serverId, channelId, limit);
    }

    res.json({ audit_entries: rows });
  } catch (err) {
    console.error('[secure-channels] audit log error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── GET /:id/channels/:channelId/user-overrides — list user overrides ───────
secureChannelRouter.get('/:id/channels/:channelId/user-overrides', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId } = req.params;
    const userId = req.userId;

    // Require MANAGE_CHANNELS at server level via security level
    const secLevel = resolveSecurityLevel({ userId, serverId, db });
    if (secLevel < SecurityLevel.MODERATOR) {
      return res.status(403).json({ error: 'Requires moderator or higher', code: 'forbidden' });
    }

    const channel = db.prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found', code: 'not_found' });

    const overrides = db.prepare(`
      SELECT cuo.*, u.username
      FROM channel_user_overrides cuo
      JOIN users u ON u.id = cuo.user_id
      WHERE cuo.channel_id = ?
    `).all(channelId);

    res.json({ overrides });
  } catch (err) {
    console.error('[secure-channels] list user overrides error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── PUT /:id/channels/:channelId/user-overrides/:uid — set user override ────
secureChannelRouter.put('/:id/channels/:channelId/user-overrides/:uid', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId, uid: targetUserId } = req.params;
    const userId = req.userId;

    const secLevel = resolveSecurityLevel({ userId, serverId, db });
    if (secLevel < SecurityLevel.ADMIN) {
      return res.status(403).json({ error: 'Requires admin or higher', code: 'forbidden' });
    }

    const channel = db.prepare('SELECT id, is_secure FROM channels WHERE id = ? AND server_id = ?')
      .get(channelId, serverId);
    if (!channel) return res.status(404).json({ error: 'Channel not found', code: 'not_found' });

    const { allow_permissions, deny_permissions } = req.body;
    const allow = String(allow_permissions ?? '0');
    const deny = String(deny_permissions ?? '0');

    const existing = db.prepare('SELECT id FROM channel_user_overrides WHERE channel_id = ? AND user_id = ?')
      .get(channelId, targetUserId);

    if (existing) {
      db.prepare('UPDATE channel_user_overrides SET allow_permissions = ?, deny_permissions = ? WHERE id = ?')
        .run(allow, deny, existing.id);
    } else {
      db.prepare('INSERT INTO channel_user_overrides (id, channel_id, user_id, allow_permissions, deny_permissions) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), channelId, targetUserId, allow, deny);
    }

    if (channel.is_secure) {
      logSecureAudit(db, {
        serverId,
        channelId,
        userId,
        action: 'set_user_override',
        permissionChecked: 'channel.manage',
        result: 'allowed',
        metadata: { target_user_id: targetUserId, allow, deny },
        ip: getClientIp(req),
      });
    }

    res.json({ ok: true, channel_id: channelId, user_id: targetUserId, allow_permissions: allow, deny_permissions: deny });
  } catch (err) {
    console.error('[secure-channels] set user override error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});

// ── DELETE /:id/channels/:channelId/user-overrides/:uid — remove override ───
secureChannelRouter.delete('/:id/channels/:channelId/user-overrides/:uid', (req, res) => {
  try {
    const db = req.db;
    const { id: serverId, channelId, uid: targetUserId } = req.params;
    const userId = req.userId;

    const secLevel = resolveSecurityLevel({ userId, serverId, db });
    if (secLevel < SecurityLevel.ADMIN) {
      return res.status(403).json({ error: 'Requires admin or higher', code: 'forbidden' });
    }

    db.prepare('DELETE FROM channel_user_overrides WHERE channel_id = ? AND user_id = ?')
      .run(channelId, targetUserId);

    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('[secure-channels] delete user override error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'internal' });
  }
});
