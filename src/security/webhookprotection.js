/**
 * Webhook Protection System
 * Monitors and protects against webhook abuse and spam
 */

const { EmbedBuilder, AuditLogEvent } = require('discord.js');

class WebhookProtection {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.webhookActivity = new Map(); // Track webhook message rates
        this.webhookCache = new Map(); // Cache guild webhooks
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('WebhookProtection initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Webhook protection config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS webhook_protection_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        log_channel_id TEXT,
                        auto_delete_spam INTEGER DEFAULT 1,
                        auto_delete_unknown INTEGER DEFAULT 0,
                        rate_limit INTEGER DEFAULT 10,
                        rate_window INTEGER DEFAULT 60,
                        whitelist_bots INTEGER DEFAULT 1,
                        notify_on_create INTEGER DEFAULT 1,
                        notify_on_delete INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Whitelisted webhooks
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS webhook_whitelist (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        webhook_id TEXT NOT NULL,
                        webhook_name TEXT,
                        added_by TEXT,
                        reason TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, webhook_id)
                    )
                `);

                // Webhook activity log
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS webhook_activity_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        webhook_id TEXT,
                        webhook_name TEXT,
                        channel_id TEXT,
                        action_type TEXT,
                        action_by TEXT,
                        details TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhook_whitelist_guild ON webhook_whitelist(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhook_activity_guild ON webhook_activity_log(guild_id)`);
            });
        });
    }

    // Get config for guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM webhook_protection_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup webhook protection
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO webhook_protection_config (guild_id, enabled, log_channel_id, rate_limit, rate_window)
                 VALUES (?, 1, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    log_channel_id = ?,
                    rate_limit = ?,
                    rate_window = ?`,
                [guildId, settings.logChannelId, settings.rateLimit || 10, settings.rateWindow || 60,
                 settings.logChannelId, settings.rateLimit || 10, settings.rateWindow || 60],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update config settings
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
                `UPDATE webhook_protection_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Whitelist a webhook
    async whitelistWebhook(guildId, webhookId, options = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO webhook_whitelist (guild_id, webhook_id, webhook_name, added_by, reason)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, webhook_id) DO UPDATE SET
                    webhook_name = ?,
                    reason = ?`,
                [guildId, webhookId, options.name, options.addedBy, options.reason,
                 options.name, options.reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Remove from whitelist
    async removeFromWhitelist(guildId, webhookId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM webhook_whitelist WHERE guild_id = ? AND webhook_id = ?',
                [guildId, webhookId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Check if webhook is whitelisted
    async isWhitelisted(guildId, webhookId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM webhook_whitelist WHERE guild_id = ? AND webhook_id = ?',
                [guildId, webhookId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
    }

    // Get whitelist
    async getWhitelist(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM webhook_whitelist WHERE guild_id = ? ORDER BY created_at DESC',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Check webhook message for spam
    async checkMessage(message) {
        if (!message.webhookId) return { allowed: true };

        const config = await this.getConfig(message.guildId);
        if (!config?.enabled) return { allowed: true };

        // Check whitelist
        const whitelisted = await this.isWhitelisted(message.guildId, message.webhookId);
        if (whitelisted) return { allowed: true };

        // Rate limiting
        const key = `${message.guildId}-${message.webhookId}`;
        const now = Date.now();
        const windowMs = (config.rate_window || 60) * 1000;
        
        if (!this.webhookActivity.has(key)) {
            this.webhookActivity.set(key, []);
        }

        const activity = this.webhookActivity.get(key);
        
        // Clean old entries
        const cutoff = now - windowMs;
        while (activity.length > 0 && activity[0] < cutoff) {
            activity.shift();
        }

        // Add current message
        activity.push(now);

        // Check rate limit
        if (activity.length > (config.rate_limit || 10)) {
            // Rate limit exceeded
            await this.logActivity(message.guildId, {
                webhookId: message.webhookId,
                channelId: message.channelId,
                actionType: 'rate_limit_exceeded',
                details: { messageCount: activity.length, window: config.rate_window }
            });

            if (config.auto_delete_spam) {
                try {
                    await message.delete();
                    return { allowed: false, action: 'deleted', reason: 'Rate limit exceeded' };
                } catch (error) {
                    return { allowed: false, action: 'failed', reason: 'Rate limit exceeded' };
                }
            }

            return { allowed: false, action: 'flagged', reason: 'Rate limit exceeded' };
        }

        return { allowed: true };
    }

    // Handle webhook creation
    async handleWebhookCreate(webhook) {
        const config = await this.getConfig(webhook.guildId);
        if (!config?.enabled) return;

        await this.logActivity(webhook.guildId, {
            webhookId: webhook.id,
            webhookName: webhook.name,
            channelId: webhook.channelId,
            actionType: 'webhook_created',
            details: { url: webhook.url ? 'Generated' : 'N/A' }
        });

        if (config.notify_on_create && config.log_channel_id) {
            await this.sendLogNotification(webhook.guild, config, 'create', webhook);
        }
    }

    // Handle webhook deletion
    async handleWebhookDelete(webhook) {
        const config = await this.getConfig(webhook.guildId);
        if (!config?.enabled) return;

        await this.logActivity(webhook.guildId, {
            webhookId: webhook.id,
            webhookName: webhook.name,
            channelId: webhook.channelId,
            actionType: 'webhook_deleted'
        });

        if (config.notify_on_delete && config.log_channel_id) {
            await this.sendLogNotification(webhook.guild, config, 'delete', webhook);
        }
    }

    // Handle webhook update
    async handleWebhookUpdate(channel) {
        const config = await this.getConfig(channel.guildId);
        if (!config?.enabled) return;

        await this.logActivity(channel.guildId, {
            channelId: channel.id,
            actionType: 'webhook_updated'
        });
    }

    // Log webhook activity
    async logActivity(guildId, data) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO webhook_activity_log (guild_id, webhook_id, webhook_name, channel_id, action_type, action_by, details)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [guildId, data.webhookId, data.webhookName, data.channelId, 
                 data.actionType, data.actionBy, data.details ? JSON.stringify(data.details) : null],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get activity log
    async getActivityLog(guildId, limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM webhook_activity_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Send log notification
    async sendLogNotification(guild, config, action, webhook) {
        if (!config.log_channel_id) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTimestamp();

        if (action === 'create') {
            embed
                .setTitle('🔗 Webhook Created')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Name', value: webhook.name || 'Unknown', inline: true },
                    { name: 'ID', value: webhook.id, inline: true },
                    { name: 'Channel', value: `<#${webhook.channelId}>`, inline: true }
                );
        } else if (action === 'delete') {
            embed
                .setTitle('🗑️ Webhook Deleted')
                .setColor(0xFF6600)
                .addFields(
                    { name: 'Name', value: webhook.name || 'Unknown', inline: true },
                    { name: 'ID', value: webhook.id, inline: true }
                );
        } else if (action === 'rate_limit') {
            embed
                .setTitle('⚠️ Webhook Rate Limit')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Webhook ID', value: webhook.id || 'Unknown', inline: true },
                    { name: 'Action Taken', value: 'Messages deleted', inline: true }
                );
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Scan guild for webhooks
    async scanGuildWebhooks(guild) {
        const webhooks = [];

        try {
            const guildWebhooks = await guild.fetchWebhooks();
            
            for (const [, webhook] of guildWebhooks) {
                webhooks.push({
                    id: webhook.id,
                    name: webhook.name,
                    channelId: webhook.channelId,
                    owner: webhook.owner?.id,
                    createdAt: webhook.createdAt
                });
            }
        } catch (error) {
            this.bot.logger.error('Failed to fetch webhooks:', error);
        }

        return webhooks;
    }

    // Delete a webhook
    async deleteWebhook(guild, webhookId, reason = 'Deleted by webhook protection') {
        try {
            const webhooks = await guild.fetchWebhooks();
            const webhook = webhooks.get(webhookId);
            
            if (webhook) {
                await webhook.delete(reason);
                return { success: true };
            }
            
            return { success: false, error: 'Webhook not found' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = WebhookProtection;
