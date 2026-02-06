/**
 * ConfigService - Typed, versioned configuration with validation and live sync
 * Single source of truth for guild configuration
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const { resolveGuildTier, applyTierMask } = require('./tier-enforcement');

class ConfigService extends EventEmitter {
    constructor(bot) {
        super();
        this.bot = bot;
        this.cache = new Map(); // guildId -> { config, version, lastUpdated }
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        this.lastKnownGood = new Map(); // guildId -> config (fallback)
        
        // Schema for validation
        this.schema = {
            // Security settings
            anti_spam_enabled: { type: 'boolean', default: false },
            anti_raid_enabled: { type: 'boolean', default: false },
            antinuke_enabled: { type: 'boolean', default: false },
            anti_phishing_enabled: { type: 'boolean', default: false },
            auto_mod_enabled: { type: 'boolean', default: false },
            
            // Verification settings
            verification_enabled: { type: 'boolean', default: false },
            verification_method: { type: 'string', enum: ['button', 'captcha', 'web', 'reaction', 'auto'], default: 'button' },
            verification_profile: { type: 'string', enum: ['standard', 'high', 'ultra'], default: 'standard' },
            unverified_role_id: { type: 'snowflake', default: null },
            verified_role_id: { type: 'snowflake', default: null },
            verification_channel_id: { type: 'snowflake', default: null },
            verification_timeout_minutes: { type: 'number', min: 0, max: 10080, default: 0 },
            verification_min_account_age_days: { type: 'number', min: 0, max: 365, default: 0 },
            
            // Welcome settings
            welcome_enabled: { type: 'boolean', default: false },
            welcome_channel: { type: 'snowflake', default: null },
            welcome_message: { type: 'string', maxLength: 2000, default: 'Welcome {user} to {server}!' },
            goodbye_enabled: { type: 'boolean', default: false },
            goodbye_channel: { type: 'snowflake', default: null },
            goodbye_message: { type: 'string', maxLength: 2000, default: 'Goodbye {user}!' },
            
            // Moderation settings
            mod_log_channel: { type: 'snowflake', default: null },
            mute_role_id: { type: 'snowflake', default: null },
            protected_roles: { type: 'json_array', default: [] },
            
            // Escalation settings
            escalation_warn_to_timeout: { type: 'number', min: 1, max: 20, default: 3 },
            escalation_timeout_to_kick: { type: 'number', min: 1, max: 10, default: 2 },
            escalation_kick_to_ban: { type: 'number', min: 1, max: 5, default: 1 },
            offense_decay_days: { type: 'number', min: 1, max: 365, default: 30 },
            
            // Tickets
            tickets_enabled: { type: 'boolean', default: false },
            ticket_category_id: { type: 'snowflake', default: null },
            ticket_staff_role: { type: 'snowflake', default: null },
            
            // AI features
            ai_enabled: { type: 'boolean', default: false }
        };
    }

    /**
     * Validate a single value against schema
     */
    validateValue(key, value) {
        const rule = this.schema[key];
        if (!rule) return { valid: true, value }; // Unknown keys pass through
        
        // Handle null/undefined
        if (value === null || value === undefined) {
            return { valid: true, value: rule.default };
        }

        switch (rule.type) {
            case 'boolean':
                if (typeof value === 'boolean') return { valid: true, value };
                if (value === 1 || value === '1' || value === 'true') return { valid: true, value: true };
                if (value === 0 || value === '0' || value === 'false') return { valid: true, value: false };
                return { valid: false, error: `${key} must be boolean` };

            case 'number':
                const num = Number(value);
                if (isNaN(num)) return { valid: false, error: `${key} must be a number` };
                if (rule.min !== undefined && num < rule.min) return { valid: false, error: `${key} must be >= ${rule.min}` };
                if (rule.max !== undefined && num > rule.max) return { valid: false, error: `${key} must be <= ${rule.max}` };
                return { valid: true, value: num };

            case 'string':
                const str = String(value);
                if (rule.maxLength && str.length > rule.maxLength) return { valid: false, error: `${key} exceeds max length ${rule.maxLength}` };
                if (rule.enum && !rule.enum.includes(str)) return { valid: false, error: `${key} must be one of: ${rule.enum.join(', ')}` };
                return { valid: true, value: str };

            case 'snowflake':
                if (!value) return { valid: true, value: null };
                const snowflake = String(value);
                if (!/^\d{17,20}$/.test(snowflake)) return { valid: false, error: `${key} must be a valid Discord ID` };
                return { valid: true, value: snowflake };

            case 'json_array':
                if (Array.isArray(value)) return { valid: true, value };
                if (typeof value === 'string') {
                    try {
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) return { valid: true, value: parsed };
                    } catch {}
                }
                return { valid: false, error: `${key} must be a JSON array` };

            default:
                return { valid: true, value };
        }
    }

    /**
     * Validate entire config object
     */
    validateConfig(config) {
        const errors = [];
        const validated = {};

        for (const [key, value] of Object.entries(config)) {
            const result = this.validateValue(key, value);
            if (!result.valid) {
                errors.push(result.error);
            } else {
                validated[key] = result.value;
            }
        }

        return { valid: errors.length === 0, errors, config: validated };
    }

    /**
     * Generate config version hash
     */
    generateVersion(config) {
        const str = JSON.stringify(config);
        return crypto.createHash('sha256').update(str).digest('hex').slice(0, 8);
    }

    /**
     * Get guild config with caching
     */
    async get(guildId, forceRefresh = false) {
        const cached = this.cache.get(guildId);
        
        if (!forceRefresh && cached && Date.now() - cached.lastUpdated < this.cacheTTL) {
            return cached.config;
        }

        try {
            const config = await this.bot.database?.getGuildConfig(guildId);
            if (config) {
                const version = this.generateVersion(config);
                this.cache.set(guildId, { config, version, lastUpdated: Date.now() });
                this.lastKnownGood.set(guildId, config);
                return config;
            }
        } catch (err) {
            this.bot.logger?.warn(`[ConfigService] Failed to fetch config for ${guildId}: ${err.message}`);
        }

        // Fallback to last known good
        return this.lastKnownGood.get(guildId) || {};
    }

    /**
     * Update guild config with validation and live sync
     */
    async update(guildId, updates, userId = 'System') {
        // Validate updates
        const validation = this.validateConfig(updates);
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }

        // Get current config for diff
        const current = await this.get(guildId);
        const oldVersion = this.generateVersion(current);

        try {
            // Atomic update in database
            await this.bot.database?.updateGuildConfig(guildId, validation.config);
            
            // Refresh cache
            const newConfig = await this.get(guildId, true);
            const newVersion = this.generateVersion(newConfig);

            // Emit change events for each modified key
            for (const [key, newValue] of Object.entries(validation.config)) {
                const oldValue = current[key];
                if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                    // Save to history
                    await this.saveHistory(guildId, userId, key, oldValue, newValue);
                    
                    // Emit live update event
                    this.emit('configChanged', {
                        guildId,
                        userId,
                        key,
                        oldValue,
                        newValue,
                        oldVersion,
                        newVersion
                    });
                    
                    // Notify bot's setting change listeners
                    if (typeof this.bot.emitSettingChange === 'function') {
                        this.bot.emitSettingChange(guildId, userId, key, newValue);
                    }
                }
            }

            // Broadcast to dashboard
            this.broadcastUpdate(guildId, validation.config, newVersion);

            return { success: true, version: newVersion, config: newConfig };
        } catch (err) {
            this.bot.logger?.error(`[ConfigService] Update failed for ${guildId}: ${err.message}`);
            return { success: false, errors: [err.message] };
        }
    }

    /**
     * Atomic toggle for boolean settings
     */
    async toggle(guildId, key, userId = 'System') {
        const current = await this.get(guildId);
        const rule = this.schema[key];
        
        if (!rule || rule.type !== 'boolean') {
            return { success: false, errors: [`${key} is not a toggleable setting`] };
        }

        const newValue = !current[key];
        return this.update(guildId, { [key]: newValue }, userId);
    }

    /**
     * Save config change to history
     */
    async saveHistory(guildId, userId, key, oldValue, newValue) {
        try {
            await this.bot.database?.run(
                `INSERT INTO settings_history (guild_id, user_id, setting_key, old_value, new_value, timestamp)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [guildId, userId, key, JSON.stringify(oldValue), JSON.stringify(newValue)]
            );
        } catch (err) {
            this.bot.logger?.warn(`[ConfigService] Failed to save history: ${err.message}`);
        }
    }

    /**
     * Rollback to previous config version
     */
    async rollback(guildId, key, userId = 'System') {
        try {
            const history = await this.bot.database?.get(
                `SELECT old_value FROM settings_history 
                 WHERE guild_id = ? AND setting_key = ? 
                 ORDER BY timestamp DESC LIMIT 1`,
                [guildId, key]
            );

            if (!history) {
                return { success: false, errors: ['No history found for this setting'] };
            }

            const oldValue = JSON.parse(history.old_value);
            return this.update(guildId, { [key]: oldValue }, userId);
        } catch (err) {
            return { success: false, errors: [err.message] };
        }
    }

    /**
     * Broadcast config update to dashboard via WebSocket
     */
    broadcastUpdate(guildId, config, version) {
        try {
            if (this.bot.dashboard && typeof this.bot.dashboard.broadcastToGuild === 'function') {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'CONFIG_UPDATE',
                    config,
                    version,
                    timestamp: Date.now()
                });
            }
        } catch {}
    }

    /**
     * Resolve the effective config for a guild: raw config masked by tier limits.
     * This is what the bot runtime should use — pro/enterprise features are zeroed
     * out if the guild doesn't have the required subscription.
     * 
     * @param {string} guildId
     * @param {boolean} forceRefresh - bypass cache
     * @returns {Promise<Object>} tier-masked config
     */
    async resolveEffective(guildId, forceRefresh = false) {
        const raw = await this.get(guildId, forceRefresh);
        const tier = await resolveGuildTier(this.bot, guildId);
        return applyTierMask(raw, tier);
    }

    /**
     * Invalidate cache for guild
     */
    invalidate(guildId) {
        this.cache.delete(guildId);
    }

    /**
     * Get default config with all schema defaults
     */
    getDefaults() {
        const defaults = {};
        for (const [key, rule] of Object.entries(this.schema)) {
            defaults[key] = rule.default;
        }
        return defaults;
    }

    /**
     * Initialize config for new guild
     */
    async initializeGuild(guildId) {
        const existing = await this.get(guildId);
        if (!existing || Object.keys(existing).length === 0) {
            const defaults = this.getDefaults();
            await this.bot.database?.run(
                `INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)`,
                [guildId]
            );
            return defaults;
        }
        return existing;
    }

    /**
     * Initialize service (optional cache warmup)
     */
    async initialize() {
        try {
            const guilds = this.bot.client?.guilds?.cache;
            if (!guilds || guilds.size === 0) return;

            for (const guild of guilds.values()) {
                await this.initializeGuild(guild.id);
            }
        } catch (err) {
            this.bot.logger?.warn && this.bot.logger.warn(`[ConfigService] Initialize warning: ${err.message}`);
        }
    }
}

module.exports = ConfigService;
