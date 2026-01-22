/**
 * AutoMod Module - Reads settings from dashboard and applies filters
 * This module implements the automod_settings JSON stored in guild_configs
 */

const { PermissionsBitField } = require('discord.js');

class AutoMod {
    constructor(bot) {
        this.bot = bot;
        this.inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;
        this.userViolations = new Map(); // guildId_userId -> { count, lastViolation }
    }

    /**
     * Main entry point - called from messageCreate handler
     * @param {Message} message - Discord.js Message object
     * @param {Object} guildConfig - Guild config from getGuildConfig()
     * @returns {boolean} - true if message was flagged and handled
     */
    async handleMessage(message, guildConfig) {
        // Skip if no guild config or automod not configured
        if (!guildConfig) return false;
        
        // Skip bots
        if (message.author.bot) return false;
        
        // Skip moderators
        if (message.member && this.hasModeratorPermissions(message.member)) {
            return false;
        }

        // Parse automod settings from JSON
        let settings = null;
        try {
            if (guildConfig.automod_settings) {
                settings = typeof guildConfig.automod_settings === 'string' 
                    ? JSON.parse(guildConfig.automod_settings) 
                    : guildConfig.automod_settings;
            }
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to parse automod_settings for guild ${message.guildId}:`, e.message);
            return false;
        }

        // If no settings or all disabled, exit
        if (!settings) {
            return false;
        }

        // Check filters in order - stop on first violation
        const filters = [
            { name: 'inviteFilter', check: () => this.checkInviteFilter(message, settings.inviteFilter) },
            { name: 'wordFilter', check: () => this.checkWordFilter(message, settings.wordFilter) },
            { name: 'mentionSpam', check: () => this.checkMentionSpam(message, settings.mentionSpam) },
            { name: 'emojiSpam', check: () => this.checkEmojiSpam(message, settings.emojiSpam) },
            { name: 'capsFilter', check: () => this.checkCapsFilter(message, settings.capsFilter) },
            { name: 'lengthFilter', check: () => this.checkLengthFilter(message, settings.lengthFilter) }
        ];

        for (const filter of filters) {
            if (settings[filter.name]?.enabled) {
                const result = await filter.check();
                if (result.violated) {
                    await this.handleViolation(message, filter.name, result.reason, settings[filter.name]);
                    return true; // Stop after first violation
                }
            }
        }

        return false;
    }

    /**
     * Check for Discord invite links
     */
    async checkInviteFilter(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const content = message.content;
        const matches = content.match(this.inviteRegex);
        
        if (!matches) return { violated: false };

        // Check if it's own server invite (if allowed)
        if (config.allowOwn) {
            try {
                const invites = await message.guild.invites.fetch();
                const ownCodes = invites.map(inv => inv.code);
                const filteredMatches = matches.filter(m => {
                    const code = m.split('/').pop();
                    return !ownCodes.includes(code);
                });
                if (filteredMatches.length === 0) return { violated: false };
            } catch (e) {
                // If we can't fetch invites, just check all matches
            }
        }

        // Check whitelist
        if (config.whitelist && Array.isArray(config.whitelist)) {
            const allWhitelisted = matches.every(m => {
                const code = m.split('/').pop();
                return config.whitelist.includes(code);
            });
            if (allWhitelisted) return { violated: false };
        }

        return { violated: true, reason: 'Discord invite link detected' };
    }

    /**
     * Check for blacklisted words/patterns
     */
    async checkWordFilter(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const content = message.content.toLowerCase();
        
        // Check word list
        if (config.words && Array.isArray(config.words)) {
            for (const word of config.words) {
                if (word && content.includes(word.toLowerCase())) {
                    return { violated: true, reason: `Blocked word detected: ${word.substring(0, 3)}***` };
                }
            }
        }

        // Check regex patterns
        if (config.regex && Array.isArray(config.regex)) {
            for (const pattern of config.regex) {
                try {
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(content)) {
                        return { violated: true, reason: 'Blocked pattern detected' };
                    }
                } catch (e) {
                    // Invalid regex, skip
                }
            }
        }

        return { violated: false };
    }

    /**
     * Check for mention spam
     */
    async checkMentionSpam(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const maxMentions = config.maxMentions || 5;
        const maxRolePings = config.maxRolePings || 2;
        
        const userMentions = message.mentions.users.size;
        const roleMentions = message.mentions.roles.size;
        
        // Check @everyone/@here
        if (message.mentions.everyone) {
            return { violated: true, reason: '@everyone/@here mention' };
        }
        
        if (userMentions > maxMentions) {
            return { violated: true, reason: `Too many user mentions (${userMentions}/${maxMentions})` };
        }
        
        if (roleMentions > maxRolePings) {
            return { violated: true, reason: `Too many role mentions (${roleMentions}/${maxRolePings})` };
        }

        return { violated: false };
    }

    /**
     * Check for emoji spam
     */
    async checkEmojiSpam(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const maxEmojis = config.maxEmojis || 15;
        const maxStickers = config.maxStickers || 3;
        
        // Count Unicode emojis
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        const unicodeEmojis = (message.content.match(unicodeEmojiRegex) || []).length;
        
        // Count custom emojis
        const customEmojiRegex = /<a?:\w+:\d+>/g;
        const customEmojis = (message.content.match(customEmojiRegex) || []).length;
        
        const totalEmojis = unicodeEmojis + customEmojis;
        
        if (totalEmojis > maxEmojis) {
            return { violated: true, reason: `Too many emojis (${totalEmojis}/${maxEmojis})` };
        }
        
        // Check stickers
        if (message.stickers.size > maxStickers) {
            return { violated: true, reason: `Too many stickers (${message.stickers.size}/${maxStickers})` };
        }

        return { violated: false };
    }

    /**
     * Check for excessive caps
     */
    async checkCapsFilter(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const maxPercent = config.maxPercent || 80;
        const minLength = config.minLength || 10;
        const content = message.content;
        
        if (content.length < minLength) return { violated: false };
        
        const letters = content.match(/[a-zA-Z]/g) || [];
        if (letters.length === 0) return { violated: false };
        
        const uppercase = letters.filter(c => c === c.toUpperCase()).length;
        const percent = (uppercase / letters.length) * 100;
        
        if (percent > maxPercent) {
            return { violated: true, reason: `Excessive caps (${Math.round(percent)}% > ${maxPercent}%)` };
        }

        return { violated: false };
    }

    /**
     * Check message length limits
     */
    async checkLengthFilter(message, config) {
        if (!config?.enabled) return { violated: false };
        
        const minLength = config.minLength || 0;
        const maxLength = config.maxLength || 2000;
        const content = message.content;
        
        if (minLength > 0 && content.length < minLength) {
            return { violated: true, reason: `Message too short (${content.length} < ${minLength})` };
        }
        
        if (content.length > maxLength) {
            return { violated: true, reason: `Message too long (${content.length} > ${maxLength})` };
        }

        return { violated: false };
    }

    /**
     * Handle a violation - apply the configured action
     */
    async handleViolation(message, filterName, reason, filterConfig) {
        const guildId = message.guildId;
        const userId = message.author.id;
        const action = filterConfig?.action || 'delete';
        
        this.bot.logger?.info(`[AutoMod] ${filterName} violation by ${message.author.tag} in ${message.guild.name}: ${reason}`);

        // Track violations for escalation
        const key = `${guildId}_${userId}`;
        const violations = this.userViolations.get(key) || { count: 0, lastViolation: 0 };
        violations.count++;
        violations.lastViolation = Date.now();
        this.userViolations.set(key, violations);

        // Always try to delete the message first
        try {
            await message.delete();
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to delete message:`, e.message);
        }

