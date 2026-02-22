/**
 * Permission Bitfield Constants & Resolution
 *
 * Discord-style bitfield permission system.
 * Each permission is a single bit in a BigInt.
 */

// ── Permission Flags ─────────────────────────────────────────────────────────

export const Permissions = Object.freeze({
  VIEW_CHANNEL:       1n << 0n,
  SEND_MESSAGES:      1n << 1n,
  DELETE_MESSAGES:     1n << 2n,
  EDIT_MESSAGES:      1n << 3n,
  MANAGE_CHANNELS:    1n << 4n,
  MANAGE_ROLES:       1n << 5n,
  MANAGE_SERVER:      1n << 6n,
  BAN_MEMBERS:        1n << 7n,
  KICK_MEMBERS:       1n << 8n,
  MENTION_EVERYONE:   1n << 9n,
  ATTACH_FILES:       1n << 10n,
  CREATE_INVITES:     1n << 11n,
  // ── v2 additions ──────────────────────────────────────────
  ADMINISTRATOR:      1n << 12n,  // Bypass all permission checks (high-risk)
  MANAGE_MESSAGES:    1n << 13n,  // Pin/unpin, delete others' messages
  EDIT_OWN_MESSAGES:  1n << 14n,  // Edit own messages only
  VIEW_AUDIT_LOG:     1n << 15n,  // View server audit log
});

/** Every permission bit OR'ed together. */
export const ALL_PERMISSIONS = Object.values(Permissions).reduce((acc, p) => acc | p, 0n);

/** Default permissions for @everyone role. */
export const DEFAULT_PERMISSIONS =
  Permissions.VIEW_CHANNEL |
  Permissions.SEND_MESSAGES |
  Permissions.ATTACH_FILES |
  Permissions.CREATE_INVITES |
  Permissions.EDIT_OWN_MESSAGES;

/** Human-readable permission names keyed by bit value (string). */
export const PERMISSION_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(Permissions).map(([k, v]) => [v.toString(), k]))
);

// ── Helper Functions ─────────────────────────────────────────────────────────

/** Check if a bitfield has a specific permission. */
export function hasPermission(bitfield, permission) {
  const bf = BigInt(bitfield);
  const perm = BigInt(permission);
  return (bf & perm) === perm;
}

/** Check if a bitfield has ALL the given permissions. */
export function hasAllPermissions(bitfield, permissions) {
  const bf = BigInt(bitfield);
  for (const p of permissions) {
    if ((bf & BigInt(p)) !== BigInt(p)) return false;
  }
  return true;
}

// ── Permission Resolution ────────────────────────────────────────────────────

/**
 * Resolve effective permissions for a user in a server/channel.
 *
 * Order of operations (Discord model):
 * 1. Server owner → ALL permissions, skip everything.
 * 2. Combine all role permissions (bitwise OR).
 * 3. If any role has is_admin → ALL permissions.
 * 4. Apply channel overrides:
 *    a. Start with base permissions from step 2/3.
 *    b. For each role the user has, apply allow | deny overrides.
 *    c. DENY always wins over ALLOW when both exist.
 * 5. Return final computed permissions.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.serverId
 * @param {string|null} params.channelId - null for server-level permissions
 * @param {object} params.db - better-sqlite3 database instance
 * @returns {{ permissions: bigint, isOwner: boolean, isAdmin: boolean }}
 */
