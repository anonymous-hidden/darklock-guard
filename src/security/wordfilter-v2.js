/**
 * Word Filter System v2.0 - Production Ready
 * 
 * Architecture:
 * 1. Normalization Layer - Text cleaning and obfuscation handling
 * 2. Filter Engine - Pattern matching with multiple match types
 * 3. Enforcement Handler - Action execution and logging
 * 4. Cache Layer - In-memory caching with TTL
 * 
 * Data flow:
 * Dashboard -> API -> guild_configs.automod_settings (JSON) + word_filters table
 * Bot loads from both sources, caches in memory
 * messageCreate -> checkMessage() -> normalize -> match -> enforce
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');

// ============================================
// NORMALIZATION LAYER
// ============================================

const TextNormalizer = {
    // Leetspeak mappings
    LEET_MAP: {
        '4': 'a', '@': 'a', '^': 'a',
        '8': 'b',
        '(': 'c', '<': 'c',
        '3': 'e',
        '6': 'g', '9': 'g',
        '#': 'h',
        '1': 'i', '!': 'i', '|': 'i',
        '7': 't', '+': 't',
        '0': 'o',
        '5': 's', '$': 's',
        '2': 'z',
        'vv': 'w', '\\/\\/': 'w',
        '><': 'x',
        '`/': 'y'
    },

    // Common substitution patterns
    SUBSTITUTIONS: {
        'ph': 'f',
        'ck': 'k',
        'kk': 'k'
    },

    /**
     * Full normalization pipeline for matching
     * Returns multiple variants to check
     */
    normalize(text) {
        if (!text) return [''];
        
        const variants = new Set();
        const lower = text.toLowerCase();
        
        // Original lowercase
        variants.add(lower);
        
        // Remove all non-alphanumeric
        const alphanumOnly = lower.replace(/[^a-z0-9]/g, '');
        variants.add(alphanumOnly);
        
        // Decode leetspeak
        const deleeted = this.decodeLeetspeak(lower);
        variants.add(deleeted);
        variants.add(deleeted.replace(/[^a-z0-9]/g, ''));
        
        // Remove repeated characters (e.g., "fuuuck" -> "fuck")
        const deduplicated = this.deduplicateChars(lower);
        variants.add(deduplicated);
        
        // Remove spaces/separators between letters
        const spaceless = lower.replace(/[\s\-_.]+/g, '');
        variants.add(spaceless);
        
        // Combined: decode leet + remove repeats + remove spaces
        const fullNorm = this.deduplicateChars(this.decodeLeetspeak(spaceless));
        variants.add(fullNorm);
        
        return Array.from(variants).filter(v => v.length > 0);
    },

    /**
     * Decode leetspeak substitutions
     */
    decodeLeetspeak(text) {
        let result = text;
        
        // Multi-char substitutions first
        for (const [leet, normal] of Object.entries(this.LEET_MAP)) {
            if (leet.length > 1) {
                result = result.split(leet).join(normal);
            }
        }
        
        // Single char substitutions
        result = result.split('').map(char => {
            return this.LEET_MAP[char] || char;
        }).join('');
        
        // Common substitutions
        for (const [from, to] of Object.entries(this.SUBSTITUTIONS)) {
            result = result.replace(new RegExp(from, 'g'), to);
        }
        
        return result;
    },

    /**
     * Remove repeated characters (more than 2 in a row)
     */
    deduplicateChars(text) {
        return text.replace(/(.)\1{2,}/g, '$1$1');
    },

    /**
     * Hash content for privacy-safe logging
     */
    hashContent(content) {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    },

    /**
     * Create safe excerpt (no full message storage)
     */
    safeExcerpt(content, matchedWord, maxLen = 50) {
        const idx = content.toLowerCase().indexOf(matchedWord.toLowerCase());
        if (idx === -1) return '[redacted]';
        
        const start = Math.max(0, idx - 10);
        const end = Math.min(content.length, idx + matchedWord.length + 10);
        let excerpt = content.substring(start, end);
        
        if (start > 0) excerpt = '...' + excerpt;
        if (end < content.length) excerpt = excerpt + '...';
        
        return excerpt.substring(0, maxLen);
    }
};

// ============================================
// FILTER ENGINE
// ============================================

class FilterEngine {
    constructor() {
        this.compiledPatterns = new Map(); // patternKey -> RegExp
        this.regexTimeout = 100; // ms timeout for regex execution
    }

