/**
 * Enhanced Confirmation System for Dashboard Settings
 * Provides real-time confirmation messages when settings are changed
 */

class ConfirmationManager {
    constructor(bot) {
        this.bot = bot;
        this.pendingConfirmations = new Map();
        this.confirmationChannels = new Map(); // guildId -> channelId
    }

    /**
     * Send confirmation message to Discord and dashboard
     */
    async sendConfirmation(guildId, settingType, settingName, newValue, oldValue, userId) {
        try {
            // Get guild
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) {
                console.error(`Guild ${guildId} not found for confirmation`);
                return;
            }

            // Get confirmation channel or log channel
            let channel = await this.getConfirmationChannel(guild);
            
            if (!channel) {
                console.warn(`No confirmation channel found for guild ${guild.name}`);
                return;
            }

            // Get user who made the change
            const user = await this.bot.client.users.fetch(userId).catch(() => null);
            const username = user ? user.username : 'Unknown User';

            // Create confirmation embed
            const embed = this.createConfirmationEmbed(
                settingType, 
                settingName, 
                newValue, 
                oldValue, 
                username
            );

            // Send to Discord
            await channel.send({ embeds: [embed] });

            // Log to dashboard
            if (this.bot.dashboardLogger) {
                await this.bot.dashboardLogger.logSettingChange(
                    settingType,
                    settingName,
                    newValue,
                    oldValue,
                    userId,
                    username,
                    guildId,
                    guild.name
                );
            }

            // Broadcast to dashboard in real-time
            if (this.bot.dashboard && this.bot.dashboard.wss) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'setting_confirmation',
                    data: {
                        settingType,
                        settingName,
                        newValue,
                        oldValue,
                        user: username,
                        timestamp: new Date().toISOString(),
                        message: this.generateConfirmationText(settingType, settingName, newValue)
                    }
                });
            }

            this.bot.logger?.info(`[CONFIRMATION] Setting updated: ${settingType}.${settingName} = ${newValue} by ${username} in ${guild.name}`);

        } catch (error) {
            console.error('Error sending confirmation:', error);
        }
    }

    /**
     * Get or set confirmation channel for guild
     */
    async getConfirmationChannel(guild) {
        // Try to get stored confirmation channel
        let channelId = this.confirmationChannels.get(guild.id);
        
        if (!channelId) {
            // Try to get from database
            try {
                const result = await this.bot.database.get(
                    'SELECT log_channel_id FROM guild_settings WHERE guild_id = ?',
                    [guild.id]
                );
                channelId = result?.log_channel_id;
            } catch (error) {
                console.error('Error getting log channel from database:', error);
            }
        }

        if (channelId) {
            const channel = guild.channels.cache.get(channelId);
            if (channel && channel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
                return channel;
            }
        }

        // Find suitable channel as fallback
        const suitableChannels = [
            'security-logs', 'mod-logs', 'bot-logs', 'logs',
            'security', 'moderation', 'admin', 'general'
        ];

        for (const name of suitableChannels) {
            const channel = guild.channels.cache.find(c => 
                c.name.toLowerCase().includes(name) && 
                c.type === 0 && // Text channel
                c.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])
            );
            
            if (channel) {
                this.confirmationChannels.set(guild.id, channel.id);
                return channel;
            }
        }

        // Get first available text channel as last resort
        const firstChannel = guild.channels.cache.find(c => 
            c.type === 0 &&
            c.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])
        );

        if (firstChannel) {
            this.confirmationChannels.set(guild.id, firstChannel.id);
        }

        return firstChannel;
    }

    /**
     * Create confirmation embed
     */
    createConfirmationEmbed(settingType, settingName, newValue, oldValue, username) {
        const EmbedBuilder = require('discord.js').EmbedBuilder;
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Dashboard Setting Updated')
            .setColor('#00FF7F')
            .setTimestamp();

        // Format setting display name
        const displayName = this.formatSettingName(settingName);
        const categoryName = this.formatCategoryName(settingType);

        // Add fields
        embed.addFields([
            {
                name: '🏷️ Category',
                value: categoryName,
                inline: true
            },
            {
                name: '📋 Setting',
                value: displayName,
                inline: true
            },
            {
                name: '👤 Changed By',
                value: username,
                inline: true
            }
        ]);

        // Add value change information
        if (oldValue !== undefined && oldValue !== newValue) {
            embed.addFields([
                {
                    name: '🔄 Changes',
                    value: `**Before:** ${this.formatValue(oldValue)}\n**After:** ${this.formatValue(newValue)}`,
                    inline: false
                }
            ]);
        } else {
            embed.addFields([
                {
                    name: '✅ New Value',
                    value: this.formatValue(newValue),
                    inline: false
                }
            ]);
        }

        // Add description with icon
        const description = this.generateConfirmationText(settingType, settingName, newValue);
        embed.setDescription(`${description}\n\n*✅ Dashboard and bot are synchronized*`);

        return embed;
    }

    /**
     * Format setting names for display
     */
    formatSettingName(name) {
        return name.replace(/([A-Z])/g, ' $1')
                  .replace(/^./, str => str.toUpperCase())
                  .replace(/_/g, ' ');
    }

    /**
     * Format category names for display
     */
    formatCategoryName(category) {
        const categories = {
            'security': '🛡️ Security Settings',
            'moderation': '⚖️ Moderation Settings',
            'general': '🔧 General Settings',
            'antiraid': '🚫 Anti-Raid Protection',
            'antispam': '📵 Anti-Spam Protection',
            'antiphishing': '🎣 Anti-Phishing Protection',
            'automod': '🤖 Auto-Moderation',
            'logging': '📊 Logging Settings',
            'notifications': '🔔 Notification Settings'
        };
        
        return categories[category] || `⚙️ ${this.formatSettingName(category)}`;
    }

    /**
     * Format values for display
     */
    formatValue(value) {
        if (typeof value === 'boolean') {
            return value ? '✅ Enabled' : '❌ Disabled';
        }
        if (typeof value === 'number') {
            return `\`${value}\``;
        }
        if (typeof value === 'string') {
            if (value.length > 100) {
                return `\`${value.substring(0, 97)}...\``;
            }
            return value ? `\`${value}\`` : '*Not set*';
        }
        if (Array.isArray(value)) {
            return value.length > 0 ? `\`${value.join(', ')}\`` : '*Empty list*';
        }
        return `\`${JSON.stringify(value)}\``;
    }

    /**
     * Generate confirmation text
     */
    generateConfirmationText(settingType, settingName, newValue) {
        const texts = {
            'security.antiRaid': 'Anti-raid protection has been',
            'security.antiSpam': 'Anti-spam protection has been',
            'security.linkScanning': 'Link scanning has been',
            'security.raidThreshold': 'Raid detection threshold set to',
            'security.messageLimit': 'Message limit updated to',
            'automod.level': 'Auto-moderation level set to'
        };

        const key = `${settingType}.${settingName}`;
        const baseText = texts[key] || `${this.formatSettingName(settingName)} updated to`;
        
        if (typeof newValue === 'boolean') {
            return `${baseText} ${newValue ? 'ENABLED' : 'DISABLED'}`;
        } else {
            return `${baseText} ${this.formatValue(newValue)}`;
        }
    }

    /**
     * Set confirmation channel for a guild
     */
    async setConfirmationChannel(guildId, channelId) {
        this.confirmationChannels.set(guildId, channelId);
        
        // Save to database
        if (this.bot.database) {
            // Preserve other settings: create row if missing, then update only the log_channel_id
            try {
                await this.bot.database.run('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)', [guildId]);
                await this.bot.database.run('UPDATE guild_settings SET log_channel_id = ? WHERE guild_id = ?', [channelId, guildId]);
                // Emit a setting change so the bot and dashboard react to this update
                try {
                    if (this.bot && typeof this.bot.emitSettingChange === 'function') {
                        // userId is system for confirmation channel changes
                        this.bot.emitSettingChange(guildId, 'System', 'log_channel_id', channelId);
                    }
                } catch (e) {
                    console.error('Failed to emit setting change for confirmation channel:', e);
                }
            } catch (error) {
                console.error('Error saving confirmation channel:', error);
            }
        }
    }

    /**
     * Bulk confirmation for multiple settings
     */
    async sendBulkConfirmation(guildId, changes, userId, category = 'Settings') {
        if (!changes || changes.length === 0) return;

        try {
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) return;

            const channel = await this.getConfirmationChannel(guild);
            if (!channel) return;

            const user = await this.bot.client.users.fetch(userId).catch(() => null);
            const username = user ? user.username : 'Unknown User';

            const EmbedBuilder = require('discord.js').EmbedBuilder;
            
            const embed = new EmbedBuilder()
                .setTitle(`⚙️ ${category} Bulk Update`)
                .setDescription(`Multiple settings updated by **${username}**`)
                .setColor('#00FF7F')
                .setTimestamp();

            let changeText = '';
            for (const change of changes) {
                const displayName = this.formatSettingName(change.name);
                changeText += `• **${displayName}:** ${this.formatValue(change.newValue)}\n`;
            }

            embed.addFields([
                {
                    name: '📝 Changes Made',
                    value: changeText.length > 1024 ? changeText.substring(0, 1021) + '...' : changeText,
                    inline: false
                }
            ]);

            embed.setFooter({ text: `✅ All changes synchronized between dashboard and bot` });

            await channel.send({ embeds: [embed] });

            // Log each change individually
            for (const change of changes) {
                if (this.bot.dashboardLogger) {
                    await this.bot.dashboardLogger.logSettingChange(
                        category.toLowerCase(),
                        change.name,
                        change.newValue,
                        change.oldValue,
                        userId,
                        username,
                        guildId,
                        guild.name
                    );
                }
            }

        } catch (error) {
            console.error('Error sending bulk confirmation:', error);
        }
    }

    /**
     * Test confirmation system
     */
    async testConfirmation(guildId, userId) {
        await this.sendConfirmation(
            guildId,
            'security',
            'testMode',
            'enabled',
            'disabled',
            userId
        );
    }
}

module.exports = ConfirmationManager;