export function resolvePermissions({ userId, serverId, channelId, db }) {
  // 1. Check owner
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    console.warn('[permissions] resolvePermissions: server NOT FOUND serverId=%s userId=%s', serverId, userId);
    return { permissions: 0n, isOwner: false, isAdmin: false, notFound: true };
  }

  if (server.owner_id === userId) {
    console.log('[permissions] resolvePermissions: OWNER userId=%s serverId=%s => ALL_PERMISSIONS', userId, serverId);
    return { permissions: ALL_PERMISSIONS, isOwner: true, isAdmin: true, notFound: false };
  }

  // 2. Get all roles for user in this server (including @everyone)
  const userRoles = db.prepare(`
    SELECT r.id, r.permissions, r.is_admin, r.position
    FROM roles r
    LEFT JOIN member_roles mr ON mr.role_id = r.id AND mr.user_id = ?
    WHERE r.server_id = ? AND (mr.user_id IS NOT NULL OR r.position = 0)
    ORDER BY r.position ASC
  `).all(userId, serverId);

  console.log('[permissions] resolvePermissions: userId=%s serverId=%s channelId=%s roles=%d', userId, serverId, channelId, userRoles.length);

  if (userRoles.length === 0) {
    console.warn('[permissions] resolvePermissions: NO ROLES (not a member?) userId=%s serverId=%s', userId, serverId);
    return { permissions: 0n, isOwner: false, isAdmin: false, notFound: false };
  }

  // 3. Combine role permissions
  let basePerms = 0n;
  let isAdmin = false;

  for (const role of userRoles) {
    const rp = BigInt(role.permissions);
    basePerms |= rp;
    // Admin via column flag OR via ADMINISTRATOR permission bit
    if (role.is_admin || (rp & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
      isAdmin = true;
    }
  }

  // Admin → all permissions, bypass channel overrides
  if (isAdmin) {
    console.log('[permissions] resolvePermissions: ADMIN userId=%s serverId=%s => ALL_PERMISSIONS', userId, serverId);
    return { permissions: ALL_PERMISSIONS, isOwner: false, isAdmin: true, notFound: false };
  }

  // 4. If no channel specified, return server-level permissions
  if (!channelId) {
    console.log('[permissions] resolvePermissions: SERVER-LEVEL userId=%s serverId=%s perms=%s', userId, serverId, basePerms.toString());
    return { permissions: basePerms, isOwner: false, isAdmin: false, notFound: false };
  }

  // 5. Apply channel permission overrides
  const roleIds = userRoles.map((r) => r.id);
  if (roleIds.length === 0) {
    return { permissions: basePerms, isOwner: false, isAdmin: false, notFound: false };
  }

  const placeholders = roleIds.map(() => '?').join(', ');
  const overrides = db.prepare(`
    SELECT role_id, allow_permissions, deny_permissions
    FROM channel_permission_overrides
    WHERE channel_id = ? AND role_id IN (${placeholders})
  `).all(channelId, ...roleIds);

  let allow = 0n;
  let deny = 0n;

  for (const ov of overrides) {
    allow |= BigInt(ov.allow_permissions);
    deny |= BigInt(ov.deny_permissions);
  }

  // Apply: start with base, add allowed, remove denied
  // Deny always wins when a bit appears in both allow and deny
  let channelPerms = basePerms;
  channelPerms |= allow;
  channelPerms &= ~deny;

  return { permissions: channelPerms, isOwner: false, isAdmin: false, notFound: false };
}

/**
 * Get the highest role position for a user in a server.
 * Used for hierarchy checks (editing/assigning roles).
 */
export function getHighestRolePosition({ userId, serverId, db }) {
  const result = db.prepare(`
    SELECT MAX(r.position) as max_pos
    FROM roles r
    JOIN member_roles mr ON mr.role_id = r.id
    WHERE mr.server_id = ? AND mr.user_id = ?
  `).get(serverId, userId);

  return result?.max_pos ?? 0;
}

/**
 * Check if user A can manage user B based on role hierarchy.
 * A can manage B if A's highest role position > B's highest role position,
 * OR if A is the server owner.
 */
export function canManageUser({ actorId, targetId, serverId, db }) {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId);
  if (!server) return false;
  if (server.owner_id === actorId) return true;
  if (server.owner_id === targetId) return false;

  const actorPos = getHighestRolePosition({ userId: actorId, serverId, db });
  const targetPos = getHighestRolePosition({ userId: targetId, serverId, db });

  return actorPos > targetPos;
}
