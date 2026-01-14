/**
 * Rate Limiting Middleware for Dashboard
 * 
 * ARCHITECTURE DECISION (Phase 5 Decomposition):
 * Extracted from monolithic dashboard.js to improve maintainability.
 * This module handles:
 * - Per-feature rate limiting (snapshots, analytics, AI, alerts)
 * - Free vs Pro tier enforcement
 * - In-memory rate limit state management
 */

/**
 * Create rate limiting middleware factory
 * @param {Object} options - Configuration options
 * @param {Object} options.bot - Bot instance for database access
 */
function createRateLimitMiddleware(options = {}) {
    const { bot } = options;

    // In-memory rate limit state
    const limitState = { counters: new Map() };
    
    // Rate limit configuration by tier
    const limitConfig = {
        free: {
            snapshots_interval_ms: 30 * 60 * 1000,      // 30 minutes
            analytics_min_interval_ms: 30 * 1000,       // 30 seconds
            ai_daily_max: 50,                           // 50 scans per day
            alerts_min_interval_ms: 60 * 1000           // 1 minute
        },
        pro: {
            snapshots_interval_ms: 0,                   // No limit
            analytics_min_interval_ms: 0,               // No limit
            ai_daily_max: Infinity,                     // Unlimited
            alerts_min_interval_ms: 0                   // No limit
        }
    };

    /**
     * Enforce rate limits based on user tier
     * @param {string} guildId - Guild ID for rate limiting scope
     * @param {string} feature - Feature being rate limited
     * @param {string} userId - User ID for tier lookup
     * @returns {Object} { ok: boolean, error?: string }
     */
    async function enforceLimits(guildId, feature, userId) {
        try {
            const user = await bot.database.get(`SELECT is_pro FROM users WHERE id = ?`, [userId]);
            const tier = (user && user.is_pro) ? 'pro' : 'free';
            const now = Date.now();
            const key = `${guildId}:${feature}`;
            const c = limitState.counters.get(key) || { lastAt: 0, dayCount: 0, dayStart: now };
            
            // Reset daily window
            if (now - c.dayStart > 24 * 60 * 60 * 1000) { 
                c.dayStart = now; 
                c.dayCount = 0; 
            }
            
            const cfg = limitConfig[tier];
            
            if (feature === 'snapshots') {
                if (cfg.snapshots_interval_ms && (now - c.lastAt < cfg.snapshots_interval_ms)) {
                    return { ok: false, error: 'Snapshots limited in Free (30 min interval). Upgrade for unlimited.' };
                }
                c.lastAt = now;
            } else if (feature === 'analytics') {
                if (cfg.analytics_min_interval_ms && (now - c.lastAt < cfg.analytics_min_interval_ms)) {
                    return { ok: false, error: 'Analytics refresh limited in Free (30s minimum). Upgrade for real-time.' };
                }
                c.lastAt = now;
            } else if (feature === 'ai_scan') {
                if (isFinite(cfg.ai_daily_max) && (c.dayCount + 1 > cfg.ai_daily_max)) {
                    return { ok: false, error: 'AI scans limited in Free (50/day). Upgrade for unlimited.' };
                }
                c.dayCount += 1; 
                c.lastAt = now;
            } else if (feature === 'alerts') {
                if (cfg.alerts_min_interval_ms && (now - c.lastAt < cfg.alerts_min_interval_ms)) {
                    return { ok: false, error: 'Alerts limited in Free (1/min). Upgrade for unlimited.' };
                }
                c.lastAt = now;
            }
            
            limitState.counters.set(key, c);
            return { ok: true };
        } catch (e) {
            console.error('[RateLimit] Error enforcing limits:', e);
            return { ok: true }; // Fail open on errors
        }
    }

    /**
     * Create Express middleware for a specific feature
     * @param {string} feature - Feature name for rate limiting
     */
    function createFeatureLimit(feature) {
        return async (req, res, next) => {
            const userId = req.user?.userId;
            const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
            
            if (!userId || !guildId) {
                return next(); // Let auth middleware handle missing user
            }
            
            const result = await enforceLimits(guildId, feature, userId);
            if (!result.ok) {
                return res.status(429).json({ error: result.error });
            }
            next();
        };
    }

    /**
     * Cleanup old rate limit entries periodically
     */
    function startCleanupInterval() {
        return setInterval(() => {
            const now = Date.now();
            for (const [key, data] of limitState.counters.entries()) {
                // Remove entries older than 24 hours with no activity
                if (now - data.lastAt > 24 * 60 * 60 * 1000) {
                    limitState.counters.delete(key);
                }
            }
        }, 60000); // Run every minute
    }

    return {
        enforceLimits,
        createFeatureLimit,
        startCleanupInterval,
        limitConfig,
        limitState
    };
}

module.exports = { createRateLimitMiddleware };
