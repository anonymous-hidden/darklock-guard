/**
 * IDS AutoMod routes:
 *
 * GET    /servers/:id/automod/rules              — list rules
 * POST   /servers/:id/automod/rules              — create rule
 * PATCH  /servers/:id/automod/rules/:ruleId      — update rule
 * DELETE /servers/:id/automod/rules/:ruleId      — delete rule
 * GET    /servers/:id/automod/events             — list events
 * POST   /servers/:id/automod/evaluate           — evaluate message against rules (server-side enforcement)
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { resolvePermissions, hasPermission, Permissions } from '../permissions.js';
import { auditLog } from './audit.js';

export const automodRouter = Router();

const VALID_RULE_TYPES = ['word_filter', 'spam', 'mention', 'link', 'media', 'anti_raid'];
const VALID_ACTIONS = ['nothing', 'warn', 'delete', 'timeout', 'kick', 'ban'];

// ── GET /servers/:id/automod/rules ───────────────────────────────────────────
automodRouter.get('/:id/automod/rules', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const rules = db.prepare('SELECT * FROM automod_rules WHERE server_id = ? ORDER BY rule_type').all(serverId);
    res.json({ rules });
  } catch (err) {
    console.error('List automod rules error:', err);
    res.status(500).json({ error: 'Failed to list rules', code: 'internal' });
  }
});

// ── POST /servers/:id/automod/rules ──────────────────────────────────────────
automodRouter.post('/:id/automod/rules', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const { rule_type, enabled, config_json, action_type, action_duration_seconds } = req.body;

    if (!VALID_RULE_TYPES.includes(rule_type)) {
      return res.status(400).json({ error: 'Invalid rule_type', code: 'bad_request' });
    }
    if (action_type && !VALID_ACTIONS.includes(action_type)) {
      return res.status(400).json({ error: 'Invalid action_type', code: 'bad_request' });
    }

    const ruleId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO automod_rules (id, server_id, rule_type, enabled, config_json, action_type, action_duration_seconds, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ruleId, serverId, rule_type, enabled ? 1 : 0, JSON.stringify(config_json || {}),
      action_type || 'delete', action_duration_seconds || null, userId, userId, now, now);

    auditLog(db, serverId, userId, 'AUTOMOD_RULE_CREATE', 'automod_rule', ruleId, { rule_type, action_type });

    const rule = db.prepare('SELECT * FROM automod_rules WHERE id = ?').get(ruleId);
    res.status(201).json(rule);
  } catch (err) {
    console.error('Create automod rule error:', err);
    res.status(500).json({ error: 'Failed to create rule', code: 'internal' });
  }
});

// ── PATCH /servers/:id/automod/rules/:ruleId ─────────────────────────────────
automodRouter.patch('/:id/automod/rules/:ruleId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const ruleId = req.params.ruleId;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const existing = db.prepare('SELECT * FROM automod_rules WHERE id = ? AND server_id = ?').get(ruleId, serverId);
    if (!existing) return res.status(404).json({ error: 'Rule not found', code: 'not_found' });

    const { enabled, config_json, action_type, action_duration_seconds } = req.body;
    const updates = {};

    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
    if (config_json !== undefined) updates.config_json = JSON.stringify(config_json);
    if (action_type !== undefined) {
      if (!VALID_ACTIONS.includes(action_type)) {
        return res.status(400).json({ error: 'Invalid action_type', code: 'bad_request' });
      }
      updates.action_type = action_type;
    }
    if (action_duration_seconds !== undefined) updates.action_duration_seconds = action_duration_seconds;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No changes provided', code: 'bad_request' });
    }

    updates.updated_by = userId;
    updates.updated_at = new Date().toISOString();

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(updates);
    db.prepare(`UPDATE automod_rules SET ${sets} WHERE id = ?`).run(...vals, ruleId);

    auditLog(db, serverId, userId, 'AUTOMOD_RULE_UPDATE', 'automod_rule', ruleId, updates);

    const updated = db.prepare('SELECT * FROM automod_rules WHERE id = ?').get(ruleId);
    res.json(updated);
  } catch (err) {
    console.error('Update automod rule error:', err);
    res.status(500).json({ error: 'Failed to update rule', code: 'internal' });
  }
});

// ── DELETE /servers/:id/automod/rules/:ruleId ────────────────────────────────
automodRouter.delete('/:id/automod/rules/:ruleId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const ruleId = req.params.ruleId;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    db.prepare('DELETE FROM automod_rules WHERE id = ? AND server_id = ?').run(ruleId, serverId);
    auditLog(db, serverId, userId, 'AUTOMOD_RULE_DELETE', 'automod_rule', ruleId, {});
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete automod rule error:', err);
    res.status(500).json({ error: 'Failed to delete rule', code: 'internal' });
  }
});

// ── GET /servers/:id/automod/events ──────────────────────────────────────────
automodRouter.get('/:id/automod/events', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;

    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing MANAGE_SERVER permission', code: 'forbidden' });
    }

    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const events = db.prepare(`
      SELECT ae.*, u.username as actor_username
      FROM automod_events ae
      LEFT JOIN users u ON u.id = ae.actor_user_id
      WHERE ae.server_id = ?
      ORDER BY ae.created_at DESC
      LIMIT ?
    `).all(serverId, limit);

    res.json({ events });
  } catch (err) {
    console.error('List automod events error:', err);
    res.status(500).json({ error: 'Failed to list events', code: 'internal' });
  }
});

// ── POST /servers/:id/automod/evaluate — server-side message evaluation ──────
automodRouter.post('/:id/automod/evaluate', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.id;
    const userId = req.userId;
    const { message_content, channel_id, message_id } = req.body;

    if (!message_content) return res.json({ allowed: true, actions: [] });

    const rules = db.prepare(
      'SELECT * FROM automod_rules WHERE server_id = ? AND enabled = 1'
    ).all(serverId);

    const actions = [];

    // Get user's roles
    const userRoles = db.prepare(
      'SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?'
    ).all(serverId, userId).map(r => r.role_id);

    for (const rule of rules) {
      const config = JSON.parse(rule.config_json || '{}');

      // Check exemptions
      if (config.exempt_roles?.some(r => userRoles.includes(r))) continue;
      if (config.exempt_channels?.includes(channel_id)) continue;

      let triggered = false;
      let reason = '';

      switch (rule.rule_type) {
        case 'word_filter': {
          const words = config.blocked_words || [];
          const mode = config.match_mode || 'contains';
          const content = config.ignore_whitespace ? message_content.replace(/\s/g, '') : message_content;
          for (const word of words) {
            if (mode === 'exact' && content.toLowerCase() === word.toLowerCase()) {
              triggered = true; reason = `Blocked word: ${word}`; break;
            }
            if (mode === 'contains' && content.toLowerCase().includes(word.toLowerCase())) {
              triggered = true; reason = `Contains blocked word: ${word}`; break;
            }
            if (mode === 'regex') {
              try {
                if (new RegExp(word, 'i').test(content)) {
                  triggered = true; reason = `Regex match: ${word}`; break;
                }
              } catch {}
            }
          }
          break;
        }
        case 'mention': {
          const mentionCount = (message_content.match(/@/g) || []).length;
          if (config.max_mentions_per_message && mentionCount > config.max_mentions_per_message) {
            triggered = true; reason = `Too many mentions: ${mentionCount}`;
          }
          if (config.block_everyone_here && (message_content.includes('@everyone') || message_content.includes('@here'))) {
            triggered = true; reason = 'Used @everyone/@here';
          }
          break;
        }
        case 'link': {
          const urlPattern = /https?:\/\/[^\s]+/gi;
          const urls = message_content.match(urlPattern) || [];
          if (config.block_external_invites && /discord\.gg|invite/i.test(message_content)) {
            triggered = true; reason = 'External invite link detected';
          }
          if (config.block_url_shorteners) {
            const shorteners = ['bit.ly', 'tinyurl', 'goo.gl', 't.co', 'is.gd'];
            if (urls.some(u => shorteners.some(s => u.includes(s)))) {
              triggered = true; reason = 'URL shortener detected';
            }
          }
          if (config.allowed_domains?.length > 0 && urls.length > 0) {
            const blocked = urls.filter(u => !config.allowed_domains.some(d => u.includes(d)));
            if (blocked.length > 0) {
              triggered = true; reason = `Domain not in allowlist: ${blocked[0]}`;
            }
          }
          break;
        }
        case 'spam': {
          if (config.max_links_per_message) {
            const linkCount = (message_content.match(/https?:\/\//g) || []).length;
            if (linkCount > config.max_links_per_message) {
              triggered = true; reason = `Too many links: ${linkCount}`;
            }
          }
          if (config.max_emojis_per_message) {
            const emojiCount = (message_content.match(/[\u{1F600}-\u{1F6FF}]/gu) || []).length;
            if (emojiCount > config.max_emojis_per_message) {
              triggered = true; reason = `Too many emojis: ${emojiCount}`;
            }
          }
          break;
        }
      }

      if (triggered) {
        const eventId = uuidv4();
        db.prepare(`
          INSERT INTO automod_events (id, server_id, rule_id, actor_user_id, message_id, channel_id, reason, action_taken, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(eventId, serverId, rule.id, userId, message_id || null, channel_id || null,
          reason, rule.action_type, JSON.stringify({ message_preview: message_content.slice(0, 100) }));

        actions.push({
          rule_type: rule.rule_type,
          action: rule.action_type,
          reason,
          duration_seconds: rule.action_duration_seconds,
        });
      }
    }

    const blocked = actions.some(a => a.action !== 'nothing' && a.action !== 'warn');
    res.json({ allowed: !blocked, actions });
  } catch (err) {
    console.error('Automod evaluate error:', err);
    res.json({ allowed: true, actions: [] }); // fail-open
  }
});
