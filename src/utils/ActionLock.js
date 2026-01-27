const TTLCache = require('./TTLCache');

/**
 * Prevents multiple security systems from punishing the same user simultaneously.
 */
class ActionLock {
    /**
     * @param {number} [lockDuration=5000] Lock duration in milliseconds.
     */
    constructor(lockDuration = 5000) {
        this.lockDuration = Math.max(0, Number(lockDuration) || 0);
        this.cache = new TTLCache(this.lockDuration);

        const interval = Math.max(1000, Math.min(this.lockDuration || 5000, 30000));
        this.cleanupInterval = setInterval(() => this.cleanup(), interval);
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Attempt to acquire a lock for a guild/user pair.
     * @param {string} guildId Guild identifier.
     * @param {string} userId User identifier.
     * @param {string} [action='unknown'] Action label for context.
     * @returns {boolean} True if lock acquired; false otherwise.
     */
    tryLock(guildId, userId, action = 'unknown') {
        const key = this.buildKey(guildId, userId);
        if (!key) {
            return false;
        }

        this.cleanup();

        if (this.cache.has(key)) {
            return false;
        }

        this.cache.set(key, { action, createdAt: Date.now() }, this.lockDuration);
        return true;
    }

    /**
     * Manually release a lock.
     * @param {string} guildId Guild identifier.
     * @param {string} userId User identifier.
     * @returns {boolean} True if a lock was removed.
     */
    unlock(guildId, userId) {
        const key = this.buildKey(guildId, userId);
        if (!key) {
            return false;
        }

        return this.cache.delete(key);
    }

    /**
     * Check whether a guild/user pair is currently locked.
     * @param {string} guildId Guild identifier.
     * @param {string} userId User identifier.
     * @returns {boolean} True if locked and not expired.
     */
    isLocked(guildId, userId) {
        const key = this.buildKey(guildId, userId);
        if (!key) {
            return false;
        }

        this.cleanup();
        return this.cache.has(key);
    }

    /**
     * Remove expired locks.
     */
    cleanup() {
        this.cache.cleanup();
    }

    /**
     * Build the composite key for a guild/user pair.
     * @param {string} guildId Guild identifier.
     * @param {string} userId User identifier.
     * @returns {string|null} Composite cache key or null when ids are missing.
     * @private
     */
    buildKey(guildId, userId) {
        if (!guildId || !userId) {
            return null;
        }

        return `${guildId}_${userId}`;
    }
}

module.exports = ActionLock;
