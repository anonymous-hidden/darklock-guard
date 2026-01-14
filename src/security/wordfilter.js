const { EmbedBuilder, PermissionsBitField } = require('discord.js');

/**
 * Word Filter / Auto-Mod System
 * Custom word filters with regex support per server
 */
class WordFilter {
    constructor(bot) {
        this.bot = bot;
        // Cache filters per guild to avoid repeated DB calls
        this.filterCache = new Map();
        this.cacheExpiry = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('✅ Word Filter system initialized');
    }

    async ensureTables() {
        // Main filters table
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                filter_name TEXT NOT NULL,
                filter_type TEXT NOT NULL DEFAULT 'word',
                pattern TEXT NOT NULL,
                is_regex INTEGER DEFAULT 0,
                case_sensitive INTEGER DEFAULT 0,
                action TEXT NOT NULL DEFAULT 'delete',
                action_duration INTEGER,
                warn_message TEXT,
                log_matches INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1,
                exempt_roles TEXT,
                exempt_channels TEXT,
                created_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, filter_name)
            )
        `);

        // Filter violations log
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                filter_id INTEGER,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_content TEXT,
                matched_pattern TEXT,
                action_taken TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Preset filter categories
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS word_filter_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                patterns TEXT NOT NULL,
                category TEXT
            )
        `);

        // Add default presets if they don't exist
        await this.addDefaultPresets();
    }

    async addDefaultPresets() {
        const presets = [
            {
                name: 'profanity_basic',
                description: 'Basic profanity filter',
                patterns: JSON.stringify(['fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'bastard']),
                category: 'profanity'
            },
            {
                name: 'slurs',
                description: 'Racial and discriminatory slurs',
                patterns: JSON.stringify(['\\bn[i1]gg[ae3]r?s?\\b', '\\bf[a4]gg?[o0]t?s?\\b', '\\br[e3]t[a4]rd?s?\\b']),
                category: 'hate_speech'
            },
            {
                name: 'spam_patterns',
                description: 'Common spam patterns',
                patterns: JSON.stringify(['free\\s*nitro', 'discord\\.gift', 'steam\\s*gift', 'click\\s*here.*free', '@everyone.*http']),
                category: 'spam'
            },
            {
                name: 'invite_links',
                description: 'Discord invite links',
                patterns: JSON.stringify(['discord\\.gg\\/\\w+', 'discord\\.com\\/invite\\/\\w+', 'discordapp\\.com\\/invite\\/\\w+']),
                category: 'links'
            },
            {
                name: 'zalgo_text',
                description: 'Zalgo/corrupted text',
                patterns: JSON.stringify(['[\\u0300-\\u036f]{3,}', '[\\u0489\\u0488]{2,}']),
                category: 'spam'
            },
            {
                name: 'mass_mentions',
                description: 'Mass mention attempts',
                patterns: JSON.stringify(['(@\\w+\\s*){5,}', '@everyone', '@here']),
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

    async getFilters(guildId, forceRefresh = false) {
        const now = Date.now();
        const cached = this.filterCache.get(guildId);
        const expiry = this.cacheExpiry.get(guildId);

        if (!forceRefresh && cached && expiry && now < expiry) {
            return cached;
        }

        const filters = await this.bot.database.all(
            'SELECT * FROM word_filters WHERE guild_id = ? AND enabled = 1',
            [guildId]
        );

        // Parse exempt roles/channels
        const parsedFilters = filters.map(f => ({
            ...f,
            exemptRoles: f.exempt_roles ? JSON.parse(f.exempt_roles) : [],
            exemptChannels: f.exempt_channels ? JSON.parse(f.exempt_channels) : [],
            compiledPattern: this.compilePattern(f.pattern, f.is_regex, f.case_sensitive)
        }));

        this.filterCache.set(guildId, parsedFilters);
        this.cacheExpiry.set(guildId, now + this.cacheTTL);

        return parsedFilters;
    }

    compilePattern(pattern, isRegex, caseSensitive) {
        try {
            if (isRegex) {
                return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
            } else {
                // Escape special regex characters for literal matching
                const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Word boundary matching for non-regex patterns
                return new RegExp(`\\b${escaped}\\b`, caseSensitive ? 'g' : 'gi');
            }
        } catch (e) {
            this.bot.logger.warn(`Invalid filter pattern: ${pattern}`, e.message);
            return null;
        }
    }

    clearCache(guildId) {
        this.filterCache.delete(guildId);
        this.cacheExpiry.delete(guildId);
    }

    async checkMessage(message) {
        if (!message.guild || message.author.bot) return { blocked: false };
        if (!message.content || message.content.length < 1) return { blocked: false };

        // Check if user has bypass permissions
        if (this.canBypass(message.member)) return { blocked: false };

        const filters = await this.getFilters(message.guild.id);
        if (!filters || filters.length === 0) return { blocked: false };

        for (const filter of filters) {
            // Check channel exemption
            if (filter.exemptChannels.includes(message.channel.id)) continue;

            // Check role exemption
            if (filter.exemptRoles.some(roleId => message.member.roles.cache.has(roleId))) continue;

            // Check pattern
            if (!filter.compiledPattern) continue;

            const matches = message.content.match(filter.compiledPattern);
            if (matches && matches.length > 0) {
                return await this.handleViolation(message, filter, matches);
            }
        }

        return { blocked: false };
    }

    canBypass(member) {
        if (!member) return false;
        return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
               member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    async handleViolation(message, filter, matches) {
        const result = {
            blocked: true,
            filter: filter,
            matches: matches,
            action: filter.action
        };

        try {
            // Log the violation
            if (filter.log_matches) {
                await this.logViolation(message, filter, matches);
            }

            // Execute action
            switch (filter.action) {
                case 'delete':
                    await message.delete().catch(() => {});
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
                    // Just log, don't delete
                    break;
            }

            // Send to mod log if configured
            await this.sendModLog(message, filter, matches);

        } catch (error) {
            this.bot.logger.error('Error handling word filter violation:', error);
        }

        return result;
    }

    async logViolation(message, filter, matches) {
        await this.bot.database.run(`
            INSERT INTO word_filter_logs (guild_id, filter_id, user_id, channel_id, message_content, matched_pattern, action_taken)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            message.guild.id,
            filter.id,
            message.author.id,
            message.channel.id,
            message.content.substring(0, 1000), // Limit stored content
            matches.join(', '),
            filter.action
        ]);
    }

    async warnUser(message, filter) {
        const warnMessage = filter.warn_message || `Your message was removed for containing blocked content.`;
        
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('⚠️ Message Filtered')
                        .setDescription(warnMessage)
                        .addFields(
                            { name: 'Server', value: message.guild.name, inline: true },
                            { name: 'Filter', value: filter.filter_name, inline: true }
                        )
                        .setTimestamp()
                ]
            });
        } catch (e) {
            // User has DMs disabled
        }

        // Add to warning count
        await this.bot.database.run(`
            INSERT INTO user_records (guild_id, user_id, warning_count, last_warning_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                warning_count = warning_count + 1,
                last_warning_at = CURRENT_TIMESTAMP
        `, [message.guild.id, message.author.id]);
    }

    async timeoutUser(message, filter) {
        const duration = filter.action_duration || 300000; // Default 5 minutes
        
        try {
            await message.member.timeout(duration, `Word filter: ${filter.filter_name}`);
            
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🔇 You have been timed out')
                        .setDescription(`You were timed out for ${Math.floor(duration / 60000)} minutes for triggering the word filter.`)
                        .addFields(
                            { name: 'Server', value: message.guild.name, inline: true },
                            { name: 'Filter', value: filter.filter_name, inline: true }
                        )
                        .setTimestamp()
                ]
            }).catch(() => {});
        } catch (e) {
            this.bot.logger.warn('Failed to timeout user for word filter:', e.message);
        }
    }

    async kickUser(message, filter) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('👢 You have been kicked')
                        .setDescription(`You were kicked from **${message.guild.name}** for severely violating the word filter.`)
                        .addFields({ name: 'Filter', value: filter.filter_name })
                        .setTimestamp()
                ]
            }).catch(() => {});

            await message.member.kick(`Word filter violation: ${filter.filter_name}`);
        } catch (e) {
            this.bot.logger.warn('Failed to kick user for word filter:', e.message);
        }
    }

    async banUser(message, filter) {
        try {
            await message.author.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🔨 You have been banned')
                        .setDescription(`You were banned from **${message.guild.name}** for severely violating the word filter.`)
                        .addFields({ name: 'Filter', value: filter.filter_name })
                        .setTimestamp()
                ]
            }).catch(() => {});

            await message.member.ban({ reason: `Word filter violation: ${filter.filter_name}` });
        } catch (e) {
            this.bot.logger.warn('Failed to ban user for word filter:', e.message);
        }
    }

    async sendModLog(message, filter, matches) {
        try {
            const config = await this.bot.database.getGuildConfig(message.guild.id);
            const logChannelId = config?.mod_log_channel_id || config?.log_channel_id;
            
            if (!logChannelId) return;

            const logChannel = message.guild.channels.cache.get(logChannelId);
            if (!logChannel) return;

            const embed = new EmbedBuilder()
                .setColor(0xFF6B6B)
                .setTitle('🔍 Word Filter Triggered')
                .addFields(
                    { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Filter', value: filter.filter_name, inline: true },
                    { name: 'Action', value: filter.action.toUpperCase(), inline: true },
                    { name: 'Matched', value: `\`${matches.slice(0, 5).join('`, `')}\`${matches.length > 5 ? '...' : ''}`, inline: false },
                    { name: 'Message Preview', value: message.content.substring(0, 500) || 'N/A', inline: false }
                )
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (e) {
            // Log channel might not exist
        }
    }

    // Management methods for the command
    async addFilter(guildId, options) {
        const {
            name,
            pattern,
            isRegex = false,
            caseSensitive = false,
            action = 'delete',
            actionDuration = null,
            warnMessage = null,
            exemptRoles = [],
            exemptChannels = [],
            createdBy
        } = options;

        // Validate regex if applicable
        if (isRegex) {
            try {
                new RegExp(pattern);
            } catch (e) {
                throw new Error(`Invalid regex pattern: ${e.message}`);
            }
        }

        await this.bot.database.run(`
            INSERT INTO word_filters (
                guild_id, filter_name, pattern, is_regex, case_sensitive,
                action, action_duration, warn_message, exempt_roles, exempt_channels, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            name,
            pattern,
            isRegex ? 1 : 0,
            caseSensitive ? 1 : 0,
            action,
            actionDuration,
            warnMessage,
            JSON.stringify(exemptRoles),
            JSON.stringify(exemptChannels),
            createdBy
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
        const setClauses = [];
        const values = [];

        if (updates.pattern !== undefined) {
            setClauses.push('pattern = ?');
            values.push(updates.pattern);
        }
        if (updates.action !== undefined) {
            setClauses.push('action = ?');
            values.push(updates.action);
        }
        if (updates.enabled !== undefined) {
            setClauses.push('enabled = ?');
            values.push(updates.enabled ? 1 : 0);
        }
        if (updates.actionDuration !== undefined) {
            setClauses.push('action_duration = ?');
            values.push(updates.actionDuration);
        }
        if (updates.exemptRoles !== undefined) {
            setClauses.push('exempt_roles = ?');
            values.push(JSON.stringify(updates.exemptRoles));
        }
        if (updates.exemptChannels !== undefined) {
            setClauses.push('exempt_channels = ?');
            values.push(JSON.stringify(updates.exemptChannels));
        }

        if (setClauses.length === 0) return false;

        values.push(guildId, filterName);
        await this.bot.database.run(
            `UPDATE word_filters SET ${setClauses.join(', ')} WHERE guild_id = ? AND filter_name = ?`,
            values
        );

        this.clearCache(guildId);
        return true;
    }

    async listFilters(guildId) {
        return await this.bot.database.all(
            'SELECT * FROM word_filters WHERE guild_id = ? ORDER BY filter_name',
            [guildId]
        );
    }

    async getPresets() {
        return await this.bot.database.all('SELECT * FROM word_filter_presets ORDER BY category, name');
    }

    async applyPreset(guildId, presetName, action = 'delete', createdBy = null) {
        const preset = await this.bot.database.get(
            'SELECT * FROM word_filter_presets WHERE name = ?',
            [presetName]
        );

        if (!preset) throw new Error('Preset not found');

        const patterns = JSON.parse(preset.patterns);
        let added = 0;

        for (let i = 0; i < patterns.length; i++) {
            const filterName = `${presetName}_${i + 1}`;
            try {
                await this.addFilter(guildId, {
                    name: filterName,
                    pattern: patterns[i],
                    isRegex: true,
                    action: action,
                    createdBy: createdBy
                });
                added++;
            } catch (e) {
                // Filter might already exist
            }
        }

        return added;
    }

    async getViolationStats(guildId, days = 7) {
        const stats = await this.bot.database.all(`
            SELECT 
                filter_id,
                COUNT(*) as violations,
                COUNT(DISTINCT user_id) as unique_users
            FROM word_filter_logs 
            WHERE guild_id = ? 
                AND timestamp > datetime('now', '-${days} days')
            GROUP BY filter_id
        `, [guildId]);

        return stats;
    }
}

module.exports = WordFilter;
