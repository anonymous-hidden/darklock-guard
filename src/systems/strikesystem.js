/**
 * Strike/Points System
 * Configurable point values per offense, automatic actions at thresholds
 */

const { EmbedBuilder } = require('discord.js');

class StrikeSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('StrikeSystem initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Strike system config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS strike_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        log_channel_id TEXT,
                        decay_enabled INTEGER DEFAULT 1,
                        decay_days INTEGER DEFAULT 30,
                        decay_points INTEGER DEFAULT 1,
                        dm_on_strike INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Strike point values for different offenses
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS strike_values (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        offense_type TEXT NOT NULL,
                        points INTEGER DEFAULT 1,
                        description TEXT,
                        UNIQUE(guild_id, offense_type)
                    )
                `);

                // Auto-actions at thresholds
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS strike_thresholds (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        points_required INTEGER NOT NULL,
                        action_type TEXT NOT NULL,
                        action_duration INTEGER,
                        action_data TEXT,
                        UNIQUE(guild_id, points_required)
                    )
                `);

                // User strikes
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS user_strikes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        moderator_id TEXT NOT NULL,
                        offense_type TEXT,
                        points INTEGER NOT NULL,
                        reason TEXT,
                        evidence TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME,
                        removed INTEGER DEFAULT 0,
                        removed_by TEXT,
                        removed_at DATETIME,
                        removed_reason TEXT
                    )
                `);

                // User total points cache
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS user_strike_totals (
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        total_points INTEGER DEFAULT 0,
                        active_points INTEGER DEFAULT 0,
                        total_strikes INTEGER DEFAULT 0,
                        active_strikes INTEGER DEFAULT 0,
                        last_strike_at DATETIME,
                        PRIMARY KEY (guild_id, user_id)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_strikes_guild ON user_strikes(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_strikes_user ON user_strikes(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_strike_totals_guild ON user_strike_totals(guild_id)`);
            });
        });
    }

    // Get config for a guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM strike_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup strike system
    async setup(guildId, settings = {}) {
        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO strike_config (guild_id, enabled, log_channel_id, decay_days)
                 VALUES (?, 1, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    log_channel_id = ?,
                    decay_days = ?`,
                [guildId, settings.logChannelId, settings.decayDays || 30,
                 settings.logChannelId, settings.decayDays || 30],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });

        // Add default offense values if none exist
        await this.addDefaultOffenseValues(guildId);
        await this.addDefaultThresholds(guildId);
    }

    // Add default offense values
    async addDefaultOffenseValues(guildId) {
        const defaults = [
            { type: 'spam', points: 1, description: 'Spamming messages' },
            { type: 'toxicity', points: 2, description: 'Toxic/inappropriate messages' },
            { type: 'harassment', points: 3, description: 'Harassing other members' },
            { type: 'slur', points: 4, description: 'Using slurs or hate speech' },
            { type: 'nsfw', points: 3, description: 'NSFW content in non-NSFW channels' },
            { type: 'advertising', points: 2, description: 'Unauthorized advertising' },
            { type: 'scam', points: 5, description: 'Scamming or phishing attempts' },
            { type: 'raid', points: 5, description: 'Participating in a raid' },
            { type: 'minor', points: 1, description: 'Minor rule violation' },
            { type: 'moderate', points: 2, description: 'Moderate rule violation' },
            { type: 'severe', points: 4, description: 'Severe rule violation' }
        ];

        for (const offense of defaults) {
            await this.setOffenseValue(guildId, offense.type, offense.points, offense.description);
        }
    }

    // Add default thresholds
    async addDefaultThresholds(guildId) {
        const defaults = [
            { points: 3, action: 'warn', duration: null },
            { points: 5, action: 'timeout', duration: 3600 }, // 1 hour
            { points: 8, action: 'timeout', duration: 86400 }, // 24 hours
            { points: 10, action: 'kick', duration: null },
            { points: 15, action: 'ban', duration: null }
        ];

        for (const threshold of defaults) {
            await this.setThreshold(guildId, threshold.points, threshold.action, threshold.duration);
        }
    }

    // Set offense value
    async setOffenseValue(guildId, offenseType, points, description = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO strike_values (guild_id, offense_type, points, description)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(guild_id, offense_type) DO UPDATE SET points = ?, description = ?`,
                [guildId, offenseType, points, description, points, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Get offense value
    async getOffenseValue(guildId, offenseType) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM strike_values WHERE guild_id = ? AND offense_type = ?',
                [guildId, offenseType],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Get all offense values
    async getAllOffenseValues(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM strike_values WHERE guild_id = ? ORDER BY points ASC',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Set threshold
    async setThreshold(guildId, points, actionType, duration = null, data = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO strike_thresholds (guild_id, points_required, action_type, action_duration, action_data)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, points_required) DO UPDATE SET
                    action_type = ?,
                    action_duration = ?,
                    action_data = ?`,
                [guildId, points, actionType, duration, data, actionType, duration, data],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Get all thresholds
    async getThresholds(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM strike_thresholds WHERE guild_id = ? ORDER BY points_required ASC',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Remove threshold
    async removeThreshold(guildId, points) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM strike_thresholds WHERE guild_id = ? AND points_required = ?',
                [guildId, points],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Add strike to user
    async addStrike(guildId, userId, moderatorId, options = {}) {
        const config = await this.getConfig(guildId);
        
        let points = options.points || 1;
        
        // Get points from offense type if provided
        if (options.offenseType) {
            const offense = await this.getOffenseValue(guildId, options.offenseType);
            if (offense) {
                points = offense.points;
            }
        }

        // Calculate expiry
        let expiresAt = null;
        if (config?.decay_enabled && config.decay_days > 0) {
            expiresAt = new Date(Date.now() + (config.decay_days * 24 * 60 * 60 * 1000)).toISOString();
        }

        const strikeId = await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_strikes (guild_id, user_id, moderator_id, offense_type, points, reason, evidence, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [guildId, userId, moderatorId, options.offenseType, points, options.reason, options.evidence, expiresAt],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Update totals
        await this.updateUserTotals(guildId, userId);

        // Get new total
        const totals = await this.getUserTotals(guildId, userId);

        // Check thresholds
        const actionTaken = await this.checkThresholds(guildId, userId, totals.active_points);

        // DM user if enabled
        if (config?.dm_on_strike) {
            await this.dmUserStrike(guildId, userId, points, options.reason, totals.active_points, actionTaken);
        }

        // Log strike
        await this.logStrike(guildId, userId, moderatorId, points, options.reason, totals.active_points, actionTaken, config);

        return { 
            strikeId, 
            points, 
            totalPoints: totals.active_points, 
            actionTaken 
        };
    }

    // Update user totals
    async updateUserTotals(guildId, userId) {
        // Calculate totals from active strikes
        const stats = await new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COALESCE(SUM(points), 0) as total_points,
                    COALESCE(SUM(CASE WHEN removed = 0 AND (expires_at IS NULL OR expires_at > datetime('now')) THEN points ELSE 0 END), 0) as active_points,
                    COUNT(*) as total_strikes,
                    SUM(CASE WHEN removed = 0 AND (expires_at IS NULL OR expires_at > datetime('now')) THEN 1 ELSE 0 END) as active_strikes,
                    MAX(created_at) as last_strike_at
                 FROM user_strikes WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_points: 0, active_points: 0, total_strikes: 0, active_strikes: 0 });
                }
            );
        });

        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_strike_totals (guild_id, user_id, total_points, active_points, total_strikes, active_strikes, last_strike_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    total_points = ?,
                    active_points = ?,
                    total_strikes = ?,
                    active_strikes = ?,
                    last_strike_at = ?`,
                [guildId, userId, stats.total_points, stats.active_points, stats.total_strikes, stats.active_strikes, stats.last_strike_at,
                 stats.total_points, stats.active_points, stats.total_strikes, stats.active_strikes, stats.last_strike_at],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Get user totals
    async getUserTotals(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM user_strike_totals WHERE guild_id = ? AND user_id = ?',
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_points: 0, active_points: 0, total_strikes: 0, active_strikes: 0 });
                }
            );
        });
    }

    // Get user strikes
    async getUserStrikes(guildId, userId, includeRemoved = false) {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM user_strikes WHERE guild_id = ? AND user_id = ?`;
            if (!includeRemoved) {
                query += ` AND removed = 0`;
            }
            query += ` ORDER BY created_at DESC`;

            this.db.all(query, [guildId, userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Remove strike
    async removeStrike(strikeId, removedBy, reason = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_strikes SET removed = 1, removed_by = ?, removed_at = CURRENT_TIMESTAMP, removed_reason = ?
                 WHERE id = ? AND removed = 0`,
                [removedBy, reason, strikeId],
                async function(err) {
                    if (err) reject(err);
                    else if (this.changes > 0) {
                        // Get strike info to update totals
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            );
        });
    }

    // Clear all strikes for user
    async clearStrikes(guildId, userId, removedBy, reason = null) {
        const result = await new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_strikes SET removed = 1, removed_by = ?, removed_at = CURRENT_TIMESTAMP, removed_reason = ?
                 WHERE guild_id = ? AND user_id = ? AND removed = 0`,
                [removedBy, reason, guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        await this.updateUserTotals(guildId, userId);
        return result;
    }

    // Check thresholds and take action
    async checkThresholds(guildId, userId, totalPoints) {
        const thresholds = await this.getThresholds(guildId);
        
        // Find highest threshold that applies
        let applicableThreshold = null;
        for (const threshold of thresholds) {
            if (totalPoints >= threshold.points_required) {
                applicableThreshold = threshold;
            }
        }

        if (!applicableThreshold) return null;

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return null;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return null;

        let actionTaken = null;

        try {
            switch (applicableThreshold.action_type) {
                case 'warn':
                    actionTaken = 'Warning issued';
                    break;
                case 'timeout':
                    const duration = applicableThreshold.action_duration || 3600;
                    await member.timeout(duration * 1000, `Strike threshold reached (${totalPoints} points)`);
                    actionTaken = `Timeout (${Math.floor(duration / 60)} minutes)`;
                    break;
                case 'kick':
                    await member.kick(`Strike threshold reached (${totalPoints} points)`);
                    actionTaken = 'Kicked';
                    break;
                case 'ban':
                    await member.ban({ reason: `Strike threshold reached (${totalPoints} points)`, deleteMessageDays: 1 });
                    actionTaken = 'Banned';
                    break;
                case 'role_add':
                    if (applicableThreshold.action_data) {
                        await member.roles.add(applicableThreshold.action_data, 'Strike threshold reached');
                        actionTaken = 'Role added';
                    }
                    break;
                case 'role_remove':
                    if (applicableThreshold.action_data) {
                        await member.roles.remove(applicableThreshold.action_data, 'Strike threshold reached');
                        actionTaken = 'Role removed';
                    }
                    break;
            }
        } catch (error) {
            this.bot.logger.error('Failed to execute strike threshold action:', error);
        }

        return actionTaken;
    }

    // DM user about strike
    async dmUserStrike(guildId, userId, points, reason, totalPoints, actionTaken) {
        try {
            const user = await this.bot.client.users.fetch(userId).catch(() => null);
            if (!user) return;

            const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);

            const embed = new EmbedBuilder()
                .setTitle('⚠️ You Received a Strike')
                .setColor(0xFFA500)
                .addFields(
                    { name: 'Server', value: guild?.name || 'Unknown', inline: true },
                    { name: 'Points', value: `+${points}`, inline: true },
                    { name: 'Total Points', value: `${totalPoints}`, inline: true },
                    { name: 'Reason', value: reason || 'No reason provided', inline: false }
                )
                .setTimestamp();

            if (actionTaken) {
                embed.addFields({ name: '⚡ Action Taken', value: actionTaken, inline: false });
            }

            await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            this.bot.logger.debug('Could not DM user about strike:', error.message);
        }
    }

    // Log strike to channel
    async logStrike(guildId, userId, moderatorId, points, reason, totalPoints, actionTaken, config) {
        if (!config?.log_channel_id) return;

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const user = await this.bot.client.users.fetch(userId).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Strike Added')
            .setColor(0xFFA500)
            .addFields(
                { name: 'User', value: user ? `${user.tag}\n${user.id}` : userId, inline: true },
                { name: 'Moderator', value: `<@${moderatorId}>`, inline: true },
                { name: 'Points', value: `+${points} (Total: ${totalPoints})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided', inline: false }
            )
            .setTimestamp();

        if (actionTaken) {
            embed.addFields({ name: '⚡ Auto-Action', value: actionTaken, inline: false });
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Get leaderboard (most strikes)
    async getLeaderboard(guildId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM user_strike_totals 
                 WHERE guild_id = ? AND active_points > 0
                 ORDER BY active_points DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Run decay (call periodically)
    async runDecay() {
        // Strikes with expires_at in the past are automatically considered inactive
        // This just cleans up the totals
        const guilds = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT DISTINCT guild_id FROM strike_config WHERE decay_enabled = 1`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        for (const { guild_id } of guilds) {
            const users = await new Promise((resolve, reject) => {
                this.db.all(
                    `SELECT DISTINCT user_id FROM user_strikes WHERE guild_id = ?`,
                    [guild_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const { user_id } of users) {
                await this.updateUserTotals(guild_id, user_id);
            }
        }
    }
}

module.exports = StrikeSystem;
