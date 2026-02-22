/**
 * Audit log helper + GET route.
 *
 * Every mutation in servers/roles/channels writes an audit log entry.
 * GET /servers/:sid/audit-log — returns paginated audit log.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { resolvePermissions, hasPermission, Permissions } from '../permissions.js';

export const auditRouter = Router();

/**
 * Write an audit log entry. Called from route handlers.
 *
 * @param {object} db
 * @param {string} serverId
 * @param {string} actorId
 * @param {string} action - e.g. ROLE_CREATE, MEMBER_KICK
 * @param {string|null} targetType - 'role' | 'user' | 'channel' | 'server'
 * @param {string|null} targetId
 * @param {object|null} changes - JSON-serializable diff
 * @param {string|null} reason
 * @param {object|null} diffJson - before/after diff for detailed view
 */
export function auditLog(db, serverId, actorId, action, targetType, targetId, changes, reason, diffJson) {
  try {
    db.prepare(
      "INSERT INTO audit_log (id, server_id, actor_id, action, target_type, target_id, changes, diff_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(
      uuidv4(),
      serverId,
      actorId,
      action,
      targetType ?? null,
      targetId ?? null,
      changes ? JSON.stringify(changes) : null,
      diffJson ? JSON.stringify(diffJson) : null,
      reason ?? null,
    );
  } catch (err) {
    console.error('Audit log write error:', err);
    // Non-fatal — don't break the main operation
  }
}

// ── GET /servers/:sid/audit-log ──────────────────────────────────────────────
auditRouter.get('/:sid/audit-log', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const serverId = req.params.sid;
    const userId = req.userId;
    console.log('[IDS] GET /servers/:sid/audit-log serverId=%s userId=%s query=%j', serverId, userId, req.query);

    // Require VIEW_AUDIT_LOG or MANAGE_SERVER to view audit log
    const { permissions: perms, notFound } = resolvePermissions({ userId, serverId, channelId: null, db });
    if (notFound) return res.status(404).json({ error: 'Server not found', code: 'not_found' });
    if (!hasPermission(perms, Permissions.VIEW_AUDIT_LOG) && !hasPermission(perms, Permissions.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Missing VIEW_AUDIT_LOG permission', code: 'forbidden' });
    }

    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const before = req.query.before; // ISO date
    const actorFilter = req.query.actor_id;
    const actionFilter = req.query.action;
    const targetTypeFilter = req.query.target_type;

    let query = `
      SELECT al.*, u.username as actor_username
      FROM audit_log al
      JOIN users u ON u.id = al.actor_id
      WHERE al.server_id = ?
    `;
    const params = [serverId];

    if (before) {
      query += ' AND al.created_at < ?';
      params.push(before);
    }

    if (actorFilter) {
      query += ' AND al.actor_id = ?';
      params.push(actorFilter);
    }

    if (actionFilter) {
      query += ' AND al.action = ?';
      params.push(actionFilter);
    }

    if (targetTypeFilter) {
      query += ' AND al.target_type = ?';
      params.push(targetTypeFilter);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ?';
    params.push(limit);

    const entries = db.prepare(query).all(...params);

    // Parse changes/diff_json
    const result = entries.map((e) => ({
      ...e,
      changes: e.changes ? JSON.parse(e.changes) : null,
      diff_json: e.diff_json ? JSON.parse(e.diff_json) : null,
    }));

    res.json({ entries: result });
  } catch (err) {
    console.error('Audit log read error:', err);
    res.status(500).json({ error: 'Failed to read audit log', code: 'internal' });
  }
});
