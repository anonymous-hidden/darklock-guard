/**
 * Reputation System
 * Tracks user reputation with karma/points system
 */

const { EmbedBuilder } = require('discord.js');

class ReputationSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.cooldowns = new Map(); // Rep cooldowns
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('ReputationSystem initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Reputation config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS reputation_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        cooldown_hours INTEGER DEFAULT 24,
                        max_rep_per_day INTEGER DEFAULT 3,
                        self_rep_allowed INTEGER DEFAULT 0,
                        announce_channel_id TEXT,
                        rep_roles TEXT,
                        negative_allowed INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // User reputation
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS user_reputation (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        reputation INTEGER DEFAULT 0,
                        positive_received INTEGER DEFAULT 0,
                        negative_received INTEGER DEFAULT 0,
                        reps_given_today INTEGER DEFAULT 0,
                        last_rep_reset DATETIME DEFAULT CURRENT_TIMESTAMP,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, user_id)
                    )
                `);

                // Reputation log
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS reputation_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        from_user_id TEXT NOT NULL,
                        to_user_id TEXT NOT NULL,
                        amount INTEGER NOT NULL,
                        reason TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Reputation milestones
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS reputation_milestones (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        reputation_required INTEGER NOT NULL,
                        role_id TEXT,
                        title TEXT,
                        UNIQUE(guild_id, reputation_required)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_rep_guild ON user_reputation(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_rep_user ON user_reputation(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_rep_log_guild ON reputation_log(guild_id)`);
            });
        });
    }

    // Get config
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM reputation_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup reputation
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO reputation_config (guild_id, enabled, cooldown_hours, announce_channel_id)
                 VALUES (?, 1, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    cooldown_hours = ?,
                    announce_channel_id = ?`,
                [guildId, settings.cooldownHours || 24, settings.announceChannelId,
                 settings.cooldownHours || 24, settings.announceChannelId],
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
                `UPDATE reputation_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Get user reputation
    async getUserRep(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM user_reputation WHERE guild_id = ? AND user_id = ?',
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { reputation: 0, positive_received: 0, negative_received: 0, reps_given_today: 0 });
                }
            );
        });
    }

    // Ensure user exists
    async ensureUser(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR IGNORE INTO user_reputation (guild_id, user_id) VALUES (?, ?)`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Give reputation
    async giveRep(guildId, fromUserId, toUserId, amount = 1, reason = null) {
        const config = await this.getConfig(guildId);
        if (!config?.enabled) {
            return { success: false, error: 'Reputation system is not enabled' };
        }

        // Check self rep
        if (fromUserId === toUserId && !config.self_rep_allowed) {
            return { success: false, error: 'You cannot give reputation to yourself' };
        }

        // Check negative allowed
        if (amount < 0 && !config.negative_allowed) {
            return { success: false, error: 'Negative reputation is not allowed in this server' };
        }

        // Check cooldown
        const cooldownKey = `${guildId}-${fromUserId}-${toUserId}`;
        const cooldownEnd = this.cooldowns.get(cooldownKey);
        if (cooldownEnd && Date.now() < cooldownEnd) {
            const remainingMs = cooldownEnd - Date.now();
            const hours = Math.ceil(remainingMs / (1000 * 60 * 60));
            return { success: false, error: `You can give reputation to this user again in ${hours} hour(s)` };
        }

        // Check daily limit
        await this.ensureUser(guildId, fromUserId);
        const giver = await this.getUserRep(guildId, fromUserId);
        
        // Reset daily count if needed
        const lastReset = new Date(giver.last_rep_reset);
        const now = new Date();
        if (now - lastReset > 24 * 60 * 60 * 1000) {
            await this.resetDailyCount(guildId, fromUserId);
            giver.reps_given_today = 0;
        }

        if (giver.reps_given_today >= (config.max_rep_per_day || 3)) {
            return { success: false, error: 'You have reached your daily reputation limit' };
        }

        // Give reputation
        await this.ensureUser(guildId, toUserId);
        await this.updateReputation(guildId, toUserId, amount);
        await this.incrementGiverCount(guildId, fromUserId);
        await this.logRep(guildId, fromUserId, toUserId, amount, reason);

        // Set cooldown
        const cooldownHours = config.cooldown_hours || 24;
        this.cooldowns.set(cooldownKey, Date.now() + (cooldownHours * 60 * 60 * 1000));

        // Check milestones
        const newRep = await this.getUserRep(guildId, toUserId);
        await this.checkMilestones(guildId, toUserId, newRep.reputation);

        // Announce if configured
        if (config.announce_channel_id) {
            await this.announceRep(guildId, config, fromUserId, toUserId, amount, newRep.reputation);
        }

        return { success: true, newReputation: newRep.reputation };
    }

    // Update user reputation
    async updateReputation(guildId, userId, amount) {
        const column = amount > 0 ? 'positive_received' : 'negative_received';
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_reputation SET reputation = reputation + ?, ${column} = ${column} + 1
                 WHERE guild_id = ? AND user_id = ?`,
                [amount, guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Increment giver count
    async incrementGiverCount(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_reputation SET reps_given_today = reps_given_today + 1
                 WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Reset daily count
    async resetDailyCount(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_reputation SET reps_given_today = 0, last_rep_reset = CURRENT_TIMESTAMP
                 WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Log reputation
    async logRep(guildId, fromUserId, toUserId, amount, reason) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO reputation_log (guild_id, from_user_id, to_user_id, amount, reason)
                 VALUES (?, ?, ?, ?, ?)`,
                [guildId, fromUserId, toUserId, amount, reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get reputation history
    async getRepHistory(guildId, userId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM reputation_log WHERE guild_id = ? AND (from_user_id = ? OR to_user_id = ?)
                 ORDER BY created_at DESC LIMIT ?`,
                [guildId, userId, userId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get leaderboard
    async getLeaderboard(guildId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM user_reputation WHERE guild_id = ? AND reputation > 0
                 ORDER BY reputation DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get user rank
    async getUserRank(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT COUNT(*) + 1 as rank FROM user_reputation 
                 WHERE guild_id = ? AND reputation > (
                     SELECT COALESCE(reputation, 0) FROM user_reputation WHERE guild_id = ? AND user_id = ?
                 )`,
                [guildId, guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.rank || 0);
                }
            );
        });
    }

    // Add milestone
    async addMilestone(guildId, repRequired, roleId = null, title = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO reputation_milestones (guild_id, reputation_required, role_id, title)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(guild_id, reputation_required) DO UPDATE SET
                    role_id = ?, title = ?`,
                [guildId, repRequired, roleId, title, roleId, title],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get milestones
    async getMilestones(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM reputation_milestones WHERE guild_id = ? ORDER BY reputation_required ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Remove milestone
    async removeMilestone(guildId, repRequired) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM reputation_milestones WHERE guild_id = ? AND reputation_required = ?`,
                [guildId, repRequired],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Check and award milestones
    async checkMilestones(guildId, userId, currentRep) {
        const milestones = await this.getMilestones(guildId);
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        for (const milestone of milestones) {
            if (currentRep >= milestone.reputation_required && milestone.role_id) {
                const role = guild.roles.cache.get(milestone.role_id);
                if (role && !member.roles.cache.has(role.id)) {
                    await member.roles.add(role).catch(() => {});
                }
            }
        }
    }

    // Announce reputation
    async announceRep(guildId, config, fromUserId, toUserId, amount, newTotal) {
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.announce_channel_id).catch(() => null);
        if (!channel) return;

        const icon = amount > 0 ? '⬆️' : '⬇️';
        const embed = new EmbedBuilder()
            .setDescription(`${icon} <@${fromUserId}> gave ${amount > 0 ? '+' : ''}${amount} rep to <@${toUserId}>!\nThey now have **${newTotal}** reputation.`)
            .setColor(amount > 0 ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Set reputation (admin)
    async setRep(guildId, userId, amount) {
        await this.ensureUser(guildId, userId);
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_reputation SET reputation = ? WHERE guild_id = ? AND user_id = ?`,
                [amount, guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Reset user reputation
    async resetUserRep(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_reputation SET reputation = 0, positive_received = 0, negative_received = 0
                 WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Get stats
    async getStats(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(*) as total_users,
                    SUM(reputation) as total_rep,
                    AVG(reputation) as avg_rep,
                    MAX(reputation) as max_rep
                 FROM user_reputation WHERE guild_id = ?`,
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_users: 0, total_rep: 0, avg_rep: 0, max_rep: 0 });
                }
            );
        });
    }
}

module.exports = ReputationSystem;
