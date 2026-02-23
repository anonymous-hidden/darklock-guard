/**
 * Guild Access Guard Middleware
 * 
 * SECURITY FIX: Centralized guild access control for ALL dashboard endpoints
 * that accept a guildId parameter. Replaces scattered ad-hoc checks with
 * a single, fail-closed guard.
 * 
 * Usage:
 *   const { requireGuildAccess } = require('./middleware/guildGuard');
 *   app.post('/api/lockdown', requireGuildAccess(dashboard), handler);
 *   app.post('/api/settings/reset', requireGuildAccess(dashboard, { ownerOnly: true }), handler);
 */

'use strict';

/**
 * Validate a Discord snowflake ID
 * @param {string} id 
 * @returns {boolean}
 */
function isValidSnowflake(id) {
    return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * Extract guildId from request (params > query > body), validate it,
 * and attach it to req.guildId. Falls back to dashboard.getDefaultGuildId()
 * ONLY if the user is an admin (userId === 'admin').
 * 
 * @param {object} dashboard - The SecurityDashboard instance (has checkGuildAccess, getDefaultGuildId, bot)
 * @param {object} [opts]
 * @param {boolean} [opts.ownerOnly=false] - Require server owner (not just admin/manage perms)
 * @param {boolean} [opts.adminOnly=false] - Require Discord Administrator permission
 * @returns {Function} Express middleware
 */
function requireGuildAccess(dashboard, opts = {}) {
    const { ownerOnly = false, adminOnly = false } = opts;

    return async function _guildGuard(req, res, next) {
        try {
            // 1. Ensure user is authenticated (should already be by authenticateToken)
            if (!req.user || !req.user.userId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const userId = String(req.user.userId);

            // 2. Resolve guildId from multiple sources
            let guildId = req.params.guildId || req.query.guildId || req.body?.guildId;

            // Allow admin users to fall back to default guild
            if (!guildId && userId === 'admin' && typeof dashboard.getDefaultGuildId === 'function') {
                guildId = dashboard.getDefaultGuildId();
            }

            if (!guildId) {
                return res.status(400).json({ error: 'Guild ID is required' });
            }

            guildId = String(guildId);

            if (!isValidSnowflake(guildId)) {
                return res.status(400).json({ error: 'Invalid guild ID format' });
            }

            // 3. Admin (username/password login) role gets full access
            if (req.user.role === 'admin' && userId === 'admin') {
                req.guildId = guildId;
                return next();
            }

            // 4. Full guild access check (owner → DB grant → Discord perms → role grant)
            const access = await dashboard.checkGuildAccess(userId, guildId);

            if (!access || !access.authorized) {
                return res.status(403).json({
                    error: access?.error || 'You do not have access to this server'
                });
            }

            // 5. Owner-only gate
            if (ownerOnly && access.accessType !== 'owner') {
                return res.status(403).json({ error: 'Only the server owner can perform this action' });
            }

            // 6. Admin-only gate (require Discord Administrator, not just ManageGuild)
            if (adminOnly && access.accessType !== 'owner') {
                // For non-owners, verify Administrator permission specifically
                const guild = dashboard.bot.client.guilds.cache.get(guildId);
                if (guild) {
                    const member = access.member || await guild.members.fetch(userId).catch(() => null);
                    if (!member || !member.permissions.has('Administrator')) {
                        return res.status(403).json({ error: 'Administrator permission required' });
                    }
                }
            }

            // 7. Attach resolved guildId and access info to request
            req.guildId = guildId;
            req.guildAccess = access;
            next();
        } catch (error) {
            console.error('[GuildGuard] Access check error:', error.message);
            // Fail closed — deny access on error
            return res.status(500).json({ error: 'Authorization check failed' });
        }
    };
}

/**
 * LRU-style bounded Map with TTL eviction.
 * Replaces unbounded Map() caches to prevent memory leaks.
 */
class BoundedMap {
    /**
     * @param {number} maxSize - Maximum entries
     * @param {number} ttlMs - Time-to-live in milliseconds (0 = no TTL)
     */
    constructor(maxSize = 1000, ttlMs = 0) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this._map = new Map();
        this._expiry = ttlMs > 0 ? new Map() : null;
    }

    get(key) {
        if (this._expiry) {
            const exp = this._expiry.get(key);
            if (exp && Date.now() > exp) {
                this._map.delete(key);
                this._expiry.delete(key);
                return undefined;
            }
        }
        return this._map.get(key);
    }

    set(key, value) {
        // Evict oldest entries if at capacity
        if (this._map.size >= this.maxSize && !this._map.has(key)) {
            const oldest = this._map.keys().next().value;
            this._map.delete(oldest);
            if (this._expiry) this._expiry.delete(oldest);
        }
        this._map.set(key, value);
        if (this._expiry) {
            this._expiry.set(key, Date.now() + this.ttlMs);
        }
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    delete(key) {
        this._map.delete(key);
        if (this._expiry) this._expiry.delete(key);
    }

    get size() {
        return this._map.size;
    }

    clear() {
        this._map.clear();
        if (this._expiry) this._expiry.clear();
    }

    entries() {
        return this._map.entries();
    }

    keys() {
        return this._map.keys();
    }

    values() {
        return this._map.values();
    }

    [Symbol.iterator]() {
        return this._map[Symbol.iterator]();
    }

    /**
     * Clean up expired entries (call periodically)
     */
    prune() {
        if (!this._expiry) return 0;
        const now = Date.now();
        let pruned = 0;
        for (const [key, exp] of this._expiry) {
            if (now > exp) {
                this._map.delete(key);
                this._expiry.delete(key);
                pruned++;
            }
        }
        return pruned;
    }
}

module.exports = { requireGuildAccess, isValidSnowflake, BoundedMap };
