/**
 * Message merge helpers shared by store updates and node:test checks.
 */

/**
 * Upsert a single message into one session bucket.
 * Keeps insertion order stable and updates existing IDs in place.
 * @param {Array<any>} existing
 * @param {any} msg
 * @returns {Array<any>}
 */
export function appendMessageToSession(existing, msg) {
  const idx = existing.findIndex((m) => m.id === msg.id);
  if (idx !== -1) {
    const next = existing.slice();
    next[idx] = { ...existing[idx], ...msg };
    return next;
  }
  return [...existing, msg];
}

/**
 * Upsert many messages across session buckets.
 * @param {Record<string, Array<any>>} messagesBySession
 * @param {Array<any>} msgs
 * @returns {Record<string, Array<any>>}
 */
export function mergeMessagesBySession(messagesBySession, msgs) {
  const updated = { ...messagesBySession };
  for (const msg of msgs) {
    const existing = updated[msg.session_id] ?? [];
    updated[msg.session_id] = appendMessageToSession(existing, msg);
  }
  return updated;
}
