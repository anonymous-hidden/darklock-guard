/**
 * Audit Log Viewer System
 * Tracks all moderation actions and provides searchable audit log
 */

const { EmbedBuilder } = require('discord.js');

class AuditLogViewer {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('AuditLogViewer initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Main audit log table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS audit_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        action_type TEXT NOT NULL,
                        moderator_id TEXT,
                        target_id TEXT,
                        target_type TEXT,
                        reason TEXT,
                        details TEXT,
                        channel_id TEXT,
                        message_id TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Audit log config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS audit_log_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 1,
                        log_channel_id TEXT,
                        track_messages INTEGER DEFAULT 1,
                        track_moderation INTEGER DEFAULT 1,
                        track_members INTEGER DEFAULT 1,
                        track_channels INTEGER DEFAULT 1,
                        track_roles INTEGER DEFAULT 1,
                        track_bans INTEGER DEFAULT 1,
                        retention_days INTEGER DEFAULT 90,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_guild ON audit_log(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action_type)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_mod ON audit_log(moderator_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at)`);
            });
        });
    }

    // Action types enum
    static get ActionTypes() {
        return {
            // Moderation
            WARN: 'WARN',
            MUTE: 'MUTE',
            UNMUTE: 'UNMUTE',
            KICK: 'KICK',
            BAN: 'BAN',
            UNBAN: 'UNBAN',
            TIMEOUT: 'TIMEOUT',
            TIMEOUT_REMOVE: 'TIMEOUT_REMOVE',
            
            // Strikes
            STRIKE_ADD: 'STRIKE_ADD',
            STRIKE_REMOVE: 'STRIKE_REMOVE',
            STRIKE_CLEAR: 'STRIKE_CLEAR',
            
            // Roles
            ROLE_ADD: 'ROLE_ADD',
            ROLE_REMOVE: 'ROLE_REMOVE',
            ROLE_CREATE: 'ROLE_CREATE',
            ROLE_DELETE: 'ROLE_DELETE',
            
            // Channels
            CHANNEL_CREATE: 'CHANNEL_CREATE',
            CHANNEL_DELETE: 'CHANNEL_DELETE',
            CHANNEL_UPDATE: 'CHANNEL_UPDATE',
            CHANNEL_LOCK: 'CHANNEL_LOCK',
            CHANNEL_UNLOCK: 'CHANNEL_UNLOCK',
            
            // Messages
            MESSAGE_DELETE: 'MESSAGE_DELETE',
            MESSAGE_BULK_DELETE: 'MESSAGE_BULK_DELETE',
            MESSAGE_EDIT: 'MESSAGE_EDIT',
            
            // Members
            MEMBER_JOIN: 'MEMBER_JOIN',
            MEMBER_LEAVE: 'MEMBER_LEAVE',
            MEMBER_UPDATE: 'MEMBER_UPDATE',
            NICKNAME_CHANGE: 'NICKNAME_CHANGE',
            
            // Auto-mod
            AUTO_MOD_TRIGGER: 'AUTO_MOD_TRIGGER',
            SPAM_DETECT: 'SPAM_DETECT',
            RAID_DETECT: 'RAID_DETECT',
            PHISHING_DETECT: 'PHISHING_DETECT',
            ALT_DETECT: 'ALT_DETECT',
            
            // Other
            SETTINGS_CHANGE: 'SETTINGS_CHANGE',
            BOT_ACTION: 'BOT_ACTION'
        };
    }

    // Get config for guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM audit_log_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup audit log
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO audit_log_config (guild_id, enabled, log_channel_id, retention_days)
                 VALUES (?, 1, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    log_channel_id = ?,
                    retention_days = ?`,
                [guildId, settings.logChannelId, settings.retentionDays || 90,
                 settings.logChannelId, settings.retentionDays || 90],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update tracking settings
    async updateTracking(guildId, settings) {
        const updates = [];
        const values = [];

        for (const [key, value] of Object.entries(settings)) {
            const column = `track_${key}`;
            updates.push(`${column} = ?`);
            values.push(value ? 1 : 0);
        }

        if (updates.length === 0) return false;

        values.push(guildId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE audit_log_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Log an action
    async log(guildId, actionType, options = {}) {
        const config = await this.getConfig(guildId);
        
        // Check if tracking is enabled for this type
        if (config) {
            const category = this.getActionCategory(actionType);
            const trackColumn = `track_${category}`;
            if (config[trackColumn] === 0) return null;
        }

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO audit_log (guild_id, action_type, moderator_id, target_id, target_type, reason, details, channel_id, message_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    guildId,
                    actionType,
                    options.moderatorId,
                    options.targetId,
                    options.targetType || 'user',
                    options.reason,
                    options.details ? JSON.stringify(options.details) : null,
                    options.channelId,
                    options.messageId
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get action category for tracking settings
    getActionCategory(actionType) {
        const moderationActions = ['WARN', 'MUTE', 'UNMUTE', 'KICK', 'TIMEOUT', 'TIMEOUT_REMOVE', 'STRIKE_ADD', 'STRIKE_REMOVE', 'STRIKE_CLEAR'];
        const banActions = ['BAN', 'UNBAN'];
        const memberActions = ['MEMBER_JOIN', 'MEMBER_LEAVE', 'MEMBER_UPDATE', 'NICKNAME_CHANGE'];
        const roleActions = ['ROLE_ADD', 'ROLE_REMOVE', 'ROLE_CREATE', 'ROLE_DELETE'];
        const channelActions = ['CHANNEL_CREATE', 'CHANNEL_DELETE', 'CHANNEL_UPDATE', 'CHANNEL_LOCK', 'CHANNEL_UNLOCK'];
        const messageActions = ['MESSAGE_DELETE', 'MESSAGE_BULK_DELETE', 'MESSAGE_EDIT'];

        if (moderationActions.includes(actionType)) return 'moderation';
        if (banActions.includes(actionType)) return 'bans';
        if (memberActions.includes(actionType)) return 'members';
        if (roleActions.includes(actionType)) return 'roles';
        if (channelActions.includes(actionType)) return 'channels';
        if (messageActions.includes(actionType)) return 'messages';
        return 'moderation';
    }

    // Get recent entries
    async getRecent(guildId, limit = 50, offset = 0) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM audit_log 
                 WHERE guild_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT ? OFFSET ?`,
                [guildId, limit, offset],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Search audit log
    async search(guildId, filters = {}) {
        let query = 'SELECT * FROM audit_log WHERE guild_id = ?';
        const params = [guildId];

        if (filters.actionType) {
            query += ' AND action_type = ?';
            params.push(filters.actionType);
        }

        if (filters.moderatorId) {
            query += ' AND moderator_id = ?';
            params.push(filters.moderatorId);
        }

        if (filters.targetId) {
            query += ' AND target_id = ?';
            params.push(filters.targetId);
        }

        if (filters.startDate) {
            query += ' AND created_at >= ?';
            params.push(filters.startDate);
        }

        if (filters.endDate) {
            query += ' AND created_at <= ?';
            params.push(filters.endDate);
        }

        if (filters.keyword) {
            query += ' AND (reason LIKE ? OR details LIKE ?)';
            params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(filters.limit || 100, filters.offset || 0);

        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Get entry by ID
    async getEntry(guildId, entryId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM audit_log WHERE id = ? AND guild_id = ?',
                [entryId, guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Get stats for a guild
    async getStats(guildId, days = 30) {
        const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

        const stats = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT action_type, COUNT(*) as count 
                 FROM audit_log 
                 WHERE guild_id = ? AND created_at >= ?
                 GROUP BY action_type
                 ORDER BY count DESC`,
                [guildId, startDate],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const totalActions = await new Promise((resolve, reject) => {
            this.db.get(
                `SELECT COUNT(*) as count FROM audit_log WHERE guild_id = ? AND created_at >= ?`,
                [guildId, startDate],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const topModerators = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT moderator_id, COUNT(*) as count 
                 FROM audit_log 
                 WHERE guild_id = ? AND created_at >= ? AND moderator_id IS NOT NULL
                 GROUP BY moderator_id
                 ORDER BY count DESC
                 LIMIT 10`,
                [guildId, startDate],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const topTargets = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT target_id, COUNT(*) as count 
                 FROM audit_log 
                 WHERE guild_id = ? AND created_at >= ? AND target_id IS NOT NULL
                 GROUP BY target_id
                 ORDER BY count DESC
                 LIMIT 10`,
                [guildId, startDate],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        return {
            totalActions,
            byType: stats,
            topModerators,
            topTargets,
            period: days
        };
    }

    // Get user history
    async getUserHistory(guildId, userId, limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM audit_log 
                 WHERE guild_id = ? AND (moderator_id = ? OR target_id = ?)
                 ORDER BY created_at DESC 
                 LIMIT ?`,
                [guildId, userId, userId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Cleanup old entries
    async cleanup(guildId = null) {
        if (guildId) {
            const config = await this.getConfig(guildId);
            const days = config?.retention_days || 90;
            const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

            return new Promise((resolve, reject) => {
                this.db.run(
                    'DELETE FROM audit_log WHERE guild_id = ? AND created_at < ?',
                    [guildId, cutoff],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    }
                );
            });
        } else {
            // Cleanup all guilds
            const configs = await new Promise((resolve, reject) => {
                this.db.all('SELECT * FROM audit_log_config', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            let totalDeleted = 0;
            for (const config of configs) {
                const deleted = await this.cleanup(config.guild_id);
                totalDeleted += deleted;
            }
            return totalDeleted;
        }
    }

    // Get action display name
    getActionName(actionType) {
        const names = {
            WARN: 'Warning',
            MUTE: 'Mute',
            UNMUTE: 'Unmute',
            KICK: 'Kick',
            BAN: 'Ban',
            UNBAN: 'Unban',
            TIMEOUT: 'Timeout',
            TIMEOUT_REMOVE: 'Timeout Removed',
            STRIKE_ADD: 'Strike Added',
            STRIKE_REMOVE: 'Strike Removed',
            STRIKE_CLEAR: 'Strikes Cleared',
            ROLE_ADD: 'Role Added',
            ROLE_REMOVE: 'Role Removed',
            ROLE_CREATE: 'Role Created',
            ROLE_DELETE: 'Role Deleted',
            CHANNEL_CREATE: 'Channel Created',
            CHANNEL_DELETE: 'Channel Deleted',
            CHANNEL_UPDATE: 'Channel Updated',
            CHANNEL_LOCK: 'Channel Locked',
            CHANNEL_UNLOCK: 'Channel Unlocked',
            MESSAGE_DELETE: 'Message Deleted',
            MESSAGE_BULK_DELETE: 'Bulk Delete',
            MESSAGE_EDIT: 'Message Edited',
            MEMBER_JOIN: 'Member Joined',
            MEMBER_LEAVE: 'Member Left',
            MEMBER_UPDATE: 'Member Updated',
            NICKNAME_CHANGE: 'Nickname Changed',
            AUTO_MOD_TRIGGER: 'Auto-Mod Triggered',
            SPAM_DETECT: 'Spam Detected',
            RAID_DETECT: 'Raid Detected',
            PHISHING_DETECT: 'Phishing Detected',
            ALT_DETECT: 'Alt Detected',
            SETTINGS_CHANGE: 'Settings Changed',
            BOT_ACTION: 'Bot Action'
        };
        return names[actionType] || actionType;
    }

    // Get action color for embeds
    getActionColor(actionType) {
        const colors = {
            WARN: 0xFFFF00,
            MUTE: 0xFF8800,
            UNMUTE: 0x00FF00,
            KICK: 0xFF6600,
            BAN: 0xFF0000,
            UNBAN: 0x00FF00,
            TIMEOUT: 0xFF8800,
            TIMEOUT_REMOVE: 0x00FF00,
            STRIKE_ADD: 0xFFA500,
            STRIKE_REMOVE: 0x00FF00,
            STRIKE_CLEAR: 0x00FF00,
            ROLE_ADD: 0x0099FF,
            ROLE_REMOVE: 0x0099FF,
            MESSAGE_DELETE: 0xFF6600,
            MESSAGE_BULK_DELETE: 0xFF0000,
            SPAM_DETECT: 0xFF0000,
            RAID_DETECT: 0xFF0000,
            PHISHING_DETECT: 0xFF0000,
            ALT_DETECT: 0xFF8800
        };
        return colors[actionType] || 0x5865F2;
    }

    // Format entry for display
    formatEntry(entry) {
        return {
            id: entry.id,
            action: this.getActionName(entry.action_type),
            actionType: entry.action_type,
            color: this.getActionColor(entry.action_type),
            moderator: entry.moderator_id,
            target: entry.target_id,
            targetType: entry.target_type,
            reason: entry.reason,
            details: entry.details ? JSON.parse(entry.details) : null,
            channel: entry.channel_id,
            timestamp: entry.created_at
        };
    }
}

module.exports = AuditLogViewer;
