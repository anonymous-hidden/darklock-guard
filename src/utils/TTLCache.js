/**
 * In-memory key/value store with time-based expiration.
 */
class TTLCache {
    /**
     * @param {number} [defaultTTL=60000] Default time-to-live in milliseconds.
     */
    constructor(defaultTTL = 60000) {
        this.defaultTTL = Math.max(0, Number(defaultTTL) || 0);
        this.store = new Map();

        this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 1000);
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Store a value with an optional TTL override.
     * @param {string|number} key Cache key.
     * @param {*} value Value to store.
     * @param {number} [ttl] Optional TTL in milliseconds.
     */
    set(key, value, ttl) {
        const effectiveTtl = typeof ttl === 'number' && ttl >= 0 ? ttl : this.defaultTTL;
        const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : Infinity;

        this.store.set(key, { value, expiresAt });
    }

    /**
     * Retrieve a value if it has not expired.
     * @param {string|number} key Cache key.
     * @returns {*|undefined} Stored value or undefined when missing/expired.
     */
    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            return undefined;
        }

        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }

        return entry.value;
    }

    /**
     * Check whether a non-expired entry exists.
     * @param {string|number} key Cache key.
     * @returns {boolean} True when key exists and is not expired.
     */
    has(key) {
        const entry = this.store.get(key);
        if (!entry) {
            return false;
        }

        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete a cache entry.
     * @param {string|number} key Cache key.
     * @returns {boolean} True if an entry was deleted.
     */
    delete(key) {
        return this.store.delete(key);
    }

    /**
     * Remove all entries from the cache.
     */
    clear() {
        this.store.clear();
    }

    /**
     * Remove any expired entries.
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (entry.expiresAt <= now) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Current number of non-expired entries.
     * @returns {number}
     */
    get size() {
        this.cleanup();
        return this.store.size;
    }
}

module.exports = TTLCache;
