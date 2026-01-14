/**
 * Emoji/Sticker Spam Detection System
 * Detects and handles excessive emoji and sticker spam
 */

const { EmbedBuilder } = require('discord.js');

class EmojiSpamDetector {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.userActivity = new Map(); // Track user emoji usage
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('EmojiSpamDetector initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Emoji spam config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS emoji_spam_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        max_emojis_per_message INTEGER DEFAULT 10,
                        max_stickers_per_message INTEGER DEFAULT 3,
                        max_emoji_percentage INTEGER DEFAULT 70,
                        action_type TEXT DEFAULT 'delete',
                        timeout_duration INTEGER DEFAULT 300,
                        log_channel_id TEXT,
                        ignore_nitro INTEGER DEFAULT 0,
                        whitelist_roles TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Spam incidents log
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS emoji_spam_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        channel_id TEXT,
                        message_id TEXT,
                        emoji_count INTEGER,
                        sticker_count INTEGER,
                        action_taken TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_emoji_spam_guild ON emoji_spam_log(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_emoji_spam_user ON emoji_spam_log(user_id)`);
            });
        });
    }

    // Get config for guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM emoji_spam_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup emoji spam detection
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO emoji_spam_config (guild_id, enabled, max_emojis_per_message, max_stickers_per_message, action_type, log_channel_id)
                 VALUES (?, 1, ?, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    max_emojis_per_message = ?,
                    max_stickers_per_message = ?,
                    action_type = ?,
                    log_channel_id = ?`,
                [guildId, settings.maxEmojis || 10, settings.maxStickers || 3, 
                 settings.action || 'delete', settings.logChannelId,
                 settings.maxEmojis || 10, settings.maxStickers || 3,
                 settings.action || 'delete', settings.logChannelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update config
    async updateConfig(guildId, settings) {
        const updates = [];
        const values = [];

        for (const [key, value] of Object.entries(settings)) {
            updates.push(`${key} = ?`);
            values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }

        if (updates.length === 0) return false;
        values.push(guildId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE emoji_spam_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Check message for emoji spam
    async checkMessage(message) {
        if (!message.guild || message.author.bot) return { isSpam: false };

        const config = await this.getConfig(message.guildId);
        if (!config?.enabled) return { isSpam: false };

        // Check whitelist roles
        if (config.whitelist_roles) {
            const whitelistRoles = config.whitelist_roles.split(',');
            if (message.member && message.member.roles.cache.some(r => whitelistRoles.includes(r.id))) {
                return { isSpam: false };
            }
        }

        const content = message.content;
        const stickers = message.stickers.size;

        // Count emojis
        const emojiStats = this.countEmojis(content);

        let isSpam = false;
        let reason = '';

        // Check emoji count
        if (emojiStats.total > (config.max_emojis_per_message || 10)) {
            isSpam = true;
            reason = `Too many emojis (${emojiStats.total}/${config.max_emojis_per_message})`;
        }

        // Check sticker count
        if (stickers > (config.max_stickers_per_message || 3)) {
            isSpam = true;
            reason = `Too many stickers (${stickers}/${config.max_stickers_per_message})`;
        }

        // Check emoji percentage
        if (config.max_emoji_percentage && emojiStats.percentage > config.max_emoji_percentage) {
            isSpam = true;
            reason = `Message is ${emojiStats.percentage}% emojis (max ${config.max_emoji_percentage}%)`;
        }

        if (!isSpam) return { isSpam: false };

        // Take action
        let actionTaken = 'none';

        try {
            switch (config.action_type) {
                case 'delete':
                    await message.delete();
                    actionTaken = 'deleted';
                    break;
                case 'warn':
                    await message.reply({ 
                        content: '⚠️ Please reduce emoji/sticker usage.',
                        allowedMentions: { repliedUser: false }
                    }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                    actionTaken = 'warned';
                    break;
                case 'delete_warn':
                    await message.delete();
                    const channel = message.channel;
                    await channel.send({
                        content: `⚠️ <@${message.author.id}>, excessive emoji/sticker usage is not allowed.`
                    }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                    actionTaken = 'delete_warn';
                    break;
                case 'timeout':
                    await message.delete();
                    const duration = (config.timeout_duration || 300) * 1000;
                    if (message.member.moderatable) {
                        await message.member.timeout(duration, 'Emoji spam');
                    }
                    actionTaken = 'timeout';
                    break;
            }
        } catch (error) {
            actionTaken = 'failed';
        }

        // Log incident
        await this.logIncident(message.guildId, {
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            emojiCount: emojiStats.total,
            stickerCount: stickers,
            actionTaken
        });

        // Send to log channel
        await this.sendLogNotification(message.guild, config, message, emojiStats, stickers, actionTaken, reason);

        return { isSpam: true, reason, action: actionTaken };
    }

    // Count emojis in message
    countEmojis(content) {
        // Custom emojis
        const customEmojis = (content.match(/<a?:[a-zA-Z0-9_]+:\d+>/g) || []).length;
        
        // Unicode emojis (simplified pattern)
        const unicodeEmojis = (content.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu) || []).length;
        
        const total = customEmojis + unicodeEmojis;
        
        // Calculate percentage
        const textWithoutEmojis = content
            .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, '')
            .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '')
            .trim();
        
        const totalChars = content.length;
        const percentage = totalChars > 0 ? Math.round(((totalChars - textWithoutEmojis.length) / totalChars) * 100) : 0;

        return {
            custom: customEmojis,
            unicode: unicodeEmojis,
            total,
            percentage
        };
    }

    // Log incident
    async logIncident(guildId, data) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO emoji_spam_log (guild_id, user_id, channel_id, message_id, emoji_count, sticker_count, action_taken)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [guildId, data.userId, data.channelId, data.messageId, data.emojiCount, data.stickerCount, data.actionTaken],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get user incidents
    async getUserIncidents(guildId, userId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM emoji_spam_log WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`,
                [guildId, userId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get recent incidents
    async getRecentIncidents(guildId, limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM emoji_spam_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get stats
    async getStats(guildId, days = 7) {
        const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(*) as total_incidents,
                    COUNT(DISTINCT user_id) as unique_users,
                    AVG(emoji_count) as avg_emoji_count
                 FROM emoji_spam_log 
                 WHERE guild_id = ? AND created_at >= ?`,
                [guildId, cutoff],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_incidents: 0, unique_users: 0, avg_emoji_count: 0 });
                }
            );
        });
    }

    // Send log notification
    async sendLogNotification(guild, config, message, emojiStats, stickerCount, actionTaken, reason) {
        if (!config.log_channel_id) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('🎭 Emoji/Sticker Spam Detected')
            .setColor(0xFFCC00)
            .addFields(
                { name: 'User', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
                { name: 'Action', value: actionTaken, inline: true },
                { name: 'Emojis', value: `${emojiStats.total} (${emojiStats.custom} custom, ${emojiStats.unicode} unicode)`, inline: true },
                { name: 'Stickers', value: `${stickerCount}`, inline: true },
                { name: 'Emoji %', value: `${emojiStats.percentage}%`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Add role to whitelist
    async addWhitelistRole(guildId, roleId) {
        const config = await this.getConfig(guildId);
        let roles = config?.whitelist_roles ? config.whitelist_roles.split(',') : [];
        
        if (!roles.includes(roleId)) {
            roles.push(roleId);
        }

        return this.updateConfig(guildId, { whitelist_roles: roles.join(',') });
    }

    // Remove role from whitelist
    async removeWhitelistRole(guildId, roleId) {
        const config = await this.getConfig(guildId);
        let roles = config?.whitelist_roles ? config.whitelist_roles.split(',') : [];
        
        roles = roles.filter(r => r !== roleId);

        return this.updateConfig(guildId, { whitelist_roles: roles.join(',') || null });
    }
}

module.exports = EmojiSpamDetector;
