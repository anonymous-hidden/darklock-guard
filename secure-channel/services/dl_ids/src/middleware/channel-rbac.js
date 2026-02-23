/**
 * Channel RBAC Middleware
 *
 * Express middleware for enforcing channel-level permissions, secure channel
 * access, and security role minimums. Integrates with both the RBAC engine
 * and the security rule engine.
 *
 * Usage:
 *   router.get('/path', requireAuth, requireChannelPermission('channel.view'), handler);
 *   router.post('/path', requireAuth, requireSecureChannelAccess('channel.send', 'send_message'), handler);
 *   router.post('/path', requireAuth, requireSecurityRole(SecurityLevel.ADMIN), handler);
 */

import {
  canUserAccessChannel,
  resolveSecurityLevel,
  logSecureAudit,
  SecurityLevel,
} from '../channel-rbac-engine.js';
import {
  checkSecureChannelAccess,
  evaluateSecurityRules,
} from '../security-channel-rules.js';

// Re-export for convenience
export { SecurityLevel };

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || null;
}

function extractServerAndChannel(req) {
  // Support both :id and :sid for serverId
  const serverId = req.params.id || req.params.sid;
  const channelId = req.params.channelId || req.params.cid;
  return { serverId, channelId };
}

// ── requireChannelPermission ─────────────────────────────────────────────────

/**
 * Middleware that checks if the authenticated user has a specific channel permission.
 * Uses the RBAC engine only (no security rule evaluation).
 *
 * Expects route params to contain serverId (:id or :sid) and channelId (:channelId or :cid).
 *
 * @param {string} permissionKey - e.g. 'channel.view', 'channel.send'
 * @returns {Function} Express middleware
 */
export function requireChannelPermission(permissionKey) {
  return (req, res, next) => {
    try {
      const db = req.db;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });

      const { serverId, channelId } = extractServerAndChannel(req);
      if (!serverId || !channelId) {
        return res.status(400).json({ error: 'Missing server or channel ID', code: 'bad_request' });
      }

      // Verify membership first
      const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?')
        .get(serverId, userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
      }

      const result = canUserAccessChannel({ userId, serverId, channelId, permissionKey, db });

      if (!result.allowed) {
        return res.status(403).json({
          error: `Missing permission: ${permissionKey}`,
          code: 'forbidden',
          reason: result.reason,
        });
      }

      // Attach RBAC context to request for downstream use
      req.channelRbac = {
        permissions: result.permissions,
        isSecure: result.isSecure,
        securityLevel: result.securityLevel,
      };

      next();
    } catch (err) {
      console.error('[channel-rbac-mw] requireChannelPermission error:', err);
      res.status(500).json({ error: 'Internal permission check error', code: 'internal' });
    }
  };
}

// ── requireSecureChannelAccess ───────────────────────────────────────────────

/**
 * Middleware that checks BOTH security rules AND RBAC permissions.
 * Use this for operations on channels that may be secure (is_secure = 1).
 *
 * This is the primary middleware for message operations in channels.
 * It runs the full security pipeline: rule engine → RBAC → audit.
 *
 * @param {string} permissionKey - e.g. 'channel.view', 'channel.send'
 * @param {string} action        - Rule engine action, e.g. 'send_message', 'delete_message'
 * @param {object} [opts]        - Additional options
 * @param {Function} [opts.getExtra] - (req) => object, supplies extra context to rules
 * @returns {Function} Express middleware
 */
export function requireSecureChannelAccess(permissionKey, action, opts = {}) {
  return (req, res, next) => {
    try {
      const db = req.db;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });

      const { serverId, channelId } = extractServerAndChannel(req);
      if (!serverId || !channelId) {
        return res.status(400).json({ error: 'Missing server or channel ID', code: 'bad_request' });
      }

      // Verify membership
      const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?')
        .get(serverId, userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a member of this server', code: 'forbidden' });
      }

      const extra = opts.getExtra ? opts.getExtra(req) : {};
      const ip = getClientIp(req);

      const result = checkSecureChannelAccess({
        userId,
        serverId,
        channelId,
        permissionKey,
        action,
        db,
        ip,
        extra,
      });

      if (!result.allowed) {
        return res.status(403).json({
          error: `Access denied: ${permissionKey}`,
          code: 'forbidden',
          reason: result.reason,
        });
      }

      // Attach context for downstream handlers
      req.channelRbac = {
        permissionKey,
        action,
        allowed: true,
        reason: result.reason,
      };

      next();
    } catch (err) {
      console.error('[channel-rbac-mw] requireSecureChannelAccess error:', err);
      res.status(500).json({ error: 'Internal permission check error', code: 'internal' });
    }
  };
}

// ── requireSecurityRole ──────────────────────────────────────────────────────

/**
 * Middleware that requires a minimum security level for the user.
 * Does NOT require a specific channel — checks at server level.
 *
 * @param {number} minLevel - Minimum SecurityLevel value (e.g. SecurityLevel.ADMIN = 80)
 * @returns {Function} Express middleware
 */
export function requireSecurityRole(minLevel) {
  return (req, res, next) => {
    try {
      const db = req.db;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });

      const serverId = req.params.id || req.params.sid;
      if (!serverId) {
        return res.status(400).json({ error: 'Missing server ID', code: 'bad_request' });
      }

      const secLevel = resolveSecurityLevel({ userId, serverId, db });

      if (secLevel < minLevel) {
        const levelNames = Object.entries(SecurityLevel).find(([, v]) => v === minLevel);
        const requiredName = levelNames ? levelNames[0] : `level_${minLevel}`;
        return res.status(403).json({
          error: `Requires security role: ${requiredName} (level ${minLevel}+)`,
          code: 'forbidden',
          current_level: secLevel,
          required_level: minLevel,
        });
      }

      req.securityLevel = secLevel;
      next();
    } catch (err) {
      console.error('[channel-rbac-mw] requireSecurityRole error:', err);
      res.status(500).json({ error: 'Internal permission check error', code: 'internal' });
    }
  };
}

// ── requireSecureChannelOnly ─────────────────────────────────────────────────

/**
 * Middleware that ensures the target channel is a secure channel.
 * Rejects requests targeting non-secure channels.
 *
 * @returns {Function} Express middleware
 */
export function requireSecureChannelOnly() {
  return (req, res, next) => {
    try {
      const db = req.db;
      const { serverId, channelId } = extractServerAndChannel(req);
      if (!serverId || !channelId) {
        return res.status(400).json({ error: 'Missing server or channel ID', code: 'bad_request' });
      }

      const channel = db.prepare('SELECT is_secure FROM channels WHERE id = ? AND server_id = ?')
        .get(channelId, serverId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found', code: 'not_found' });
      }
      if (!channel.is_secure) {
        return res.status(403).json({ error: 'This operation requires a secure channel', code: 'not_secure' });
      }

      next();
    } catch (err) {
      console.error('[channel-rbac-mw] requireSecureChannelOnly error:', err);
      res.status(500).json({ error: 'Internal error', code: 'internal' });
    }
  };
}
