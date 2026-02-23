/**
 * IDS Invite routes:
 *
 * POST   /servers/:id/invites         — create invite
 * GET    /servers/:id/invites         — list invites
 * DELETE /servers/:id/invites/:invId  — revoke invite
 * POST   /invites/:token/join        — join server via invite token
 * GET    /invites/:token             — get invite info (public)
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { resolvePermissions, hasPermission, Permissions } from '../permissions.js';
import { auditLog } from './audit.js';

export const invitesRouter = Router();

function generateInviteToken() {
  return crypto.randomBytes(6).toString('base64url');
}

const invitePreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite preview requests', code: 'rate_limited' },
});

function getInvitePreview(db, token) {
  return db.prepare(`
    SELECT si.*, s.name as server_name, s.icon as server_icon, s.banner_url as server_banner,
           s.description as server_description,
           (SELECT COUNT(*) FROM server_members WHERE server_id = si.server_id) as member_count
    FROM server_invites si
    JOIN servers s ON s.id = si.server_id
    WHERE si.token = ?
  `).get(token);
}

// ── POST /servers/:id/invites — create invite ────────────────────────────────
invitesRouter.post('/:id/invites', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.CREATE_INVITES)) {
      return res.status(403).json({ error: 'Missing CREATE_INVITES permission', code: 'forbidden' });
    }

    const { expires_in, max_uses } = req.body;
    let expiresAt = null;

    if (expires_in) {
      // Accept named durations OR numeric seconds (e.g. "3600" or 3600)
      const secs = Number(expires_in);
      if (!isNaN(secs) && secs > 0) {
        expiresAt = new Date(Date.now() + secs * 1000).toISOString();
      } else if (expires_in === '1h') {
        expiresAt = new Date(Date.now() + 3600000).toISOString();
      } else if (expires_in === '24h') {
        expiresAt = new Date(Date.now() + 86400000).toISOString();
      } else if (expires_in === '7d') {
        expiresAt = new Date(Date.now() + 604800000).toISOString();
      }
      // else 'never' or '0' — null
    }

    const inviteId = uuidv4();
    const token = generateInviteToken();

    db.prepare(`
      INSERT INTO server_invites (id, server_id, created_by, token, expires_at, max_uses)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(inviteId, serverId, userId, token, expiresAt, max_uses || 0);

    auditLog(db, serverId, userId, 'INVITE_CREATE', 'invite', inviteId, { token, max_uses, expires_in });

    res.status(201).json({
      id: inviteId,
      server_id: serverId,
      token,
      expires_at: expiresAt,
      max_uses: max_uses || 0,
      use_count: 0,
      created_by: userId,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ error: 'Failed to create invite', code: 'internal' });
  }
});

// ── GET /servers/:id/invites — list invites ──────────────────────────────────
invitesRouter.get('/:id/invites', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const invites = db.prepare(`
      SELECT si.*, u.username as creator_name
      FROM server_invites si
      JOIN users u ON u.id = si.created_by
      WHERE si.server_id = ?
      ORDER BY si.created_at DESC
    `).all(serverId);

    res.json({ invites });
  } catch (err) {
    console.error('List invites error:', err);
    res.status(500).json({ error: 'Failed to list invites', code: 'internal' });
  }
});

// ── DELETE /servers/:id/invites/:invId — revoke ──────────────────────────────
invitesRouter.delete('/:id/invites/:invId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    db.prepare('DELETE FROM server_invites WHERE id = ? AND server_id = ?').run(req.params.invId, serverId);
    auditLog(db, serverId, userId, 'INVITE_DELETE', 'invite', req.params.invId, {});
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete invite error:', err);
    res.status(500).json({ error: 'Failed to delete invite', code: 'internal' });
  }
});

// ── GET /invites/:token — public invite info ─────────────────────────────────
invitesRouter.get('/:token', (req, res) => {
  try {
    const db = req.db;
    const invite = getInvitePreview(db, req.params.token);

    if (!invite) return res.status(404).json({ error: 'Invite not found or expired', code: 'not_found' });

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired', code: 'expired' });
    }
    // Check max uses
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return res.status(410).json({ error: 'Invite has reached max uses', code: 'exhausted' });
    }

    res.json({
      token: invite.token,
      server_id: invite.server_id,
      server_name: invite.server_name,
      server_icon: invite.server_icon,
      server_banner: invite.server_banner ?? null,
      server_bio: invite.server_description ?? null,
      server_description: invite.server_description,
      member_count: invite.member_count,
      expires_at: invite.expires_at,
    });
  } catch (err) {
    console.error('Get invite error:', err);
    res.status(500).json({ error: 'Failed to get invite', code: 'internal' });
  }
});

// ── GET /invites/:token/preview — public preview for invite cards ───────────
invitesRouter.get('/:token/preview', invitePreviewLimiter, (req, res) => {
  try {
    const db = req.db;
    const invite = getInvitePreview(db, req.params.token);
    if (!invite) return res.status(404).json({ error: 'Invite not found', code: 'not_found' });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired', code: 'expired' });
    }
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return res.status(410).json({ error: 'Invite exhausted', code: 'exhausted' });
    }
    res.json({
      token: invite.token,
      server_id: invite.server_id,
      server_name: invite.server_name,
      server_icon: invite.server_icon ?? null,
      server_banner: invite.server_banner ?? null,
      server_bio: invite.server_description ?? null,
      server_description: invite.server_description ?? null,
      member_count: invite.member_count ?? 0,
      expires_at: invite.expires_at ?? null,
    });
  } catch (err) {
    console.error('Invite preview error:', err);
    res.status(500).json({ error: 'Failed to load invite preview', code: 'internal' });
  }
});

// ── POST /invites/:token/join — join via invite ──────────────────────────────
invitesRouter.post('/:token/join', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const token = req.params.token;

    const invite = db.prepare('SELECT * FROM server_invites WHERE token = ?').get(token);
    if (!invite) return res.status(404).json({ error: 'Invite not found', code: 'not_found' });

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired', code: 'expired' });
    }
    // Check max uses
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return res.status(410).json({ error: 'Invite exhausted', code: 'exhausted' });
    }

    // Check if already member
    const existing = db.prepare(
      'SELECT id FROM server_members WHERE server_id = ? AND user_id = ?'
    ).get(invite.server_id, userId);
    if (existing) {
      return res.json({ already_member: true, server_id: invite.server_id });
    }

    // Check automod anti-raid rules
    const antiRaid = db.prepare(
      "SELECT * FROM automod_rules WHERE server_id = ? AND rule_type = 'anti_raid' AND enabled = 1"
    ).get(invite.server_id);

    if (antiRaid) {
      const config = JSON.parse(antiRaid.config_json || '{}');

      // Check account age
      if (config.min_account_age_days) {
        const user = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
        if (user) {
          const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
          if (ageDays < config.min_account_age_days) {
            db.prepare(`
              INSERT INTO automod_events (id, server_id, rule_id, actor_user_id, reason, action_taken, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), invite.server_id, antiRaid.id, userId,
              'Account too young', 'deny_join', JSON.stringify({ age_days: ageDays }));
            return res.status(403).json({ error: 'Account does not meet minimum age requirement', code: 'anti_raid' });
          }
        }
      }

      // Check join rate
      if (config.max_joins_per_minute) {
        const recentJoins = db.prepare(`
          SELECT COUNT(*) as c FROM server_members
          WHERE server_id = ? AND joined_at > datetime('now', '-1 minute')
        `).get(invite.server_id).c;

        if (recentJoins >= config.max_joins_per_minute) {
          db.prepare(`
            INSERT INTO automod_events (id, server_id, rule_id, actor_user_id, reason, action_taken)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(uuidv4(), invite.server_id, antiRaid.id, userId, 'Join rate exceeded', 'deny_join');
          return res.status(429).json({ error: 'Server join rate limit exceeded', code: 'rate_limited' });
        }
      }
    }

    // Add member
    const memberId = uuidv4();
    db.prepare(
      'INSERT INTO server_members (id, server_id, user_id, joined_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).run(memberId, invite.server_id, userId);

    // Increment use_count
    db.prepare('UPDATE server_invites SET use_count = use_count + 1 WHERE id = ?').run(invite.id);

    // Check if rules agreement required
    const server = db.prepare('SELECT force_rule_agreement, rules_channel_id FROM servers WHERE id = ?').get(invite.server_id);
    const requireRules = server?.force_rule_agreement === 1;

    auditLog(db, invite.server_id, userId, 'MEMBER_JOIN', 'user', userId, { via_invite: token });

    res.status(201).json({
      joined: true,
      server_id: invite.server_id,
      require_rules: requireRules,
      rules_channel_id: server?.rules_channel_id,
    });
  } catch (err) {
    console.error('Join via invite error:', err);
    res.status(500).json({ error: 'Failed to join server', code: 'internal' });
  }
});
