const EventEmitter = require('events');

class RankSystem extends EventEmitter {
    constructor(database) {
        super();
        this.database = database;
        this.xpCooldowns = new Map(); // userId_guildId -> timestamp
        this.voiceTracking = new Map(); // userId_guildId -> join timestamp
        
        // XP Configuration
        this.config = {
            messageXP: { min: 15, max: 25 },
            voiceXPPerMinute: 10,
            cooldownSeconds: 60,
            levelFormula: (level) => Math.pow(level, 2) * 100
        };
    }

    /**
     * Award XP to a user for sending a message
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @returns {Object|null} Level up info if leveled up, null otherwise
     */
    async awardMessageXP(guildId, userId) {
        // Check cooldown
        const cooldownKey = `${userId}_${guildId}`;
        const now = Date.now();
        const lastXP = this.xpCooldowns.get(cooldownKey);
        
        if (lastXP && (now - lastXP) < this.config.cooldownSeconds * 1000) {
            return null; // Still on cooldown
        }

        // Set cooldown
        this.xpCooldowns.set(cooldownKey, now);

        // Generate random XP
        const xp = Math.floor(
            Math.random() * (this.config.messageXP.max - this.config.messageXP.min + 1)
        ) + this.config.messageXP.min;

        // Award XP and check for level up
        return await this.addXP(guildId, userId, xp);
    }

    /**
     * Track voice channel time and award XP
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @param {boolean} joined - Whether user joined (true) or left (false)
     */
    async handleVoiceState(guildId, userId, joined) {
        const trackingKey = `${userId}_${guildId}`;

        if (joined) {
            // User joined voice, start tracking
            this.voiceTracking.set(trackingKey, Date.now());
        } else {
            // User left voice, calculate XP
            const joinTime = this.voiceTracking.get(trackingKey);
            if (!joinTime) return null;

            const duration = Date.now() - joinTime;
            const minutes = Math.floor(duration / 60000);
            
            if (minutes > 0) {
                const xp = minutes * this.config.voiceXPPerMinute;
                this.voiceTracking.delete(trackingKey);
                return await this.addXP(guildId, userId, xp);
            }

            this.voiceTracking.delete(trackingKey);
        }

        return null;
    }

    /**
     * Add XP to a user and check for level up
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @param {number} xpAmount - XP to add
     * @returns {Object|null} Level up info or null
     */
    async addXP(guildId, userId, xpAmount) {
        try {
            // Get current stats
            let userData = await this.database.get(
                'SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?',
                [guildId, userId]
            );

            if (!userData) {
                // Create new user entry
                await this.database.run(
                    'INSERT INTO user_levels (guild_id, user_id, xp, level, total_messages, last_xp_gain) VALUES (?, ?, ?, ?, ?, ?)',
                    [guildId, userId, xpAmount, 0, 1, new Date().toISOString()]
                );
                
                userData = { xp: xpAmount, level: 0 };
            } else {
                // Update existing user
                userData.xp += xpAmount;
                userData.total_messages = (userData.total_messages || 0) + 1;
            }

            // Check for level up
            const newLevel = this.calculateLevel(userData.xp);
            const leveledUp = newLevel > userData.level;

            if (leveledUp) {
                // Update level
                await this.database.run(
                    'UPDATE user_levels SET xp = ?, level = ?, total_messages = ?, last_xp_gain = ? WHERE guild_id = ? AND user_id = ?',
                    [userData.xp, newLevel, userData.total_messages, new Date().toISOString(), guildId, userId]
                );

                // Emit level up event
                this.emit('levelUp', {
                    guildId,
                    userId,
                    oldLevel: userData.level,
                    newLevel,
                    totalXP: userData.xp
                });

                return {
                    leveledUp: true,
                    oldLevel: userData.level,
                    newLevel,
                    totalXP: userData.xp
                };
            } else {
                // Just update XP
                await this.database.run(
                    'UPDATE user_levels SET xp = ?, total_messages = ?, last_xp_gain = ? WHERE guild_id = ? AND user_id = ?',
                    [userData.xp, userData.total_messages, new Date().toISOString(), guildId, userId]
                );
            }

            return null;
        } catch (error) {
            console.error('Error adding XP:', error);
            return null;
        }
    }

    /**
     * Calculate level from XP
     * @param {number} xp - Total XP
     * @returns {number} Level
     */
    calculateLevel(xp) {
        let level = 0;
        while (this.config.levelFormula(level + 1) <= xp) {
            level++;
        }
        return level;
    }

    /**
     * Get XP required for a specific level
     * @param {number} level - Target level
     * @returns {number} XP required
     */
    getXPForLevel(level) {
        return this.config.levelFormula(level);
    }

    /**
     * Get user stats with rank position
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @returns {Object} User stats
     */
    async getUserStats(guildId, userId) {
        try {
            const userData = await this.database.get(
                'SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?',
                [guildId, userId]
            );

            if (!userData) {
                return {
                    xp: 0,
                    level: 0,
                    total_messages: 0,
                    rank: 0
                };
            }

            // Calculate rank
            const higherRankedUsers = await this.database.get(
                'SELECT COUNT(*) as count FROM user_levels WHERE guild_id = ? AND xp > ?',
                [guildId, userData.xp]
            );

            userData.rank = (higherRankedUsers?.count || 0) + 1;

            return userData;
        } catch (error) {
            console.error('Error getting user stats:', error);
            return { xp: 0, level: 0, total_messages: 0, rank: 0 };
        }
    }

    /**
     * Get leaderboard for a guild
     * @param {string} guildId - Guild ID
     * @param {number} limit - Number of users to return
     * @param {number} offset - Offset for pagination
     * @returns {Array} Array of user stats
     */
    async getLeaderboard(guildId, limit = 10, offset = 0) {
        try {
            const users = await this.database.all(
                `SELECT user_id, xp, level, total_messages 
                 FROM user_levels 
                 WHERE guild_id = ? 
                 ORDER BY xp DESC 
                 LIMIT ? OFFSET ?`,
                [guildId, limit, offset]
            );

            return users;
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            return [];
        }
    }

    /**
     * Set user XP (admin function)
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @param {number} xp - New XP value
     */
    async setUserXP(guildId, userId, xp) {
        const level = this.calculateLevel(xp);
        
        await this.database.run(
            `INSERT INTO user_levels (guild_id, user_id, xp, level, total_messages, last_xp_gain)
             VALUES (?, ?, ?, ?, 0, ?)
             ON CONFLICT(guild_id, user_id) 
             DO UPDATE SET xp = ?, level = ?`,
            [guildId, userId, xp, level, new Date().toISOString(), xp, level]
        );
    }

    /**
     * Reset all XP in a guild (admin function)
     * @param {string} guildId - Guild ID
     */
    async resetGuildXP(guildId) {
        await this.database.run(
            'DELETE FROM user_levels WHERE guild_id = ?',
            [guildId]
        );
    }

    /**
     * Get total user count with XP in a guild
     * @param {string} guildId - Guild ID
     * @returns {number} Total user count
     */
    async getTotalUsers(guildId) {
        const result = await this.database.get(
            'SELECT COUNT(*) as total FROM user_levels WHERE guild_id = ?',
            [guildId]
        );
        return result?.total || 0;
    }
}

module.exports = RankSystem;
