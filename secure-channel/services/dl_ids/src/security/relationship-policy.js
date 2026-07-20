export function normalizeUserId(value) {
  return String(value ?? '').trim();
}

export function resolveUserIdByIdOrUsername(db, idOrUsername) {
  const lookup = normalizeUserId(idOrUsername).toLowerCase();
  if (!lookup) return null;
  const row = db.prepare(
    'SELECT id FROM users WHERE id = ? OR username = ? LIMIT 1'
  ).get(lookup, lookup);
  return typeof row?.id === 'string' ? row.id : null;
}

export function userExists(db, userId) {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1').get(userId);
}

export function areFriends(db, a, b) {
  return !!db.prepare(`
    SELECT 1
    FROM friend_requests
    WHERE status = 'accepted'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
    LIMIT 1
  `).get(a, b, b, a);
}

export function areUsersBlocked(db, a, b) {
  return !!db.prepare(`
    SELECT 1
    FROM user_blocks
    WHERE (blocker_user_id = ? AND blocked_user_id = ?)
       OR (blocker_user_id = ? AND blocked_user_id = ?)
    LIMIT 1
  `).get(a, b, b, a);
}

export function sharesServerMembership(db, a, b) {
  return !!db.prepare(`
    SELECT 1
    FROM server_members sa
    JOIN server_members sb ON sb.server_id = sa.server_id
    WHERE sa.user_id = ?
      AND sb.user_id = ?
    LIMIT 1
  `).get(a, b);
}

export function canAccessUserRelationshipData(db, requesterId, targetUserId, options = {}) {
  const fromUserId = normalizeUserId(requesterId);
  const toUserId = normalizeUserId(targetUserId);
  const allowSharedServer = options.allowSharedServer !== false;

  if (!fromUserId || !toUserId) {
    return { ok: false, code: 'forbidden', error: 'target_not_allowed' };
  }
  if (fromUserId === toUserId) {
    return { ok: true };
  }
  if (!userExists(db, toUserId)) {
    // Generic error avoids revealing target existence.
    return { ok: false, code: 'forbidden', error: 'target_not_allowed' };
  }
  if (areUsersBlocked(db, fromUserId, toUserId)) {
    return { ok: false, code: 'forbidden', error: 'target_not_allowed' };
  }
  if (areFriends(db, fromUserId, toUserId)) {
    return { ok: true };
  }
  if (allowSharedServer && sharesServerMembership(db, fromUserId, toUserId)) {
    return { ok: true };
  }

  return { ok: false, code: 'forbidden', error: 'target_not_allowed' };
}