        // Apply action based on configuration
        switch (action) {
            case 'delete':
                // Message already deleted above
                break;
                
            case 'warn':
                await this.sendWarning(message, filterName, reason);
                break;
                
            case 'timeout':
                await this.applyTimeout(message, filterName, reason, filterConfig);
                break;
                
            case 'kick':
                await this.applyKick(message, filterName, reason);
                break;
        }

        // Log to database
        try {
            await this.bot.database?.run(`
                INSERT INTO automod_logs (guild_id, user_id, filter_type, action, reason, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [guildId, userId, filterName, action, reason]);
        } catch (e) {
            // Table may not exist, that's ok
        }

        // Log to guild log channel
        await this.logToChannel(message, filterName, reason, action);
    }

    /**
     * Send warning to user
     */
    async sendWarning(message, filterName, reason) {
        try {
            const embed = {
                color: 0xffa500,
                title: '⚠️ AutoMod Warning',
                description: `Your message was removed for violating server rules.`,
                fields: [
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'Filter', value: filterName, inline: true }
                ],
                footer: { text: 'Please follow the server rules.' }
            };

            try {
                await message.author.send({ embeds: [embed] });
            } catch (e) {
                // Can't DM user, send ephemeral-like message in channel
                const warningMsg = await message.channel.send({
                    content: `${message.author}, ${reason}`,
                    embeds: [embed]
                });
                setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
            }
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to send warning:`, e.message);
        }
    }

    /**
     * Apply timeout to user
     */
    async applyTimeout(message, filterName, reason, filterConfig) {
        if (!message.member || !message.member.moderatable) return;

        try {
            const duration = (filterConfig?.timeoutDuration || 5) * 60 * 1000; // Default 5 minutes
            await message.member.timeout(duration, `AutoMod: ${reason}`);
            
            await this.bot.database?.logAction({
                guildId: message.guildId,
                actionType: 'timeout',
                actionCategory: 'automod',
                targetUserId: message.author.id,
                targetUsername: message.author.tag,
                moderatorId: this.bot.client.user.id,
                moderatorUsername: this.bot.client.user.tag,
                reason: `AutoMod ${filterName}: ${reason}`,
                duration: `${Math.round(duration/60000)}m`,
                canUndo: true,
                expiresAt: new Date(Date.now() + duration).toISOString(),
                details: { filterName, auto: true }
            });
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to timeout user:`, e.message);
        }
    }

    /**
     * Kick user
     */
    async applyKick(message, filterName, reason) {
        if (!message.member || !message.member.kickable) return;

        try {
            await message.member.kick(`AutoMod: ${reason}`);
            
            await this.bot.database?.logAction({
                guildId: message.guildId,
                actionType: 'kick',
                actionCategory: 'automod',
                targetUserId: message.author.id,
                targetUsername: message.author.tag,
                moderatorId: this.bot.client.user.id,
                moderatorUsername: this.bot.client.user.tag,
                reason: `AutoMod ${filterName}: ${reason}`,
                canUndo: false,
                details: { filterName, auto: true }
            });
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to kick user:`, e.message);
        }
    }

    /**
     * Log violation to guild's log channel
     */
    async logToChannel(message, filterName, reason, action) {
        try {
            const config = await this.bot.database?.getGuildConfig(message.guildId);
            const logChannelId = config?.log_channel_id;
            
            if (!logChannelId) return;
            
            const logChannel = message.guild.channels.cache.get(logChannelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const embed = {
                color: 0xff6b6b,
                title: '🤖 AutoMod Action',
                fields: [
                    { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Filter', value: filterName, inline: true },
                    { name: 'Action', value: action, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Channel', value: `<#${message.channelId}>`, inline: true }
                ],
                timestamp: new Date().toISOString()
            };

            await logChannel.send({ embeds: [embed] });
        } catch (e) {
            this.bot.logger?.warn(`[AutoMod] Failed to log to channel:`, e.message);
        }
    }

    /**
     * Check if member has moderator permissions
     */
    hasModeratorPermissions(member) {
        if (!member) return false;
        return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
               member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
               member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    /**
     * Clean up old violation tracking
     */
    cleanup() {
        const now = Date.now();
        const timeout = 60 * 60 * 1000; // 1 hour
        
        for (const [key, data] of this.userViolations) {
            if (now - data.lastViolation > timeout) {
                this.userViolations.delete(key);
            }
        }
    }
}

module.exports = AutoMod;
