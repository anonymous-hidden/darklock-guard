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
    'anti_nuke_enabled',
    'anti_phishing_enabled',
    'antinuke_enabled',
    'advanced_analytics',
    'advanced_anti_raid_enabled',
    'advanced_anti_spam_enabled',
    'api_access',
    'backup_enabled',
    'custom_commands_enabled',
    'custom_filters_enabled',
    'behavior_analysis_enabled',
    'advanced_filters_enabled',
    'modmail_enabled',
    'scheduled_backups_enabled',
    'push_notifications_enabled',
    'webhook_protection_enabled',
]);

// Enterprise is supported for existing records, but current paid features are Pro.
const ENTERPRISE_FEATURES = new Set();

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
function normalizeTier(tier) {
    const normalized = String(tier || 'free').toLowerCase();
    return ['free', 'pro', 'enterprise'].includes(normalized) ? normalized : 'free';
}

function subscriptionIsActive(record) {
    if (!record) return false;

    const status = String(record.status || '').toLowerCase();
    if (!['active', 'trialing'].includes(status)) return false;

    const rawPeriodEnd = record.current_period_end ?? record.currentPeriodEnd ?? record.expires_at ?? record.expiresAt;
    if (!rawPeriodEnd) return true;

    const periodEnd = Number(rawPeriodEnd);
    if (!Number.isFinite(periodEnd)) return true;

    const periodEndSeconds = periodEnd > 100000000000 ? Math.floor(periodEnd / 1000) : periodEnd;
    return periodEndSeconds > Math.floor(Date.now() / 1000);
}

async function resolveGuildTier(bot, guildId) {
    if (!bot || !guildId) return 'free';

    try {
        if (typeof bot.getGuildPlan === 'function') {
            const plan = await bot.getGuildPlan(guildId);
            if (plan?.is_active || subscriptionIsActive(plan)) {
                return normalizeTier(plan.effectivePlan || plan.plan);
            }
            return 'free';
        }

        if (bot.database && typeof bot.database.getGuildSubscription === 'function') {
            const record = await bot.database.getGuildSubscription(guildId);
            if (subscriptionIsActive(record)) {
                return normalizeTier(record.plan);
            }
        }
    } catch (error) {
        bot.logger?.warn?.('Failed to resolve guild tier:', error.message || error);
    }

    return 'free';
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
    const requiredTier = minTier === 'enterprise' ? 'pro' : minTier;

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
        if ((tierRank[tier] || 0) < (tierRank[requiredTier] || 0)) {
            return res.status(403).json({
                error: `This feature requires the ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} plan`,
                currentTier: tier,
                requiredTier,
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
