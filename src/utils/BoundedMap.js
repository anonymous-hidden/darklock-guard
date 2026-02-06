/**
 * BoundedMap — A Map with automatic TTL expiry and size limits.
 * 
 * Security Rule 3: Every in-memory tracking structure must be bounded.
 * This replaces raw `new Map()` in all security modules.
 * 
 * Features:
 *  - maxSize: evicts oldest entries when exceeded (LRU-ish)
 *  - ttlMs: entries auto-expire after this duration
 *  - cleanup interval: runs every `cleanupIntervalMs` to prune expired entries
 *  - onEvict callback: optional, called when entries are removed
 *  - stats(): returns size, evictions, hits for diagnostics
 * 
 * @example
 *   const tracker = new BoundedMap({ maxSize: 10000, ttlMs: 60_000 });
 *   tracker.set('key', value);
 *   tracker.get('key'); // refreshes TTL
 */

class BoundedMap {
    /**
     * @param {Object} options
     * @param {number} [options.maxSize=10000] - Maximum entries before eviction
     * @param {number} [options.ttlMs=600000] - Time-to-live per entry in ms (default 10 min)
     * @param {number} [options.cleanupIntervalMs=60000] - How often to run cleanup (default 1 min)
     * @param {Function} [options.onEvict] - Called with (key, value) when an entry is evicted
     * @param {string} [options.name='BoundedMap'] - Name for diagnostics
     */
    constructor(options = {}) {
        this.maxSize = options.maxSize ?? 10000;
        this.ttlMs = options.ttlMs ?? 600000;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
        this.onEvict = options.onEvict ?? null;
        this.name = options.name ?? 'BoundedMap';

        this._map = new Map();        // key → value
        this._timestamps = new Map(); // key → lastAccessMs
        this._evictions = 0;
        this._hits = 0;
        this._misses = 0;

        // Auto-cleanup interval
        this._cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
        // Prevent the timer from keeping the process alive
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }

    /**
     * Get a value. Returns undefined if expired or missing.
     */
    get(key) {
        if (!this._map.has(key)) {
            this._misses++;
            return undefined;
        }

        const ts = this._timestamps.get(key);
        if (ts && (Date.now() - ts) > this.ttlMs) {
            // Expired — remove and return undefined
            this._evict(key);
            this._misses++;
            return undefined;
        }

        // Refresh timestamp on access
        this._timestamps.set(key, Date.now());
        this._hits++;
        return this._map.get(key);
    }

    /**
     * Set a value. Evicts oldest entries if maxSize exceeded.
     */
    set(key, value) {
        // If key already exists, just update
        if (this._map.has(key)) {
            this._map.set(key, value);
            this._timestamps.set(key, Date.now());
            return this;
        }

        // Evict oldest if at capacity
        if (this._map.size >= this.maxSize) {
            this._evictOldest();
        }

        this._map.set(key, value);
        this._timestamps.set(key, Date.now());
        return this;
    }

    /**
     * Check if key exists and is not expired.
     */
    has(key) {
        if (!this._map.has(key)) return false;
        const ts = this._timestamps.get(key);
        if (ts && (Date.now() - ts) > this.ttlMs) {
            this._evict(key);
            return false;
        }
        return true;
    }

    /**
     * Delete a specific key.
     */
    delete(key) {
        const existed = this._map.has(key);
        this._map.delete(key);
        this._timestamps.delete(key);
        return existed;
    }

    /**
     * Get current size (including potentially expired entries before cleanup).
     */
    get size() {
        return this._map.size;
    }

    /**
     * Iterate over non-expired entries.
     */
    *entries() {
        const now = Date.now();
        for (const [key, value] of this._map) {
            const ts = this._timestamps.get(key) ?? 0;
            if ((now - ts) <= this.ttlMs) {
                yield [key, value];
            }
        }
    }

    keys() {
        return this._map.keys();
    }

    values() {
        return this._map.values();
    }

    forEach(fn) {
        const now = Date.now();
        for (const [key, value] of this._map) {
            const ts = this._timestamps.get(key) ?? 0;
            if ((now - ts) <= this.ttlMs) {
                fn(value, key, this);
            }
        }
    }

    /**
     * Remove all expired entries.
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, ts] of this._timestamps) {
            if ((now - ts) > this.ttlMs) {
                this._evict(key);
                cleaned++;
            }
        }
        return cleaned;
    }

    /**
     * Clear all entries.
     */
    clear() {
        this._map.clear();
        this._timestamps.clear();
    }

    /**
     * Destroy the cleanup interval. Call on shutdown.
     */
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this.clear();
    }

    /**
     * Diagnostics.
     */
    stats() {
        return {
            name: this.name,
            size: this._map.size,
            maxSize: this.maxSize,
            ttlMs: this.ttlMs,
            evictions: this._evictions,
            hits: this._hits,
            misses: this._misses,
            hitRate: this._hits + this._misses > 0
                ? (this._hits / (this._hits + this._misses) * 100).toFixed(1) + '%'
                : 'N/A'
        };
    }

    /** @private */
    _evict(key) {
        const value = this._map.get(key);
        this._map.delete(key);
        this._timestamps.delete(key);
        this._evictions++;
        if (this.onEvict) {
            try { this.onEvict(key, value); } catch (_) {}
        }
    }

    /** @private */
    _evictOldest() {
        // Find and remove the entry with the oldest timestamp
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [key, ts] of this._timestamps) {
            if (ts < oldestTs) {
                oldestTs = ts;
                oldestKey = key;
            }
        }
        if (oldestKey !== null) {
            this._evict(oldestKey);
        }
    }
}

module.exports = BoundedMap;
