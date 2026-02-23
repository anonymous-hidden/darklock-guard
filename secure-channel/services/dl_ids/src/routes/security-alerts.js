/**
 * Security Alert Routes — REST API for security alerts and audit logs.
 *
 * POST   /servers/:id/security/alerts               — create a security alert
 * GET    /servers/:id/security/alerts               — list security alerts
 * PATCH  /servers/:id/security/alerts/:alertId      — resolve an alert
 * GET    /servers/:id/security/audit                — get security audit log
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSecurityRole } from '../middleware/channel-rbac.js';
import { SecurityLevel } from '../channel-rbac-engine.js';
import {
  createAlert,
  getAlerts,
  resolveAlert,
  canPerformSecurityAction,
  AlertType,
} from '../services/security-service.js';
import { getAuditLog } from '../services/audit-service.js';

export const securityAlertRouter = Router();
securityAlertRouter.use(requireAuth);

// ── POST /servers/:id/security/alerts ────────────────────────────────────────
securityAlertRouter.post('/:id/security/alerts',
  requireSecurityRole(SecurityLevel.SECURITY_ADMIN),
  (req, res) => {
    try {
      const db = req.db;
      const { id: serverId } = req.params;
      const userId = req.userId;
      const { channel_id, alert_type, severity, message, metadata } = req.body;

      if (!alert_type) {
        return res.status(400).json({ error: 'alert_type is required', code: 'bad_request' });
      }

      const validTypes = Object.values(AlertType);
      if (!validTypes.includes(alert_type)) {
        return res.status(400).json({
          error: `Invalid alert_type. Valid: ${validTypes.join(', ')}`,
          code: 'bad_request',
        });
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;

      const alert = createAlert(db, {
        serverId,
        channelId: channel_id || null,
        userId,
        alertType: alert_type,
        severity: severity || 'medium',
        message,
        metadata,
        ip,
      });

      res.status(201).json(alert);
    } catch (err) {
      console.error('[security-alerts] POST error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /servers/:id/security/alerts ─────────────────────────────────────────
securityAlertRouter.get('/:id/security/alerts',
  requireSecurityRole(SecurityLevel.MODERATOR),
  (req, res) => {
    try {
      const db = req.db;
      const { id: serverId } = req.params;
      const { limit, before, channel_id, alert_type, resolved } = req.query;

      const alerts = getAlerts(db, {
        serverId,
        limit: parseInt(limit) || 50,
        before,
        channelId: channel_id,
        alertType: alert_type,
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
      });

      res.json(alerts);
    } catch (err) {
      console.error('[security-alerts] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── PATCH /servers/:id/security/alerts/:alertId ──────────────────────────────
securityAlertRouter.patch('/:id/security/alerts/:alertId',
  requireSecurityRole(SecurityLevel.SECURITY_ADMIN),
  (req, res) => {
    try {
      const db = req.db;
      const { alertId } = req.params;
      const userId = req.userId;

      const result = resolveAlert(db, { alertId, resolvedBy: userId });
      res.json(result);
    } catch (err) {
      console.error('[security-alerts] PATCH error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /servers/:id/security/audit ──────────────────────────────────────────
securityAlertRouter.get('/:id/security/audit',
  requireSecurityRole(SecurityLevel.SECURITY_ADMIN),
  (req, res) => {
    try {
      const db = req.db;
      const { id: serverId } = req.params;
      const { limit, before, channel_id, action } = req.query;

      const entries = getAuditLog(db, {
        serverId,
        channelId: channel_id,
        limit: parseInt(limit) || 50,
        before,
        action,
      });

      res.json(entries);
    } catch (err) {
      console.error('[security-audit] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
