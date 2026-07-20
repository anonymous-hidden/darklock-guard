/**
 * Security Service — security alerts, lockdown management, threat assessment.
 */
import { randomUUID } from 'crypto';
import { eventBus } from '../core/event-bus.js';
import { broadcast } from '../sse.js';
import { logAudit } from './audit-service.js';
import { resolveSecurityLevel, SecurityLevel } from '../channel-rbac-engine.js';

/**
 * Security alert types.
 */
export const AlertType = Object.freeze({
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  LOCKDOWN_TRIGGERED: 'lockdown_triggered',
  LOCKDOWN_RELEASED: 'lockdown_released',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  PERMISSION_ESCALATION: 'permission_escalation',
  AUDIT_ANOMALY: 'audit_anomaly',
  MANUAL_ALERT: 'manual_alert',
});

/**
 * Create a security alert.
 */
export function createAlert(db, {
  serverId,
  channelId,
  userId,
  alertType,
  severity = 'medium',
  message,
  metadata,
  ip,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();

  // Store in security_alerts table (create if needed)
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        channel_id TEXT,
        user_id TEXT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        message TEXT,
        metadata_json TEXT,
        ip_address TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch {
    // Table may already exist
  }

  db.prepare(`
    INSERT INTO security_alerts (id, server_id, channel_id, user_id, alert_type, severity, message, metadata_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, serverId, channelId || null, userId || null, alertType, severity, message || null, metadata ? JSON.stringify(metadata) : null, ip || null, now);

  // Log to audit trail
  logAudit(db, {
    serverId,
    channelId,
    userId,
    action: `security_alert.${alertType}`,
    result: 'alert_created',
    metadata: { alert_id: id, severity, message },
    ip,
  });

  const alert = {
    id,
    server_id: serverId,
    channel_id: channelId,
    user_id: userId,
    alert_type: alertType,
    severity,
    message,
    created_at: now,
  };

  // Broadcast to server via SSE and event bus
  eventBus.fire('security.alert', { serverId, channelId, userId, alertType, severity, alert });
  broadcast(serverId, 'security.alert', alert);

  return alert;
}

/**
 * Get security alerts for a server (paginated).
 */
export function getAlerts(db, { serverId, limit = 50, before, channelId, alertType, resolved }) {
  const safeLimit = Math.min(limit, 200);
  const params = [serverId];
  let where = 'WHERE server_id = ?';

  if (channelId) {
    where += ' AND channel_id = ?';
    params.push(channelId);
  }
  if (alertType) {
    where += ' AND alert_type = ?';
    params.push(alertType);
  }
  if (resolved !== undefined) {
    where += ' AND resolved = ?';
    params.push(resolved ? 1 : 0);
  }
  if (before) {
    where += ' AND created_at < ?';
    params.push(before);
  }

  params.push(safeLimit);

  // Ensure table exists
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        channel_id TEXT,
        user_id TEXT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        message TEXT,
        metadata_json TEXT,
        ip_address TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch {}

  return db.prepare(`
    SELECT a.*, u.username as actor_username
    FROM security_alerts a
    LEFT JOIN users u ON a.user_id = u.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(...params);
}

/**
 * Resolve a security alert.
 */
export function resolveAlert(db, { alertId, resolvedBy }) {
  const now = new Date().toISOString();
  db.prepare('UPDATE security_alerts SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .run(resolvedBy, now, alertId);
  return { ok: true };
}

/**
 * Check if a user has sufficient security level to perform a security action.
 */
export function canPerformSecurityAction(db, { userId, serverId, requiredLevel = SecurityLevel.SECURITY_ADMIN }) {
  const level = resolveSecurityLevel({ userId, serverId, db });
  return level >= requiredLevel;
}
