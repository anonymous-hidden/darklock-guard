/**
 * Word Filter Engine v2.0
 * Actually wired to dashboard configuration
 * 
 * Reads from guild_configs columns:
 * - word_filter_enabled
 * - banned_words (comma-separated, supports * wildcard)
 * - banned_phrases (newline-separated)
 * - word_filter_action (delete | warn | mute | kick | log_only)
 * - word_filter_mode (exact | contains | smart)
 * - word_filter_whitelist_channels (comma-separated IDs)
 * - word_filter_whitelist_roles (comma-separated IDs)
 * - word_filter_custom_message
 * - log_filtered_messages
 * - filter_display_names
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');

class WordFilterEngine {
    constructor(bot) {
        this.bot = bot;
        this.configCache = new Map(); // guildId -> compiled config
        this.cacheExpiry = new Map();
        this.cacheTTL = 60 * 1000; // 1 minute - short for live reloading
        this.userCooldowns = new Map(); // `${guildId}:${userId}` -> lastActionTime
        this.cooldownMs = 5000; // 5 second cooldown per user
    }

    async initialize() {
        await this.ensureTables();
        await this.initializePresets();
        this.bot.logger.info('WordFilterEngine v2.0 initialized with presets');
    }

    async ensureTables() {
        // Add missing columns to guild_configs
        const columns = [
            { name: 'word_filter_enabled', def: 'INTEGER DEFAULT 0' },
            { name: 'banned_words', def: 'TEXT DEFAULT \'\'' },
            { name: 'banned_phrases', def: 'TEXT DEFAULT \'\'' },
            { name: 'word_filter_action', def: 'TEXT DEFAULT \'delete\'' },
            { name: 'word_filter_mode', def: 'TEXT DEFAULT \'contains\'' },
            { name: 'word_filter_whitelist_channels', def: 'TEXT DEFAULT \'\'' },
            { name: 'word_filter_whitelist_roles', def: 'TEXT DEFAULT \'\'' },
            { name: 'word_filter_custom_message', def: 'TEXT DEFAULT \'\'' },
            { name: 'log_filtered_messages', def: 'INTEGER DEFAULT 1' },
            { name: 'filter_display_names', def: 'INTEGER DEFAULT 0' }
        ];

        for (const col of columns) {
            try {
                await this.bot.database.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.def}`);
            } catch (e) {
                // Column already exists
            }
        }

        // Violation log table (stores minimal data)
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                matched_term TEXT NOT NULL,
                match_type TEXT NOT NULL,
                action_taken TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )
        `);

        await this.bot.database.run(`CREATE INDEX IF NOT EXISTS idx_wfv_guild ON word_filter_violations(guild_id)`);
        await this.bot.database.run(`CREATE INDEX IF NOT EXISTS idx_wfv_user ON word_filter_violations(user_id)`);
    }

    // ==================== TEXT NORMALIZATION ====================

    /**
     * Normalize text for matching
     * - Lowercase
     * - Remove zero-width characters
     * - Collapse whitespace
     * - Convert leetspeak (in smart mode)
     * - Strip excessive punctuation
     */
    normalizeText(text, smartMode = false) {
        if (!text) return '';
        
        let normalized = text.toLowerCase();
        
        // Remove zero-width characters
        normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, '');
        
        // Remove variation selectors and combining marks used for obfuscation
        normalized = normalized.replace(/[\uFE00-\uFE0F]/g, '');
        
        // Collapse multiple spaces/newlines to single space
        normalized = normalized.replace(/\s+/g, ' ').trim();
        
        if (smartMode) {
            // Leetspeak conversion
            const leetMap = {
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
                'vv': 'w', '\\/\\/': 'w'
            };
            
            for (const [leet, letter] of Object.entries(leetMap)) {
                normalized = normalized.split(leet).join(letter);
            }
            
            // Remove common separator characters used to evade filters
            // s.p.a.c.e.d or s-p-a-c-e-d
            normalized = normalized.replace(/([a-z])[\.\-_\*]{1,2}(?=[a-z])/g, '$1');
            
            // Remove repeated characters beyond 2 (heeeeello -> heello)
            normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');
        }
        
        return normalized;
    }

    // ==================== PATTERN COMPILATION ====================

    /**
     * Compile a word pattern to regex
     * @param {string} word - The word/phrase to match
     * @param {string} mode - 'exact' | 'contains' | 'smart'
     * @param {boolean} isPhrase - If true, match as whole phrase
     */
    compileWordPattern(word, mode, isPhrase = false) {
        if (!word || word.trim() === '') return null;
        
        let pattern = word.trim().toLowerCase();
        
        // Handle wildcards
        const hasWildcard = pattern.includes('*');
        
        // Escape regex special chars (except * which we handle specially)
        pattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        
        // Convert * wildcard to regex
        if (hasWildcard) {
            pattern = pattern.replace(/\*/g, '.*');
        }
        
        // Build final regex based on mode
        let regexStr;
        if (isPhrase) {
            // Phrases match as-is after normalization
            regexStr = pattern;
        } else if (mode === 'exact' && !hasWildcard) {
            // Word boundary match
            regexStr = `\\b${pattern}\\b`;
        } else if (mode === 'contains' || hasWildcard) {
            // Contains or wildcard - no boundaries
            regexStr = pattern;
        } else {
            // Default to word boundary
            regexStr = `\\b${pattern}\\b`;
        }
        
        try {
            return new RegExp(regexStr, 'gi');
        } catch (e) {
            this.bot.logger.warn(`Invalid word filter pattern: ${word}`, e.message);
            return null;
        }
    }

    /**
     * Compile all patterns for a guild config
     */
    compileGuildPatterns(config) {
        const compiled = {
            words: [],
            phrases: [],
            mode: config.word_filter_mode || 'contains'
        };
        
        // Parse banned words (comma-separated)
        const words = (config.banned_words || '').split(',')
            .map(w => w.trim())
            .filter(w => w.length > 0);
        
        for (const word of words) {
            const regex = this.compileWordPattern(word, compiled.mode, false);
            if (regex) {
                compiled.words.push({
                    original: word,
                    regex: regex,
                    hasWildcard: word.includes('*')
                });
            }
        }
        
        // Parse banned phrases (newline-separated)
        const phrases = (config.banned_phrases || '').split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);
        
        for (const phrase of phrases) {
            const regex = this.compileWordPattern(phrase, compiled.mode, true);
            if (regex) {
                compiled.phrases.push({
                    original: phrase,
                    regex: regex
                });
            }
        }
        
        return compiled;
    }

    // ==================== CONFIG CACHING ====================

    /**
     * Get compiled config for a guild
     */
    async getCompiledConfig(guildId, forceRefresh = false) {
        const now = Date.now();
        const cached = this.configCache.get(guildId);
        const expiry = this.cacheExpiry.get(guildId);
        
        if (!forceRefresh && cached && expiry && now < expiry) {
            return cached;
        }
        
        // Fetch from database
        const config = await this.bot.database.getGuildConfig(guildId);
        if (!config) return null;
        
        // Build compiled config
        const compiled = {
            enabled: !!config.word_filter_enabled,
            action: config.word_filter_action || 'delete',
            mode: config.word_filter_mode || 'contains',
            customMessage: config.word_filter_custom_message || 'Your message was removed for containing inappropriate content.',
            logEnabled: config.log_filtered_messages !== 0,
            filterDisplayNames: !!config.filter_display_names,
            whitelistChannels: new Set(
                (config.word_filter_whitelist_channels || '').split(',').filter(Boolean)
            ),
            whitelistRoles: new Set(
                (config.word_filter_whitelist_roles || '').split(',').filter(Boolean)
            ),
            modLogChannel: config.log_channel_id || config.mod_log_channel || null,
            patterns: this.compileGuildPatterns(config)
        };
        
        this.configCache.set(guildId, compiled);
        this.cacheExpiry.set(guildId, now + this.cacheTTL);
        
        return compiled;
    }

    /**
     * Force refresh config (call from dashboard save)
     */
    clearCache(guildId) {
        this.configCache.delete(guildId);
        this.cacheExpiry.delete(guildId);
    }

    // ==================== MESSAGE CHECKING ====================

    /**
     * Check a message for filter violations
     * @returns {{ blocked: boolean, term?: string, type?: string }}
     */
    async checkMessage(message) {
        // Basic guards
        if (!message.guild) return { blocked: false };
        if (message.author.bot) return { blocked: false };
        if (!message.content && !message.member?.displayName) return { blocked: false };
        
        const config = await this.getCompiledConfig(message.guild.id);
        if (!config || !config.enabled) return { blocked: false };
        
        // Check whitelist channel
        if (config.whitelistChannels.has(message.channel.id)) {
            return { blocked: false };
        }
        
        // Check whitelist roles
        if (message.member) {
            for (const roleId of config.whitelistRoles) {
                if (message.member.roles.cache.has(roleId)) {
                    return { blocked: false };
                }
            }
        }
        
        // Check if user has mod permissions (bypass)
        // NOTE: Admins and users with ManageMessages are exempt from the word filter.
        // This means server owners and moderators will NOT be filtered.
        if (this.canBypass(message.member)) {
            this.bot.logger?.debug(`[WordFilter] Bypassed for ${message.author.tag} (has ManageMessages/Administrator)`);
            return { blocked: false };
        }
        
        // No patterns configured
        if (config.patterns.words.length === 0 && config.patterns.phrases.length === 0) {
            return { blocked: false };
        }
        
        const smartMode = config.mode === 'smart';
        
        // Check message content
        if (message.content) {
            const normalized = this.normalizeText(message.content, smartMode);
            const match = this.findMatch(normalized, config.patterns);
            
            if (match) {
                await this.handleViolation(message, config, match.term, match.type);
                return { blocked: true, term: match.term, type: match.type };
            }
        }
        
        // Check display name if enabled
        if (config.filterDisplayNames && message.member?.displayName) {
            const normalizedName = this.normalizeText(message.member.displayName, smartMode);
            const match = this.findMatch(normalizedName, config.patterns);
            
            if (match) {
                // For display names, we can't delete, just log
                await this.logViolation(message.guild.id, message.author.id, message.channel.id, match.term, 'display_name', 'log_only');
                if (config.logEnabled && config.modLogChannel) {
                    await this.sendModLog(message, config, match.term, 'display_name', 'log_only');
                }
                // Don't block the message, but flag it
                return { blocked: false, displayNameMatch: true, term: match.term };
            }
        }
        
        return { blocked: false };
    }

    /**
     * Find first matching pattern
     */
    findMatch(text, patterns) {
        // Check words first (usually shorter list)
        for (const word of patterns.words) {
            if (word.regex.test(text)) {
                // Reset lastIndex for global regex
                word.regex.lastIndex = 0;
                return { term: word.original, type: 'word' };
            }
        }
        
        // Check phrases
        for (const phrase of patterns.phrases) {
            if (phrase.regex.test(text)) {
                phrase.regex.lastIndex = 0;
                return { term: phrase.original, type: 'phrase' };
            }
        }
        
        return null;
    }

    canBypass(member) {
        if (!member) return false;
        return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
               member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    // ==================== ENFORCEMENT ====================

    /**
     * Handle a filter violation
     */
    async handleViolation(message, config, matchedTerm, matchType) {
        const action = config.action || 'delete';
        
        // Check user cooldown to prevent action spam
        const cooldownKey = `${message.guild.id}:${message.author.id}`;
        const lastAction = this.userCooldowns.get(cooldownKey);
        const now = Date.now();
        
        if (lastAction && (now - lastAction) < this.cooldownMs) {
            // Still in cooldown, just delete without additional actions
            try {
                await message.delete();
            } catch (e) { /* message may already be deleted */ }
            return;
        }
        
        this.userCooldowns.set(cooldownKey, now);
        
        // Log violation
        await this.logViolation(
            message.guild.id,
            message.author.id,
            message.channel.id,
            matchedTerm,
            matchType,
            action
        );
        
        // Execute action
        try {
            switch (action) {
                case 'delete':
                    await message.delete();
                    break;
                    
                case 'warn':
                    await message.delete();
                    await this.warnUser(message, config);
                    break;
                    
                case 'mute':
                    await message.delete();
                    await this.muteUser(message, config);
                    break;
                    
                case 'kick':
                    await message.delete();
                    await this.kickUser(message, config);
                    break;
                    
                case 'log_only':
                    // No action on message
                    break;
            }
        } catch (error) {
            this.bot.logger.error('Word filter action failed:', error);
        }
        
        // Send to mod log
        if (config.logEnabled && config.modLogChannel) {
            await this.sendModLog(message, config, matchedTerm, matchType, action);
        }
    }

    async logViolation(guildId, userId, channelId, term, type, action) {
        try {
            await this.bot.database.run(`
                INSERT INTO word_filter_violations (guild_id, user_id, channel_id, matched_term, match_type, action_taken, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [guildId, userId, channelId, term.substring(0, 100), type, action, Date.now()]);
        } catch (e) {
            this.bot.logger.error('Failed to log word filter violation:', e);
        }
    }

    async warnUser(message, config) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('Message Removed')
                        .setDescription(config.customMessage)
                        .addFields({ name: 'Server', value: message.guild.name, inline: true })
                        .setTimestamp()
                ]
            });
        } catch (e) {
            // User has DMs disabled - that's fine
        }
    }

    async muteUser(message, config) {
        try {
            const duration = 5 * 60 * 1000; // 5 minutes default
            await message.member.timeout(duration, 'Word filter violation');
            
            try {
                await message.author.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('You have been muted')
                            .setDescription(`${config.customMessage}\n\nYou have been muted for 5 minutes.`)
                            .addFields({ name: 'Server', value: message.guild.name, inline: true })
                            .setTimestamp()
                    ]
                });
            } catch (e) { /* DMs disabled */ }
        } catch (e) {
            this.bot.logger.error('Failed to mute user for word filter:', e);
        }
    }

    async kickUser(message, config) {
        try {
            try {
                await message.author.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('You have been kicked')
                            .setDescription(config.customMessage)
                            .addFields({ name: 'Server', value: message.guild.name, inline: true })
                            .setTimestamp()
                    ]
                });
            } catch (e) { /* DMs disabled */ }
            
            await message.member.kick('Word filter violation');
        } catch (e) {
            this.bot.logger.error('Failed to kick user for word filter:', e);
        }
    }

    async sendModLog(message, config, matchedTerm, matchType, action) {
        if (!config.modLogChannel) return;
        
        try {
            const channel = await message.guild.channels.fetch(config.modLogChannel).catch(() => null);
            if (!channel) return;
            
            const actionLabels = {
                'delete': 'Message Deleted',
                'warn': 'Warned + Deleted',
                'mute': 'Muted + Deleted',
                'kick': 'Kicked + Deleted',
                'log_only': 'Logged Only'
            };
            
            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('Word Filter Triggered')
                .addFields(
                    { name: 'User', value: `${message.author.tag}\n\`${message.author.id}\``, inline: true },
                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Action', value: actionLabels[action] || action, inline: true },
                    { name: 'Matched Term', value: `\`${matchedTerm.substring(0, 50)}\``, inline: true },
                    { name: 'Match Type', value: matchType, inline: true },
                    { name: 'Mode', value: config.mode, inline: true }
                )
                .setFooter({ text: 'Word Filter v2.0' })
                .setTimestamp();
            
            // Do NOT include message content for privacy
            
            await channel.send({ embeds: [embed] });
        } catch (e) {
            this.bot.logger.error('Failed to send word filter mod log:', e);
        }
    }

    // ==================== TEST UTILITY ====================

    /**
     * Test a message against guild config without taking action
     * (For dashboard "test message" feature)
     */
    async testMessage(guildId, testContent) {
        const config = await this.getCompiledConfig(guildId, true); // Force refresh
        if (!config || !config.enabled) {
            return { 
                wouldBlock: false, 
                reason: 'Word filter is disabled',
                matches: []
            };
        }
        
        if (config.patterns.words.length === 0 && config.patterns.phrases.length === 0) {
            return {
                wouldBlock: false,
                reason: 'No banned words or phrases configured',
                matches: []
            };
        }
        
        const smartMode = config.mode === 'smart';
        const normalized = this.normalizeText(testContent, smartMode);
        const matches = [];
        
        // Check all words
        for (const word of config.patterns.words) {
            if (word.regex.test(normalized)) {
                word.regex.lastIndex = 0;
                matches.push({
                    term: word.original,
                    type: 'word',
                    hasWildcard: word.hasWildcard
                });
            }
        }
        
        // Check all phrases
        for (const phrase of config.patterns.phrases) {
            if (phrase.regex.test(normalized)) {
                phrase.regex.lastIndex = 0;
                matches.push({
                    term: phrase.original,
                    type: 'phrase'
                });
            }
        }
        
        return {
            wouldBlock: matches.length > 0,
            action: config.action,
            mode: config.mode,
            normalizedText: normalized,
            matches
        };
    }

    /**
     * Get violation stats for a guild
     */
    async getViolationStats(guildId, days = 30) {
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        
        const stats = await this.bot.database.all(`
            SELECT 
                matched_term,
                match_type,
                action_taken,
                COUNT(*) as count
            FROM word_filter_violations
            WHERE guild_id = ? AND timestamp > ?
            GROUP BY matched_term, match_type, action_taken
            ORDER BY count DESC
            LIMIT 20
        `, [guildId, since]);
        
        const total = await this.bot.database.get(`
            SELECT COUNT(*) as total FROM word_filter_violations
            WHERE guild_id = ? AND timestamp > ?
        `, [guildId, since]);
        
        return {
            topTerms: stats || [],
            totalViolations: total?.total || 0,
            periodDays: days
        };
    }

    // ==================== PRESET SYSTEM ====================

    /**
     * Initialize preset database and add default presets
     */
    async initializePresets() {
        // Create presets table
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT NOT NULL,
                patterns TEXT NOT NULL,
                category TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add default presets if they don't exist
        const presets = [
            {
                name: 'profanity_basic',
                description: 'Basic profanity filter',
                patterns: JSON.stringify(['fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'bastard', 'hell']),
                category: 'profanity'
            },
            {
                name: 'slurs',
                description: 'Racial and discriminatory slurs',
                patterns: JSON.stringify(['n*gger', 'n*gga', 'f*ggot', 'f*g', 'r*tard', 'tr*nny', 'k*ke']),
                category: 'hate_speech'
            },
            {
                name: 'spam_patterns',
                description: 'Common spam patterns',
                patterns: JSON.stringify(['free nitro', 'discord.gift', 'steam gift', 'click here free', '@everyone http']),
                category: 'spam'
            },
            {
                name: 'invite_links',
                description: 'Discord invite links',
                patterns: JSON.stringify(['discord.gg/*', 'discord.com/invite/*', 'discordapp.com/invite/*']),
                category: 'links'
            },
            {
                name: 'zalgo_text',
                description: 'Zalgo/corrupted text (excessive combining characters)',
                patterns: JSON.stringify(['***zalgo***']), // Special marker
                category: 'spam'
            },
            {
                name: 'mass_mentions',
                description: 'Mass mention attempts',
                patterns: JSON.stringify(['@everyone', '@here']),
                category: 'spam'
            }
        ];

        for (const preset of presets) {
            try {
                await this.bot.database.run(`
                    INSERT OR IGNORE INTO word_filter_presets (name, description, patterns, category)
                    VALUES (?, ?, ?, ?)
                `, [preset.name, preset.description, preset.patterns, preset.category]);
            } catch (e) {
                // Ignore duplicates
            }
        }
    }

    /**
     * Get all available presets
     */
    async getPresets() {
        return await this.bot.database.all('SELECT * FROM word_filter_presets ORDER BY category, name');
    }

    /**
     * Apply a preset to a guild
     * Returns number of words added
     */
    async applyPreset(guildId, presetName, action = 'delete', createdBy = null) {
        const preset = await this.bot.database.get(
            'SELECT * FROM word_filter_presets WHERE name = ?',
            [presetName]
        );

        if (!preset) throw new Error('Preset not found');

        // Get current config
        const config = await this.bot.database.get(
            'SELECT banned_words, banned_phrases FROM guild_configs WHERE guild_id = ?',
            [guildId]
        );

        const patterns = JSON.parse(preset.patterns);
        
        // Parse existing words/phrases
        let existingWords = config?.banned_words ? config.banned_words.split(',').filter(w => w.trim()) : [];
        let existingPhrases = config?.banned_phrases ? config.banned_phrases.split('\n').filter(p => p.trim()) : [];

        // Determine if patterns are phrases (multi-word) or words
        let addedCount = 0;
        for (const pattern of patterns) {
            const trimmed = pattern.trim();
            if (!trimmed) continue;

            if (trimmed.includes(' ') || trimmed.includes('***zalgo***')) {
                // It's a phrase (or special marker)
                if (!existingPhrases.includes(trimmed)) {
                    existingPhrases.push(trimmed);
                    addedCount++;
                }
            } else {
                // It's a word
                if (!existingWords.includes(trimmed)) {
                    existingWords.push(trimmed);
                    addedCount++;
                }
            }
        }

        // Update guild config with merged words/phrases
        await this.bot.database.run(`
            UPDATE guild_configs 
            SET 
                banned_words = ?,
                banned_phrases = ?,
                word_filter_action = ?,
                word_filter_enabled = 1
            WHERE guild_id = ?
        `, [
            existingWords.join(','),
            existingPhrases.join('\n'),
            action,
            guildId
        ]);

        // Invalidate cache
        this.configCache.delete(guildId);
        this.cacheExpiry.delete(guildId);

        return addedCount;
    }
}

module.exports = WordFilterEngine;
