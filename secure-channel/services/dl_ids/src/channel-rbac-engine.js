/**
 * Channel-Based RBAC Engine
 *
 * Wraps the existing Discord-style permission system with:
 *  - Human-readable permission key mapping
 *  - Secure channel access enforcement
 *  - Security role hierarchy (owner → co_owner → admin → security_admin → moderator → trusted → user)
 *  - Per-user channel overrides (in addition to per-role overrides)
 *  - Lockdown mode enforcement
 *  - Audit trail integration for secure channels
 *
 * This engine ONLY applies to the messaging system and secure channels.
 * It does NOT redesign the platform RBAC — it layers on top of permissions.js.
 */

import { randomUUID } from 'crypto';
import {
  Permissions,
  ALL_PERMISSIONS,
  resolvePermissions,
  hasPermission,
} from './permissions.js';

// ── Security Role Hierarchy ──────────────────────────────────────────────────

export const SecurityLevel = Object.freeze({
  USER:           0,
  TRUSTED:        30,
  MODERATOR:      50,
  SECURITY_ADMIN: 70,
  ADMIN:          80,
  CO_OWNER:       90,
  OWNER:          100,
});

/** Minimum security level for each secure.* permission key. */
const SECURE_PERMISSION_THRESHOLDS = Object.freeze({
  'secure.view_logs':          SecurityLevel.SECURITY_ADMIN,  // 70+
  'secure.send_alerts':        SecurityLevel.SECURITY_ADMIN,  // 70+
  'secure.trigger_lockdown':   SecurityLevel.ADMIN,           // 80+
  'secure.override_security':  SecurityLevel.OWNER,           // 100 only
  'secure.full_access':        SecurityLevel.OWNER,           // 100 only
});

// ── Permission Key → Bitfield Mapping ────────────────────────────────────────

const PERMISSION_KEY_MAP = Object.freeze({
  'channel.view':            Permissions.VIEW_CHANNEL,
  'channel.send':            Permissions.SEND_MESSAGES,
  'channel.delete_messages':  Permissions.MANAGE_MESSAGES,
  'channel.manage':          Permissions.MANAGE_CHANNELS,
  'channel.attach_files':    Permissions.ATTACH_FILES,
  'channel.mention_everyone': Permissions.MENTION_EVERYONE,
  'channel.edit_own':        Permissions.EDIT_OWN_MESSAGES,
  'channel.manage_roles':    Permissions.MANAGE_ROLES,
});

/**
 * Map a permission key string to the permission bitfield value.
 * Returns null for secure.* keys (those use security level, not bitfield).
 */
export function permissionKeyToBit(key) {
  return PERMISSION_KEY_MAP[key] ?? null;
}

// ── Security Level Resolution ────────────────────────────────────────────────

/**
 * Compute the effective security level for a user in a server.
 *
 * Resolution order:
 * 1. Server owner → OWNER (100)
 * 2. Check explicit `security_level` on each of the user's roles; take the max
 * 3. If any role has is_admin → at least ADMIN (80)
 * 4. Fallback to USER (0)
 *
 * @param {{ userId: string, serverId: string, db: object }} params
 * @returns {number} Security level value
 */
export function resolveSecurityLevel({ userId, serverId, db }) {
  // Owner always gets max
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
  if (!server) return SecurityLevel.USER;
  if (server.owner_id === userId) return SecurityLevel.OWNER;

  const roles = db.prepare(`
    SELECT r.security_level, r.is_admin, r.position
    FROM roles r
    LEFT JOIN member_roles mr ON mr.role_id = r.id AND mr.user_id = ?
    WHERE r.server_id = ? AND (mr.user_id IS NOT NULL OR r.position = 0)
  `).all(userId, serverId);

  let maxLevel = SecurityLevel.USER;
  let isAdmin = false;

  for (const role of roles) {
    const sl = role.security_level ?? 0;
    if (sl > maxLevel) maxLevel = sl;
    if (role.is_admin) isAdmin = true;
  }

  // Ensure admins are at least ADMIN level
  if (isAdmin && maxLevel < SecurityLevel.ADMIN) {
    maxLevel = SecurityLevel.ADMIN;
  }

  return maxLevel;
}

// ── Per-User Channel Override Resolution ─────────────────────────────────────

/**
 * Apply per-user channel overrides on top of already-resolved channel permissions.
 * User overrides take priority over role overrides (Discord model).
 *
 * @param {{ userId: string, channelId: string, basePermissions: bigint, db: object }} params
 * @returns {bigint} Final permissions after user overrides
 */
export function applyUserOverrides({ userId, channelId, basePermissions, db }) {
  const ov = db.prepare(`
    SELECT allow_permissions, deny_permissions
    FROM channel_user_overrides
    WHERE channel_id = ? AND user_id = ?
  `).get(channelId, userId);

  if (!ov) return basePermissions;

  const allow = BigInt(ov.allow_permissions);
  const deny  = BigInt(ov.deny_permissions);

  // User overrides replace role overrides for the same bits (deny wins)
  let perms = basePermissions;
  perms |= allow;
  perms &= ~deny;
  return perms;
}

// ── Core RBAC Check ──────────────────────────────────────────────────────────