    /**
     * Compile a filter pattern based on match type
     */
    compilePattern(pattern, matchType, caseSensitive = false) {
        const key = `${pattern}:${matchType}:${caseSensitive}`;
        
        if (this.compiledPatterns.has(key)) {
            return this.compiledPatterns.get(key);
        }

        const flags = caseSensitive ? 'g' : 'gi';
        let regex;

        try {
            switch (matchType) {
                case 'exact':
                    // Word boundary matching
                    const escaped = this.escapeRegex(pattern);
                    regex = new RegExp(`\\b${escaped}\\b`, flags);
                    break;
                    
                case 'partial':
                    // Contains anywhere
                    regex = new RegExp(this.escapeRegex(pattern), flags);
                    break;
                    
                case 'regex':
                    // User-provided regex (must be validated before)
                    regex = new RegExp(pattern, flags);
                    break;
                    
                case 'startswith':
                    regex = new RegExp(`^${this.escapeRegex(pattern)}`, flags);
                    break;
                    
                case 'endswith':
                    regex = new RegExp(`${this.escapeRegex(pattern)}$`, flags);
                    break;
                    
                default:
                    // Default to exact word match
                    regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, flags);
            }
            
            this.compiledPatterns.set(key, regex);
            return regex;
        } catch (e) {
            return null;
        }
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Validate regex pattern (safe to compile and execute)
     */
    validateRegex(pattern) {
        try {
            // Test compilation
            const regex = new RegExp(pattern);
            
            // Test execution time with a sample string
            const testStr = 'a'.repeat(1000);
            const start = Date.now();
            testStr.match(regex);
            const elapsed = Date.now() - start;
            
            if (elapsed > 50) {
                return { valid: false, error: 'Pattern too slow (potential ReDoS)' };
            }
            
            return { valid: true };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    /**
     * Check text against a filter
     * Returns match result with confidence
     */
    checkFilter(text, filter) {
        if (!text || !filter.pattern) return null;

        const matchType = filter.match_type || 'exact';
        const checkObfuscation = filter.check_obfuscation !== false;
        
        // Get text variants to check
        const variants = checkObfuscation ? 
            TextNormalizer.normalize(text) : 
            [text.toLowerCase()];

        const pattern = this.compilePattern(
            filter.pattern, 
            matchType, 
            filter.case_sensitive
        );
        
        if (!pattern) return null;

        for (const variant of variants) {
            const matches = variant.match(pattern);
            if (matches && matches.length > 0) {
                return {
                    matched: true,
                    filter: filter,
                    matches: matches,
                    variant: variant,
                    confidence: variant === text.toLowerCase() ? 'high' : 'medium',
                    wasObfuscated: variant !== text.toLowerCase()
                };
            }
        }

        return null;
    }

    /**
     * Check text against multiple filters
     * Returns first match (filters should be priority-sorted)
     */
    checkFilters(text, filters) {
        for (const filter of filters) {
            if (!filter.enabled) continue;
            
            const result = this.checkFilter(text, filter);
            if (result) {
                return result;
            }
        }
        return null;
    }
}

// ============================================
// MAIN WORD FILTER CLASS
// ============================================

class WordFilter {
    constructor(bot) {
        this.bot = bot;
        this.engine = new FilterEngine();
        
        // Cache: guildId -> { filters, expiry }
        this.cache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        
        // User cooldowns: `${guildId}:${userId}` -> lastActionTime
        this.userCooldowns = new Map();
        this.cooldownDuration = 5000; // 5 seconds between actions per user
        
        // Stats tracking
        this.stats = {
            checksPerformed: 0,
            matchesFound: 0,
            actionsExecuted: 0
        };
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('WordFilter v2.0 initialized');
    }

    async ensureTables() {
        // Main filters table (per-word granularity)
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                filter_name TEXT NOT NULL,
                pattern TEXT NOT NULL,
                match_type TEXT DEFAULT 'exact',
                action TEXT DEFAULT 'delete',
                severity INTEGER DEFAULT 50,
                case_sensitive INTEGER DEFAULT 0,
                check_obfuscation INTEGER DEFAULT 1,
                action_duration INTEGER,
                warn_message TEXT,
                enabled INTEGER DEFAULT 1,
                exempt_roles TEXT,
                exempt_channels TEXT,
                low_confidence INTEGER DEFAULT 0,
                created_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, filter_name)
            )
        `);

        // Violation logs (privacy-safe)
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                filter_id INTEGER,
                filter_name TEXT,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                content_hash TEXT,
                matched_pattern TEXT,
                match_confidence TEXT,
                was_obfuscated INTEGER DEFAULT 0,
                action_taken TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Guild filter config
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_config (
                guild_id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 0,
                log_channel_id TEXT,
                default_action TEXT DEFAULT 'delete',
                notify_user INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add missing columns to existing tables
        const migrations = [
            'ALTER TABLE word_filters ADD COLUMN match_type TEXT DEFAULT "exact"',
            'ALTER TABLE word_filters ADD COLUMN severity INTEGER DEFAULT 50',
            'ALTER TABLE word_filters ADD COLUMN check_obfuscation INTEGER DEFAULT 1',
            'ALTER TABLE word_filters ADD COLUMN low_confidence INTEGER DEFAULT 0'
        ];

        for (const sql of migrations) {
            try {
                await this.bot.database.run(sql);
            } catch (e) {
                // Column might already exist
            }
        }
    }

    // ==================== CACHE MANAGEMENT ====================

    /**
     * Get filters for a guild (cached)
     */
    async getFilters(guildId, forceRefresh = false) {
        const now = Date.now();
        const cached = this.cache.get(guildId);

        if (!forceRefresh && cached && cached.expiry > now) {
            return cached.filters;
        }

        // Load from database
        const filters = await this.loadFiltersFromDB(guildId);
        
        this.cache.set(guildId, {
            filters,
            expiry: now + this.cacheTTL
        });

        return filters;
    }

    /**
     * Load filters from both sources (table + automod_settings JSON)
     */
    async loadFiltersFromDB(guildId) {
        // Source 1: word_filters table
        const tableFilters = await this.bot.database.all(
            'SELECT * FROM word_filters WHERE guild_id = ? ORDER BY severity DESC, filter_name',
            [guildId]
        ) || [];

        // Source 2: automod_settings JSON (dashboard saves here)
        const config = await this.bot.database.get(
            'SELECT automod_settings FROM guild_configs WHERE guild_id = ?',
            [guildId]
        );

        let jsonFilters = [];
        if (config?.automod_settings) {
            try {
                const automod = JSON.parse(config.automod_settings);
                if (automod.wordFilter?.enabled) {
                    // Convert words array to filter format
                    const words = automod.wordFilter.words || [];
                    const regex = automod.wordFilter.regex || [];
                    const action = automod.wordFilter.action || 'delete';

                    jsonFilters = [
                        ...words.map((word, i) => ({
                            id: `json_word_${i}`,
                            guild_id: guildId,
                            filter_name: `automod_word_${i}`,
                            pattern: word,
                            match_type: 'exact',
                            action: action,
                            severity: 50,
                            enabled: 1,
                            check_obfuscation: 1,
                            exempt_roles: '[]',
                            exempt_channels: '[]'
                        })),
                        ...regex.map((rx, i) => ({
                            id: `json_regex_${i}`,
                            guild_id: guildId,
                            filter_name: `automod_regex_${i}`,
                            pattern: rx,
                            match_type: 'regex',
                            action: action,
                            severity: 50,
                            enabled: 1,
                            check_obfuscation: 0, // Regex handles its own matching
                            exempt_roles: '[]',
                            exempt_channels: '[]'
                        }))
                    ];
                }
            } catch (e) {
                // Invalid JSON, ignore
            }
        }

        // Merge and deduplicate (table takes precedence)
        const allFilters = [...tableFilters, ...jsonFilters];
        
        // Parse exemptions
        return allFilters.map(f => ({
            ...f,
            exemptRoles: this.parseJSON(f.exempt_roles, []),
            exemptChannels: this.parseJSON(f.exempt_channels, [])
        }));
    }

    parseJSON(str, fallback) {
        try {
            return JSON.parse(str) || fallback;
        } catch {
            return fallback;
        }
    }

    /**
     * Clear cache for a guild (call after updates)
     */
    clearCache(guildId) {
        this.cache.delete(guildId);
    }

    /**
     * Force reload for a guild (dashboard calls this)
     */
    async reloadFilters(guildId) {
        this.clearCache(guildId);
        return await this.getFilters(guildId, true);
    }

    // ==================== CONFIGURATION ====================

    async getConfig(guildId) {
        let config = await this.bot.database.get(
            'SELECT * FROM word_filter_config WHERE guild_id = ?',
            [guildId]
        );

        if (!config) {
            // Check legacy column
            const guildConfig = await this.bot.database.getGuildConfig(guildId);
            config = {
                guild_id: guildId,
                enabled: guildConfig?.word_filter_enabled || 0,
                log_channel_id: guildConfig?.mod_log_channel_id,
                default_action: 'delete',
                notify_user: 1
            };
        }

        return config;
    }

    async setEnabled(guildId, enabled) {
        await this.bot.database.run(`
            INSERT INTO word_filter_config (guild_id, enabled)
            VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET enabled = ?
        `, [guildId, enabled ? 1 : 0, enabled ? 1 : 0]);

        // Also update legacy column for dashboard compatibility
        await this.bot.database.run(
            'UPDATE guild_configs SET word_filter_enabled = ? WHERE guild_id = ?',
            [enabled ? 1 : 0, guildId]
        );
    }

    // ==================== MESSAGE CHECKING ====================

    /**
     * Main entry point - check a message against all filters
     */
    async checkMessage(message) {
        // Skip bots, DMs, empty messages
        if (!message.guild || message.author.bot) {
            return { blocked: false };
        }
        if (!message.content || message.content.length === 0) {
            return { blocked: false };
        }

        this.stats.checksPerformed++;

        // Check if filter is enabled for guild
        const config = await this.getConfig(message.guild.id);
        if (!config?.enabled) {
            return { blocked: false };
        }

        // Check bypass permissions
        if (this.canBypass(message.member)) {
            return { blocked: false };
        }

        // Get filters
        const filters = await this.getFilters(message.guild.id);
        if (!filters || filters.length === 0) {
            return { blocked: false };
        }

        // Filter out exempted
        const applicableFilters = filters.filter(f => {
            if (!f.enabled) return false;
            if (f.exemptChannels.includes(message.channel.id)) return false;
            if (f.exemptRoles.some(r => message.member?.roles.cache.has(r))) return false;
            return true;
        });

        if (applicableFilters.length === 0) {
            return { blocked: false };
        }

        // Check against filters
        const result = this.engine.checkFilters(message.content, applicableFilters);
        
        if (result) {
            this.stats.matchesFound++;
            return await this.handleViolation(message, result, config);
        }

        return { blocked: false };
    }

    canBypass(member) {
        if (!member) return false;
        return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
               member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    // ==================== VIOLATION HANDLING ====================

    async handleViolation(message, matchResult, config) {
        const filter = matchResult.filter;
        const action = filter.action || 'delete';

        // Check user cooldown
        const cooldownKey = `${message.guild.id}:${message.author.id}`;
        const lastAction = this.userCooldowns.get(cooldownKey);
        const now = Date.now();

        if (lastAction && (now - lastAction) < this.cooldownDuration) {
            // Still in cooldown - just delete, no additional punishment
            await message.delete().catch(() => {});
            return { blocked: true, filter, action: 'delete_cooldown' };
        }

        this.userCooldowns.set(cooldownKey, now);
        this.stats.actionsExecuted++;

        // Log violation (privacy-safe)
        await this.logViolation(message, matchResult, action);

        // Execute action
        const result = {
            blocked: true,
            filter,
            action,
            matches: matchResult.matches,
            confidence: matchResult.confidence
        };

        try {
            switch (action) {
                case 'delete':
                    await message.delete().catch(() => {});
                    if (config.notify_user) {
                        await this.notifyUser(message, filter, 'deleted');
                    }
                    break;

                case 'warn':
                    await message.delete().catch(() => {});
                    await this.warnUser(message, filter);
                    break;

                case 'timeout':
                    await message.delete().catch(() => {});
                    await this.timeoutUser(message, filter);
                    break;

                case 'kick':
                    await message.delete().catch(() => {});
                    await this.kickUser(message, filter);
                    break;

                case 'ban':
                    await message.delete().catch(() => {});
                    await this.banUser(message, filter);
                    break;

                case 'log_only':
                    // Just logged, no action
                    break;
            }

            // Send to mod log
            await this.sendModLog(message, matchResult, action, config);

        } catch (error) {
            this.bot.logger.error('WordFilter violation handling error:', error);
        }

        return result;
    }

    // ==================== LOGGING (PRIVACY-SAFE) ====================

    async logViolation(message, matchResult, action) {
        const contentHash = TextNormalizer.hashContent(message.content);
        
        await this.bot.database.run(`
            INSERT INTO word_filter_violations 
            (guild_id, filter_id, filter_name, user_id, channel_id, content_hash, 
             matched_pattern, match_confidence, was_obfuscated, action_taken)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            message.guild.id,
            matchResult.filter.id,
            matchResult.filter.filter_name,
            message.author.id,
            message.channel.id,
            contentHash,
            matchResult.matches[0] || matchResult.filter.pattern,
            matchResult.confidence,
            matchResult.wasObfuscated ? 1 : 0,
            action
        ]);
    }

    async sendModLog(message, matchResult, action, config) {
        const logChannelId = config.log_channel_id;
        if (!logChannelId) return;

        const channel = message.guild.channels.cache.get(logChannelId);
        if (!channel) return;

        const actionColors = {
            'delete': 0xFFA500,
            'warn': 0xFFFF00,
            'timeout': 0xFF6B6B,
            'kick': 0xFF4444,
            'ban': 0xFF0000,
            'log_only': 0x808080
        };

        const actionEmojis = {
            'delete': '🗑️',
            'warn': '⚠️',
            'timeout': '🔇',
            'kick': '👢',
            'ban': '🔨',
            'log_only': '📝'
        };

        const filter = matchResult.filter;
        const excerpt = TextNormalizer.safeExcerpt(
            message.content, 
            matchResult.matches[0] || filter.pattern
        );

        const embed = new EmbedBuilder()
            .setTitle(`${actionEmojis[action] || '🔍'} Word Filter Triggered`)
            .setColor(actionColors[action] || 0xFFA500)
            .addFields(
                { name: 'User', value: `<@${message.author.id}>\n\`${message.author.id}\``, inline: true },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Action', value: action.toUpperCase(), inline: true },
                { name: 'Filter', value: filter.filter_name, inline: true },
                { name: 'Match Type', value: filter.match_type || 'exact', inline: true },
                { name: 'Confidence', value: matchResult.confidence, inline: true }
            )
            .setTimestamp();

        if (matchResult.wasObfuscated) {
            embed.addFields({ 
                name: '⚠️ Obfuscation Detected', 
                value: 'User attempted to bypass filter with character substitution',
                inline: false 
            });
        }

        // Add context preview (redacted)
        embed.addFields({ 
            name: 'Context', 
            value: `\`${excerpt}\``,
            inline: false 
        });

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // ==================== USER ACTIONS ====================

    async notifyUser(message, filter, action) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('Message Filtered')
                        .setDescription(filter.warn_message || 'Your message was removed for containing blocked content.')
                        .addFields({ name: 'Server', value: message.guild.name, inline: true })
                        .setTimestamp()
                ]
            });
        } catch {
            // DMs disabled
        }
    }

    async warnUser(message, filter) {
        await this.notifyUser(message, filter, 'warned');

        // Increment warning count
        await this.bot.database.run(`
            INSERT INTO user_records (guild_id, user_id, warning_count, last_warning_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                warning_count = warning_count + 1,
                last_warning_at = CURRENT_TIMESTAMP
        `, [message.guild.id, message.author.id]);
    }

    async timeoutUser(message, filter) {
        const duration = filter.action_duration || 300000; // 5 min default

        try {
            await message.member.timeout(duration, `Word filter: ${filter.filter_name}`);
        } catch (e) {
            this.bot.logger.warn('Failed to timeout user:', e.message);
        }

        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF6B6B)
                        .setTitle('🔇 Timed Out')
                        .setDescription(`You were timed out for ${Math.floor(duration / 60000)} minutes.`)
                        .addFields(
                            { name: 'Server', value: message.guild.name, inline: true },
                            { name: 'Reason', value: 'Word filter violation', inline: true }
                        )
                        .setTimestamp()
                ]
            });
        } catch {}
    }

    async kickUser(message, filter) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('👢 Kicked')
                        .setDescription(`You were kicked from **${message.guild.name}** for a severe filter violation.`)
                        .setTimestamp()
                ]
            });
        } catch {}

        try {
            await message.member.kick(`Word filter: ${filter.filter_name}`);
        } catch (e) {
            this.bot.logger.warn('Failed to kick user:', e.message);
        }
    }

    async banUser(message, filter) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🔨 Banned')
                        .setDescription(`You were banned from **${message.guild.name}** for a severe filter violation.`)
                        .setTimestamp()
                ]
            });
        } catch {}

        try {
            await message.member.ban({ reason: `Word filter: ${filter.filter_name}` });
        } catch (e) {
            this.bot.logger.warn('Failed to ban user:', e.message);
        }
    }

    // ==================== FILTER MANAGEMENT ====================

    async addFilter(guildId, options) {
        const {
            name,
            pattern,
            matchType = 'exact',
            action = 'delete',
            severity = 50,
            caseSensitive = false,
            checkObfuscation = true,
            actionDuration = null,
            warnMessage = null,
            exemptRoles = [],
            exemptChannels = [],
            lowConfidence = false,
            createdBy = null
        } = options;

        // Validate regex if applicable
        if (matchType === 'regex') {
            const validation = this.engine.validateRegex(pattern);
            if (!validation.valid) {
                throw new Error(`Invalid regex: ${validation.error}`);
            }
        }

        await this.bot.database.run(`
            INSERT INTO word_filters 
            (guild_id, filter_name, pattern, match_type, action, severity, 
             case_sensitive, check_obfuscation, action_duration, warn_message,
             exempt_roles, exempt_channels, low_confidence, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId, name, pattern, matchType, action, severity,
            caseSensitive ? 1 : 0, checkObfuscation ? 1 : 0,
            actionDuration, warnMessage,
            JSON.stringify(exemptRoles), JSON.stringify(exemptChannels),
            lowConfidence ? 1 : 0, createdBy
        ]);

        this.clearCache(guildId);
        return true;
    }

    async removeFilter(guildId, filterName) {
        const result = await this.bot.database.run(
            'DELETE FROM word_filters WHERE guild_id = ? AND filter_name = ?',
            [guildId, filterName]
        );
        this.clearCache(guildId);
        return result.changes > 0;
    }

    async updateFilter(guildId, filterName, updates) {
        const allowed = ['pattern', 'match_type', 'action', 'severity', 'case_sensitive',
                        'check_obfuscation', 'action_duration', 'warn_message', 'enabled',
                        'exempt_roles', 'exempt_channels', 'low_confidence'];
        
        const sets = [];
        const values = [];

        for (const [key, val] of Object.entries(updates)) {
            if (!allowed.includes(key)) continue;
            
            sets.push(`${key} = ?`);
            if (key === 'exempt_roles' || key === 'exempt_channels') {
                values.push(JSON.stringify(val));
            } else if (typeof val === 'boolean') {
                values.push(val ? 1 : 0);
            } else {
                values.push(val);
            }
        }

        if (sets.length === 0) return false;

        values.push(guildId, filterName);
        await this.bot.database.run(
            `UPDATE word_filters SET ${sets.join(', ')} WHERE guild_id = ? AND filter_name = ?`,
            values
        );

        this.clearCache(guildId);
        return true;
    }

    async listFilters(guildId) {
        return await this.bot.database.all(
            'SELECT * FROM word_filters WHERE guild_id = ? ORDER BY severity DESC, filter_name',
            [guildId]
        );
    }

    // ==================== TESTING ====================

    /**
     * Test a message against filters without taking action
     * Used by dashboard "test message" feature
     */
    async testMessage(guildId, content) {
        const filters = await this.getFilters(guildId);
        const results = [];

        for (const filter of filters) {
            if (!filter.enabled) continue;

            const match = this.engine.checkFilter(content, filter);
            if (match) {
                results.push({
                    filter_name: filter.filter_name,
                    pattern: filter.pattern,
                    match_type: filter.match_type,
                    action: filter.action,
                    matched: match.matches,
                    confidence: match.confidence,
                    wasObfuscated: match.wasObfuscated
                });
            }
        }

        return {
            wouldTrigger: results.length > 0,
            matches: results,
            normalized: TextNormalizer.normalize(content)
        };
    }

    // ==================== STATS ====================

    async getStats(guildId, days = 7) {
        const stats = await this.bot.database.all(`
            SELECT 
                filter_name,
                COUNT(*) as violations,
                COUNT(DISTINCT user_id) as unique_users,
                SUM(CASE WHEN was_obfuscated = 1 THEN 1 ELSE 0 END) as obfuscation_attempts
            FROM word_filter_violations 
            WHERE guild_id = ? 
                AND timestamp > datetime('now', '-${days} days')
            GROUP BY filter_name
            ORDER BY violations DESC
        `, [guildId]);

        return {
            filters: stats,
            engineStats: this.stats
        };
    }
}

module.exports = WordFilter;
