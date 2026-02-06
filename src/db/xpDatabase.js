const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * XP Database Manager
 * Handles all XP-related database operations with connection pooling
 */
class XPDatabase {
    constructor(dbPath = './data/xp.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * Initialize database connection and create tables
     */
    async initialize() {
        return new Promise((resolve, reject) => {
            // Ensure data directory exists
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Connect to database
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Failed to connect to XP database:', err);
                    reject(err);
                    return;
                }
                console.log('✅ Connected to XP database');
            });

            // Enable WAL mode for better performance
            this.db.run('PRAGMA journal_mode = WAL');

            // Load and execute schema
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            this.db.exec(schema, (err) => {
                if (err) {
                    console.error('❌ Failed to initialize schema:', err);
                    reject(err);
                    return;
                }
                console.log('✅ XP database schema initialized');
                resolve();
            });
        });
    }

    /**
     * Add XP to a user with anti-spam cooldown check
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @param {number} xpAmount - Amount of XP to add
     * @returns {Promise<{success: boolean, newXP: number, newLevel: number, leveledUp: boolean, onCooldown: boolean}>}
     */
    async addXP(userId, guildId, xpAmount) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);

            // First, check cooldown and reset timers
            this.db.get(
                `SELECT xp, level, daily_xp, weekly_xp, monthly_xp, 
                        daily_reset, weekly_reset, monthly_reset, last_message_timestamp 
                 FROM user_xp 
                 WHERE user_id = ? AND guild_id = ?`,
                [userId, guildId],
                async (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Get guild settings for cooldown
                    const settings = await this.getGuildSettings(guildId);
                    const cooldown = settings.cooldown_seconds;

                    // Check cooldown
                    if (row && (now - row.last_message_timestamp) < cooldown) {
                        resolve({
                            success: false,
                            onCooldown: true,
                            newXP: row.xp,
                            newLevel: row.level,
                            leveledUp: false
                        });
                        return;
                    }

                    // Check if we need to reset daily/weekly/monthly XP
                    let dailyXP = row ? row.daily_xp : 0;
                    let weeklyXP = row ? row.weekly_xp : 0;
                    let monthlyXP = row ? row.monthly_xp : 0;
                    let dailyReset = row ? row.daily_reset : now;
                    let weeklyReset = row ? row.weekly_reset : now;
                    let monthlyReset = row ? row.monthly_reset : now;

                    // Reset daily (24 hours)
                    if (row && now - dailyReset >= 86400) {
                        dailyXP = 0;
                        dailyReset = now;
                    }

                    // Reset weekly (7 days)
                    if (row && now - weeklyReset >= 604800) {
                        weeklyXP = 0;
                        weeklyReset = now;
                    }

                    // Reset monthly (30 days)
                    if (row && now - monthlyReset >= 2592000) {
                        monthlyXP = 0;
                        monthlyReset = now;
                    }

                    // Calculate new XP and level
                    const currentXP = row ? row.xp : 0;
                    const currentLevel = row ? row.level : 0;
                    const newXP = currentXP + xpAmount;
                    const newLevel = this.calculateLevel(newXP);
                    const leveledUp = newLevel > currentLevel;

                    // Insert or update user XP with time-based tracking
                    this.db.run(
                        `INSERT INTO user_xp (
                            user_id, guild_id, xp, level, 
                            daily_xp, weekly_xp, monthly_xp,
                            daily_reset, weekly_reset, monthly_reset,
                            total_messages, last_message_timestamp, updated_at
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                         ON CONFLICT(user_id, guild_id) 
                         DO UPDATE SET 
                            xp = xp + ?,
                            level = ?,
                            daily_xp = ? + ?,
                            weekly_xp = ? + ?,
                            monthly_xp = ? + ?,
                            daily_reset = ?,
                            weekly_reset = ?,
                            monthly_reset = ?,
                            total_messages = total_messages + 1,
                            last_message_timestamp = ?,
                            updated_at = ?`,
                        [
                            userId, guildId, newXP, newLevel, 
                            xpAmount, xpAmount, xpAmount,
                            dailyReset, weeklyReset, monthlyReset,
                            now, now,
                            xpAmount, newLevel, 
                            dailyXP, xpAmount,
                            weeklyXP, xpAmount,
                            monthlyXP, xpAmount,
                            dailyReset, weeklyReset, monthlyReset,
                            now, now
                        ],
                        (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            resolve({
                                success: true,
                                onCooldown: false,
                                newXP,
                                newLevel,
                                leveledUp,
                                previousLevel: currentLevel
                            });
                        }
                    );
                }
            );
        });
    }

    /**
     * Calculate level from XP using formula: level = floor(0.1 * sqrt(xp))
     * @param {number} xp - Total XP
     * @returns {number} Level
     */
    calculateLevel(xp) {
        return Math.floor(0.1 * Math.sqrt(xp));
    }

    /**
     * Calculate XP needed for a specific level
     * @param {number} level - Target level
     * @returns {number} XP required
     */
    calculateXPForLevel(level) {
        return Math.pow((level / 0.1), 2);
    }

    /**
     * Get user XP stats
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @returns {Promise<Object>}
     */
    async getUserStats(userId, guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    xp, 
                    level, 
                    total_messages,
                    (SELECT COUNT(*) + 1 FROM user_xp WHERE guild_id = ? AND xp > (SELECT xp FROM user_xp WHERE user_id = ? AND guild_id = ?)) as rank
                 FROM user_xp 
                 WHERE user_id = ? AND guild_id = ?`,
                [guildId, userId, guildId, userId, guildId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        resolve({
                            xp: 0,
                            level: 0,
                            total_messages: 0,
                            rank: null,
                            xp_current_level: 0,
                            xp_next_level: 100,
                            progress_percent: 0
                        });
                        return;
                    }

                    const xpCurrentLevel = this.calculateXPForLevel(row.level);
                    const xpNextLevel = this.calculateXPForLevel(row.level + 1);
                    const xpProgress = row.xp - xpCurrentLevel;
                    const xpNeeded = xpNextLevel - xpCurrentLevel;
                    const progressPercent = Math.floor((xpProgress / xpNeeded) * 100);

                    resolve({
                        xp: row.xp,
                        level: row.level,
                        total_messages: row.total_messages,
                        rank: row.rank,
                        xp_current_level: xpCurrentLevel,
                        xp_next_level: xpNextLevel,
                        xp_progress: xpProgress,
                        xp_needed: xpNeeded,
                        progress_percent: progressPercent
                    });
                }
            );
        });
    }

    /**
     * Get top users for leaderboard with time range support
     * @param {string} guildId - Discord guild ID
     * @param {number} limit - Number of users to return
     * @param {string} timeRange - 'overall', 'daily', 'weekly', or 'monthly'
     * @returns {Promise<Array>}
     */
    async getLeaderboard(guildId, limit = 10, timeRange = 'overall') {
        return new Promise((resolve, reject) => {
            // Determine which XP column to use and filter
            let xpColumn, filterCondition;
            switch (timeRange) {
                case 'daily':
                    xpColumn = 'daily_xp';
                    filterCondition = 'daily_xp > 0';
                    break;
                case 'weekly':
                    xpColumn = 'weekly_xp';
                    filterCondition = 'weekly_xp > 0';
                    break;
                case 'monthly':
                    xpColumn = 'monthly_xp';
                    filterCondition = 'monthly_xp > 0';
                    break;
                default: // 'overall'
                    xpColumn = 'xp';
                    filterCondition = 'xp > 0';
            }

            this.db.all(
                `SELECT 
                    user_id,
                    xp,
                    level,
                    daily_xp,
                    weekly_xp,
                    monthly_xp,
                    total_messages
                 FROM user_xp 
                 WHERE guild_id = ? AND ${filterCondition}
                 ORDER BY ${xpColumn} DESC
                 LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate progress for each user based on the appropriate XP
                    const enrichedRows = rows.map((row, index) => {
                        // Get the XP value for the selected time range
                        let currentXP;
                        switch (timeRange) {
                            case 'daily':
                                currentXP = row.daily_xp;
                                break;
                            case 'weekly':
                                currentXP = row.weekly_xp;
                                break;
                            case 'monthly':
                                currentXP = row.monthly_xp;
                                break;
                            default:
                                currentXP = row.xp;
                        }

                        // Calculate level based on this XP
                        const level = this.calculateLevel(currentXP);
                        const xpCurrentLevel = this.calculateXPForLevel(level);
                        const xpNextLevel = this.calculateXPForLevel(level + 1);
                        const xpProgress = currentXP - xpCurrentLevel;
                        const xpNeeded = xpNextLevel - xpCurrentLevel;
                        const progressPercent = Math.floor((xpProgress / xpNeeded) * 100);

                        return {
                            user_id: row.user_id,
                            rank: index + 1,
                            xp: currentXP,
                            level: level,
                            total_messages: row.total_messages,
                            xp_current_level: xpCurrentLevel,
                            xp_next_level: xpNextLevel,
                            xp_progress: xpProgress,
                            xp_needed: xpNeeded,
                            progress_percent: progressPercent
                        };
                    });

                    resolve(enrichedRows);
                }
            );
        });
    }

    /**
     * Get full leaderboard (for web dashboard)
     * @param {string} guildId - Discord guild ID
     * @returns {Promise<Array>}
     */
    async getFullLeaderboard(guildId) {
        return this.getLeaderboard(guildId, 1000); // Get top 1000
    }

    /**
     * Get guild XP settings
     * @param {string} guildId - Discord guild ID
     * @returns {Promise<Object>}
     */
    async getGuildSettings(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM guild_xp_settings WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        // Return defaults
                        resolve({
                            guild_id: guildId,
                            xp_enabled: 1,
                            xp_per_message_min: 15,
                            xp_per_message_max: 25,
                            cooldown_seconds: 60,
                            level_up_channel_id: null,
                            level_up_message: 'GG {user}, you just advanced to **Level {level}**!'
                        });
                        return;
                    }

                    resolve(row);
                }
            );
        });
    }

    /**
     * Update guild XP settings
     * @param {string} guildId - Discord guild ID
     * @param {Object} settings - Settings to update
     */
    async updateGuildSettings(guildId, settings) {
        return new Promise((resolve, reject) => {
            const updates = [];
            const values = [];

            Object.keys(settings).forEach(key => {
                if (key !== 'guild_id') {
                    updates.push(`${key} = ?`);
                    values.push(settings[key]);
                }
            });

            values.push(Math.floor(Date.now() / 1000));
            values.push(guildId);

            this.db.run(
                `INSERT INTO guild_xp_settings (guild_id, ${Object.keys(settings).join(', ')}, updated_at)
                 VALUES (?, ${Object.keys(settings).map(() => '?').join(', ')}, ?)
                 ON CONFLICT(guild_id)
                 DO UPDATE SET ${updates.join(', ')}, updated_at = ?`,
                [guildId, ...Object.values(settings), Math.floor(Date.now() / 1000), ...values],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('✅ Database connection closed');
                }
            });
        }
    }
}

module.exports = XPDatabase;