/**
 * Check if a user can perform an action in a channel.
 *
 * Handles both standard channel permissions (channel.*) and
 * secure channel permissions (secure.*).
 *
 * @param {{ userId: string, serverId: string, channelId: string, permissionKey: string, db: object }} params
 * @returns {{ allowed: boolean, reason: string, permissions?: bigint, securityLevel?: number, isSecure?: boolean }}
 */
export function canUserAccessChannel({ userId, serverId, channelId, permissionKey, db }) {
  // 1. Load channel metadata
  const channel = db.prepare('SELECT id, is_secure, lockdown, type FROM channels WHERE id = ? AND server_id = ?')
    .get(channelId, serverId);

  if (!channel) {
    return { allowed: false, reason: 'channel_not_found' };
  }

  const isSecure = !!channel.is_secure;

  // 2. Lockdown mode — only owner + co_owner (security_level >= 90) can access
  if (channel.lockdown) {
    const secLevel = resolveSecurityLevel({ userId, serverId, db });
    if (secLevel < SecurityLevel.CO_OWNER) {
      return {
        allowed: false,
        reason: 'channel_lockdown',
        securityLevel: secLevel,
        isSecure,
      };
    }
  }

  // 3. Handle secure.* permission keys
  if (permissionKey.startsWith('secure.')) {
    if (!isSecure) {
      return { allowed: false, reason: 'not_a_secure_channel', isSecure: false };
    }

    const threshold = SECURE_PERMISSION_THRESHOLDS[permissionKey];
    if (threshold === undefined) {
      return { allowed: false, reason: 'unknown_secure_permission' };
    }

    const secLevel = resolveSecurityLevel({ userId, serverId, db });
    const allowed = secLevel >= threshold;
    return {
      allowed,
      reason: allowed ? 'security_level_sufficient' : 'security_level_insufficient',
      securityLevel: secLevel,
      isSecure,
    };
  }

  // 4. Handle channel.* permission keys → map to bitfield
  const bit = permissionKeyToBit(permissionKey);
  if (bit === null) {
    return { allowed: false, reason: 'unknown_permission_key' };
  }

  // 5. Resolve standard permissions (includes role-based channel overrides)
  const { permissions: rolePerms, isOwner, isAdmin } = resolvePermissions({
    userId,
    serverId,
    channelId,
    db,
  });

  // Owner / admin bypass
  if (isOwner || isAdmin) {
    return {
      allowed: true,
      reason: isOwner ? 'owner_bypass' : 'admin_bypass',
      permissions: ALL_PERMISSIONS,
      isSecure,
    };
  }

  // 6. Apply per-user channel overrides on top
  const finalPerms = applyUserOverrides({
    userId,
    channelId,
    basePermissions: rolePerms,
    db,
  });

  // 7. For secure channels, additionally require VIEW_CHANNEL even for other perms
  if (isSecure && permissionKey !== 'channel.view') {
    if (!hasPermission(finalPerms, Permissions.VIEW_CHANNEL)) {
      return {
        allowed: false,
        reason: 'secure_channel_no_view_access',
        permissions: finalPerms,
        isSecure,
      };
    }
  }

  // 8. Check the actual permission bit
  const allowed = hasPermission(finalPerms, bit);
  return {
    allowed,
    reason: allowed ? 'permission_granted' : 'permission_denied',
    permissions: finalPerms,
    isSecure,
  };
}

// ── Secure Channel Audit Logger ──────────────────────────────────────────────

/**
 * Log an action to the secure_channel_audit table.
 * Only logs for secure channels or security-related actions.
 *
 * @param {object} db - better-sqlite3 instance
 * @param {{ serverId: string, channelId: string, userId: string, action: string, permissionChecked?: string, result: 'allowed'|'denied', metadata?: object, ip?: string, userAgent?: string }} entry
 */
export function logSecureAudit(db, { serverId, channelId, userId, action, permissionChecked, result, metadata, ip, userAgent }) {
  try {
    db.prepare(`
      INSERT INTO secure_channel_audit (id, server_id, channel_id, user_id, action, permission_checked, result, metadata_json, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      randomUUID(),
      serverId,
      channelId,
      userId,
      action,
      permissionChecked ?? null,
      result,
      metadata ? JSON.stringify(metadata) : null,
      ip ?? null,
      userAgent ?? null,
    );
  } catch (err) {
    console.error('[channel-rbac] Failed to log secure audit:', err.message);
  }
}

// ── Convenience: Batch Check for Channel Visibility ──────────────────────────

/**
 * Filter a list of channels to only those the user can view.
 * More efficient than calling canUserAccessChannel for each channel individually.
 *
 * @param {{ userId: string, serverId: string, channels: Array<{id: string}>, db: object }} params
 * @returns {Array} Visible channels
 */
export function filterVisibleChannels({ userId, serverId, channels, db }) {
  // Owner + admin shortcuts
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
  if (!server) return [];
  if (server.owner_id === userId) return channels;

  // Check admin status once
  const { permissions: serverPerms, isAdmin } = resolvePermissions({ userId, serverId, channelId: null, db });
  if (isAdmin) return channels;

  return channels.filter((ch) => {
    const { permissions } = resolvePermissions({ userId, serverId, channelId: ch.id, db });
    const finalPerms = applyUserOverrides({ userId, channelId: ch.id, basePermissions: permissions, db });
    return hasPermission(finalPerms, Permissions.VIEW_CHANNEL);
  });
}
