/**
 * Simple in-memory rate limiter tailored for channel-delete bursts.
 */
const DEFAULT_WINDOW = 1500; // ms
const DEFAULT_THRESHOLD = 3;

class RateLimiter {
  constructor({ windowMs = DEFAULT_WINDOW, threshold = DEFAULT_THRESHOLD } = {}) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    // Map<guildId, Map<userId, Array<timestamp>>>
    this.map = new Map();
  }

  _getUserArray(guildId, userId) {
    if (!this.map.has(guildId)) this.map.set(guildId, new Map());
    const g = this.map.get(guildId);
    if (!g.has(userId)) g.set(userId, []);
    return g.get(userId);
  }

  record(guildId, userId) {
    const arr = this._getUserArray(guildId, userId);
    const now = Date.now();
    arr.push(now);
    // prune
    const cutoff = now - this.windowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
    return arr.length >= this.threshold;
  }

  clear(guildId, userId) {
    if (!this.map.has(guildId)) return;
    const g = this.map.get(guildId);
    g.delete(userId);
  }
}

module.exports = RateLimiter;
