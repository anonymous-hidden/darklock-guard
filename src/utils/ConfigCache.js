const TTLCache = require('./TTLCache');

/**
 * Caches guild configurations with TTL to reduce database reads.
 */
class ConfigCache {
    /**
     * @param {Object} bot Bot instance with a database accessor.
     * @param {number} [ttl=60000] Cache TTL in milliseconds.
     */
    constructor(bot, ttl = 60000) {
        this.bot = bot;
        this.cache = new TTLCache(ttl);
    }

    /**
     * Get a guild configuration from cache or database.
     * @param {string} guildId Guild identifier.
     * @returns {Promise<Object|null|undefined>} Normalized guild config.
     */
    async get(guildId) {
        if (!guildId) {
            return undefined;
        }

        const cached = this.cache.get(guildId);
        if (cached !== undefined) {
            return cached;
        }

        const config = await this.bot.database.getGuildConfig(guildId);
        if (config == null) {
            return config;
        }

        const normalized = this.normalizeConfig(config);
        this.cache.set(guildId, normalized);
        return normalized;
    }

    /**
     * Invalidate a guild config entry.
     * @param {string} guildId Guild identifier.
     */
    invalidate(guildId) {
        if (!guildId) {
            return;
        }

        this.cache.delete(guildId);
    }

    /**
     * Normalize legacy and new field names to allow either variant.
     * @param {Object} config Raw config from the database.
     * @returns {Object} Normalized config.
     */
    normalizeConfig(config) {
        const normalized = { ...config };
        const keyPairs = [
            ['anti_spam_enabled', 'antispam_enabled'],
            ['anti_raid_enabled', 'antiraid_enabled'],
            ['antinuke_enabled', 'anti_nuke_enabled'],
            ['anti_phishing_enabled', 'antiphishing_enabled'],
            ['anti_links_enabled', 'antilinks_enabled']
        ];

        for (const [primary, alias] of keyPairs) {
            this.syncKeys(normalized, primary, alias);
        }

        return normalized;
    }

    /**
     * Mirror a value across two keys when either exists.
     * @param {Object} target Target object to mutate.
     * @param {string} keyA Primary key name.
     * @param {string} keyB Alias key name.
     * @private
     */
    syncKeys(target, keyA, keyB) {
        const hasA = Object.prototype.hasOwnProperty.call(target, keyA);
        const hasB = Object.prototype.hasOwnProperty.call(target, keyB);

        if (!hasA && !hasB) {
            return;
        }

        const value = hasA ? target[keyA] : target[keyB];
        target[keyA] = value;
        target[keyB] = value;
    }
}

module.exports = ConfigCache;
