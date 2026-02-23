/**
 * Audit Service — centralized audit logging for secure channel operations.
 */
import { randomUUID } from 'crypto';
import { eventBus } from '../core/event-bus.js';

/**
 * Log a secure channel audit entry.
 */
export function logAudit(db, {
  serverId,
  channelId,
  userId,
  action,
  permissionChecked,
  result,
  metadata,
  ip,
  userAgent,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const metaJson = metadata ? JSON.stringify(metadata) : null;

  db.prepare(`
    INSERT INTO secure_channel_audit (id, server_id, channel_id, user_id, action, permission_checked, result, metadata_json, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, serverId, channelId, userId, action, permissionChecked ?? null, result, metaJson, ip ?? null, userAgent ?? null, now);

  eventBus.fire('audit.created', { serverId, channelId, userId, action, result });

  return { id, created_at: now };
}

/**
 * Get secure channel audit log entries (paginated).
 */
export function getAuditLog(db, { serverId, channelId, limit = 50, before, action }) {
  const safeLimit = Math.min(limit, 200);
  const params = [];
  let where = 'WHERE server_id = ?';
  params.push(serverId);

  if (channelId) {
    where += ' AND channel_id = ?';
    params.push(channelId);
  }
  if (action) {
    where += ' AND action = ?';
    params.push(action);
  }
  if (before) {
    where += ' AND created_at < ?';
    params.push(before);
  }

  params.push(safeLimit);

  return db.prepare(`
    SELECT a.*, u.username as actor_username
    FROM secure_channel_audit a
    LEFT JOIN users u ON a.user_id = u.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(...params);
}
