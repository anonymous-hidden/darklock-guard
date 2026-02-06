/**
 * TierEnforcementMiddleware
 * Server-side enforcement of feature access based on guild subscription tier.
 * 
 * This is the SINGLE authority for tier-gating. No other code path should
 * independently decide whether a feature is available on a given tier.
 * 
 * Usage:
 *   const { enforceTierLimits, requireTier } = require('./tier-enforcement');
 *   
 *   // As route middleware (blocks the request if guild is below required tier):
 *   router.post('/some-pro-feature', authenticateToken, requireTier('pro'), handler);
 *   
 *   // As a settings gate (returns which keys are blocked):
 *   const result = await enforceTierLimits(bot, guildId, settingUpdates);
 */

// Features that require at least Pro tier to enable
const PRO_FEATURES = new Set([
    'ai_enabled',
    'advanced_analytics',
    'api_access',
    'behavior_analysis_enabled',
    'advanced_filters_enabled',
    'push_notifications_enabled',
]);

// Features that require Enterprise tier to enable
const ENTERPRISE_FEATURES = new Set([
    'whitelabel_enabled',
    'custom_integrations_enabled',
    'sla_enabled',
]);

// Settings that free-tier guilds cannot modify (locked to default)
const FREE_LOCKED_SETTINGS = new Set([
    'security_mode',
    ...PRO_FEATURES,
    ...ENTERPRISE_FEATURES,
]);

// Settings that pro-tier guilds cannot modify
const PRO_LOCKED_SETTINGS = new Set([
    ...ENTERPRISE_FEATURES,
]);

// Numeric limits per tier
const TIER_LIMITS = {
    free: {
        protected_roles_max: 3,
        custom_filters_max: 5,
        backup_slots_max: 1,
    },
    pro: {
        protected_roles_max: 25,
        custom_filters_max: 50,
        backup_slots_max: 10,
    },
    enterprise: {
        protected_roles_max: Infinity,
        custom_filters_max: Infinity,
        backup_slots_max: Infinity,
    },
};

/**
 * Resolve the effective tier for a guild.
 * Returns 'free' | 'pro' | 'enterprise'
 */
async function resolveGuildTier(bot, guildId) {
    try {
        const sub = await bot.getGuildPlan(guildId);
        return sub.effectivePlan || 'free';
    } catch {
        return 'free'; // fail-closed
    }
}

/**
 * Check which settings in an update payload are blocked by the guild's tier.
 * 
 * @param {object} bot - Bot instance
 * @param {string} guildId
 * @param {object} updates - Key/value pairs being written
 * @returns {{ allowed: object, blocked: string[], tier: string, requiredTier: string|null }}
 */
async function enforceTierLimits(bot, guildId, updates) {
    const tier = await resolveGuildTier(bot, guildId);
    const blocked = [];
    const allowed = {};
    let requiredTier = null;

    for (const [key, value] of Object.entries(updates)) {
        // Check enterprise-only features
        if (ENTERPRISE_FEATURES.has(key) && value && tier !== 'enterprise') {
            blocked.push(key);
            requiredTier = 'enterprise';
            continue;
        }

        // Check pro-only features
        if (PRO_FEATURES.has(key) && value && tier === 'free') {
            blocked.push(key);
            if (!requiredTier) requiredTier = 'pro';
            continue;
        }

        // Check free-locked settings (can't even change the value)
        if (tier === 'free' && FREE_LOCKED_SETTINGS.has(key)) {
            blocked.push(key);
            if (!requiredTier) requiredTier = 'pro';
            continue;
        }

        // Check pro-locked settings
        if (tier === 'pro' && PRO_LOCKED_SETTINGS.has(key)) {
            blocked.push(key);
            requiredTier = 'enterprise';
            continue;
        }

        allowed[key] = value;
    }

    return { allowed, blocked, tier, requiredTier };
}

/**
 * Express middleware factory: reject requests if guild is below required tier.
 * Expects req.params.guildId and req.app.locals.bot or dashboard.bot to exist.
 * 
 * @param {string} minTier - 'pro' | 'enterprise'
 */
function requireTier(minTier) {
    const tierRank = { free: 0, pro: 1, enterprise: 2 };

    return async (req, res, next) => {
        const guildId = req.params.guildId;
        if (!guildId) {
            return res.status(400).json({ error: 'Guild ID required' });
        }

        const bot = req.app.locals.bot || req.dashboard?.bot;
        if (!bot) {
            return res.status(500).json({ error: 'Server misconfigured' });
        }

        const tier = await resolveGuildTier(bot, guildId);
        if ((tierRank[tier] || 0) < (tierRank[minTier] || 0)) {
            return res.status(403).json({
                error: `This feature requires the ${minTier.charAt(0).toUpperCase() + minTier.slice(1)} plan`,
                currentTier: tier,
                requiredTier: minTier,
                code: 'TIER_LIMIT_EXCEEDED',
            });
        }

        req.guildTier = tier;
        next();
    };
}

/**
 * Apply tier constraints to a resolved config object.
 * Masks features the guild's tier does not include, returning the effective config.
 * 
 * @param {object} config - Raw config from DB
 * @param {string} tier - 'free' | 'pro' | 'enterprise'
 * @returns {object} effective config with tier-locked features forced off
 */
function applyTierMask(config, tier) {
    const effective = { ...config };

    if (tier === 'free') {
        for (const key of PRO_FEATURES) {
            effective[key] = false;
        }
        for (const key of ENTERPRISE_FEATURES) {
            effective[key] = false;
        }
    } else if (tier === 'pro') {
        for (const key of ENTERPRISE_FEATURES) {
            effective[key] = false;
        }
    }

    return effective;
}

module.exports = {
    enforceTierLimits,
    requireTier,
    applyTierMask,
    resolveGuildTier,
    TIER_LIMITS,
    PRO_FEATURES,
    ENTERPRISE_FEATURES,
};
