/**
 * Rank System Manager
 * Handles XP tracking, leveling, and leaderboard
 */

const fs = require('fs');
const path = require('path');

class RankSystem {
    constructor(bot) {
        this.bot = bot;
        this.dataPath = path.join(__dirname, '../../data/ranks.json');
        this.data = this.loadData();
        
        // XP Configuration
        this.config = {
            xpPerMessage: 15,           // Base XP per message
            xpRandomBonus: 10,          // Random bonus (0-10)
            cooldown: 60000,            // 1 minute cooldown between XP gains
            xpMultiplier: 1.0,          // Global XP multiplier
            levelUpReward: 100,         // Bonus XP on level up
            
            // Role rewards for level milestones
            roleRewards: {
                5: null,   // Bronze Member - Set role ID in config.json
                10: null,  // Silver Member
                20: null,  // Gold Member
                30: null,  // Platinum Member
                50: null   // Elite Security Agent
            },
            
            // Streak bonus multipliers
            streakBonuses: {
                1: 0,      // No bonus
                2: 0.05,   // +5%
                7: 0.15,   // +15%
                30: 0.30   // +30%
            }
        };

        // Store last message timestamps for cooldown and duplicate detection
        this.cooldowns = new Map();
        this.lastMessages = new Map(); // For duplicate detection
        
        // XP boost system
        this.activeBoost = null; // { multiplier, endTime, reason }
        
        // Weekly/Monthly reset tracking
        this.lastWeeklyReset = this.getWeekStart();
        this.lastMonthlyReset = this.getMonthStart();
    }

    /**
     * Load rank data from JSON file
     */
    loadData() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const raw = fs.readFileSync(this.dataPath, 'utf8');
                const data = JSON.parse(raw);
                console.log('[RankSystem] Data loaded successfully');
                return data;
            } else {
                console.log('[RankSystem] No existing data file, starting fresh');
            }
        } catch (error) {
            console.error('[RankSystem] Error loading rank data:', error);
        }
        return {
            users: {},      // userId: { xp, level, totalMessages }
            guilds: {}      // guildId: { users: {} }
        };
    }

    /**
     * Save rank data to JSON file
     */
    saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
            console.log('[RankSystem] Data saved successfully');
        } catch (error) {
            console.error('[RankSystem] Error saving rank data:', error);
        }
    }

    /**
     * Calculate level from XP using exponential formula
     */
    calculateLevel(xp) {
        // Formula: level = floor(0.1 * sqrt(xp))
        return Math.floor(0.1 * Math.sqrt(xp));
    }

    /**
     * Calculate XP required for a specific level
     */
    calculateXPForLevel(level) {
        // Inverse formula: xp = (level / 0.1)^2
        return Math.pow(level / 0.1, 2);
    }

    /**
     * Calculate XP required for next level
     */
    calculateXPForNextLevel(currentLevel) {
        return this.calculateXPForLevel(currentLevel + 1);
    }

    /**
     * Get user data for a specific guild
     */
    getUserData(guildId, userId) {
        if (!this.data.guilds[guildId]) {
            this.data.guilds[guildId] = { users: {} };
        }
        
        if (!this.data.guilds[guildId].users[userId]) {
            this.data.guilds[guildId].users[userId] = {
                xp: 0,
                level: 0,
                totalMessages: 0,
                lastMessageTime: 0,
                weeklyXP: 0,
                monthlyXP: 0,
                lastDaily: 0,
                streak: 0,
                messagesToday: 0,
                lastMessageDate: null
            };
        }
        
        return this.data.guilds[guildId].users[userId];
    }

    /**
     * Add XP to a user
     */
    async addXP(guildId, userId, messageContent = null) {
        const userData = this.getUserData(guildId, userId);
        const now = Date.now();
        const today = new Date().toDateString();

        // Check for duplicate messages
        if (messageContent) {
            const lastMsgKey = `${guildId}-${userId}`;
            const lastMsg = this.lastMessages.get(lastMsgKey);
            if (lastMsg === messageContent) {
                console.log('[RankSystem] Duplicate message detected, no XP');
                return null;
            }
            this.lastMessages.set(lastMsgKey, messageContent);
        }

        // Check cooldown
        const cooldownKey = `${guildId}-${userId}`;
        const lastTime = this.cooldowns.get(cooldownKey) || 0;
        
        if (now - lastTime < this.config.cooldown) {
            return null; // Still on cooldown
        }

        // Update daily streak
        this.updateStreak(userData, now);
        
        // Update messages today counter
        if (userData.lastMessageDate !== today) {
            userData.messagesToday = 0;
            userData.lastMessageDate = today;
        }
        userData.messagesToday += 1;

        // Calculate XP with streak bonus and active boost
        const baseXP = this.config.xpPerMessage;
        const randomBonus = Math.floor(Math.random() * this.config.xpRandomBonus);
        let multiplier = this.config.xpMultiplier;
        
        // Apply streak bonus
        const streakBonus = this.getStreakBonus(userData.streak);
        multiplier *= (1 + streakBonus);
        
        // Apply active boost (legacy system)
        if (this.activeBoost && now < this.activeBoost.endTime) {
            multiplier *= this.activeBoost.multiplier;
        }

        // Check for database-driven XP events
        try {
            if (this.bot?.database?.getActiveXPEvents) {
                const activeEvents = await this.bot.database.getActiveXPEvents(guildId);
                if (activeEvents && activeEvents.length > 0) {
                    // Apply the highest multiplier from active events
                    const highestMultiplier = Math.max(...activeEvents.map(e => e.multiplier || 1));
                    multiplier *= highestMultiplier;
                    console.log(`[RankSystem] Applying XP event multiplier: ${highestMultiplier}x (Event: ${activeEvents[0].event_name})`);
                }
            }
        } catch (eventErr) {
            console.error('[RankSystem] Failed to check XP events:', eventErr);
        }
        
        const xpToAdd = Math.floor((baseXP + randomBonus) * multiplier);

        // Store old level
        const oldLevel = userData.level;

        // Add XP
        userData.xp += xpToAdd;
        userData.weeklyXP += xpToAdd;
        userData.monthlyXP += xpToAdd;
        userData.totalMessages += 1;
        userData.lastMessageTime = now;

        // Calculate new level
        const newLevel = this.calculateLevel(userData.xp);
        userData.level = newLevel;

        // Update cooldown
        this.cooldowns.set(cooldownKey, now);

        // Save data
        this.saveData();

        // Check if leveled up
        const leveledUp = newLevel > oldLevel;
        let roleReward = null;
        
        // Check for role rewards
        if (leveledUp && this.config.roleRewards[newLevel]) {
            roleReward = this.config.roleRewards[newLevel];
        }
        
        console.log(`[RankSystem] User ${userId} gained ${xpToAdd} XP (Total: ${userData.xp}, Level: ${newLevel}, Streak: ${userData.streak})`);
        
        return {
            xpGained: xpToAdd,
            currentXP: userData.xp,
            currentLevel: newLevel,
            leveledUp,
            oldLevel,
            newLevel,
            roleReward,
            streak: userData.streak
        };
    }

    /**
     * Update user's daily streak
     */
    updateStreak(userData, now) {
        const oneDayMs = 24 * 60 * 60 * 1000;
        const timeSinceLastDaily = now - (userData.lastDaily || 0);
        
        if (timeSinceLastDaily >= oneDayMs && timeSinceLastDaily < oneDayMs * 2) {
            // Continued streak
            userData.streak += 1;
        } else if (timeSinceLastDaily >= oneDayMs * 2) {
            // Streak broken
            userData.streak = 1;
        }
        // If less than 1 day, don't update (same day)
        
        if (timeSinceLastDaily >= oneDayMs) {
            userData.lastDaily = now;
        }
    }

    /**
     * Get streak bonus multiplier
     */
    getStreakBonus(streak) {
        if (streak >= 30) return this.config.streakBonuses[30];
        if (streak >= 7) return this.config.streakBonuses[7];
        if (streak >= 2) return this.config.streakBonuses[2];
        return this.config.streakBonuses[1];
    }

    /**
     * Get leaderboard for a guild
     */
    getLeaderboard(guildId, limit = 10, type = 'alltime') {
        if (!this.data.guilds[guildId]) {
            return [];
        }

        // Check if we need to reset weekly/monthly
        this.checkAndResetPeriods(guildId);

        const users = this.data.guilds[guildId].users;
        let sortKey = 'xp';
        
        if (type === 'weekly') sortKey = 'weeklyXP';
        if (type === 'monthly') sortKey = 'monthlyXP';
        
        const leaderboard = Object.entries(users)
            .map(([userId, data]) => ({
                userId,
                xp: data.xp,
                weeklyXP: data.weeklyXP || 0,
                monthlyXP: data.monthlyXP || 0,
                level: data.level,
                totalMessages: data.totalMessages
            }))
            .sort((a, b) => b[sortKey] - a[sortKey])
            .slice(0, limit);

        return leaderboard;
    }

    /**
     * Check and reset weekly/monthly XP if needed
     */
    checkAndResetPeriods(guildId) {
        const now = Date.now();
        const currentWeekStart = this.getWeekStart();
        const currentMonthStart = this.getMonthStart();
        
        // Reset weekly XP if new week
        if (currentWeekStart > this.lastWeeklyReset) {
            console.log('[RankSystem] Resetting weekly XP');
            this.resetWeeklyXP(guildId);
            this.lastWeeklyReset = currentWeekStart;
        }
        
        // Reset monthly XP if new month
        if (currentMonthStart > this.lastMonthlyReset) {
            console.log('[RankSystem] Resetting monthly XP');
            this.resetMonthlyXP(guildId);
            this.lastMonthlyReset = currentMonthStart;
        }
    }

    /**
     * Get start of current week (Monday 00:00)
     */
    getWeekStart() {
        const now = new Date();
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const monday = new Date(now.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return monday.getTime();
    }

    /**
     * Get start of current month
     */
    getMonthStart() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }

    /**
     * Reset weekly XP for all users in guild
     */
    resetWeeklyXP(guildId) {
        if (!this.data.guilds[guildId]) return;
        
        const users = this.data.guilds[guildId].users;
        Object.values(users).forEach(userData => {
            userData.weeklyXP = 0;
        });
        this.saveData();
    }

    /**
     * Reset monthly XP for all users in guild
     */
    resetMonthlyXP(guildId) {
        if (!this.data.guilds[guildId]) return;
        
        const users = this.data.guilds[guildId].users;
        Object.values(users).forEach(userData => {
            userData.monthlyXP = 0;
        });
        this.saveData();
    }

    /**
     * Get user rank in guild
     */
    getUserRank(guildId, userId) {
        if (!this.data.guilds[guildId]) {
            return null;
        }

        const users = this.data.guilds[guildId].users;
        const sorted = Object.entries(users)
            .map(([id, data]) => ({ userId: id, xp: data.xp }))
            .sort((a, b) => b.xp - a.xp);

        const rank = sorted.findIndex(u => u.userId === userId) + 1;
        
        return rank > 0 ? rank : null;
    }

    /**
     * Get total users with XP in a guild
     */
    getTotalUsers(guildId) {
        if (!this.data.guilds[guildId]) {
            return 0;
        }
        return Object.keys(this.data.guilds[guildId].users).length;
    }

    /**
     * Reset user XP
     */
    resetUser(guildId, userId) {
        if (this.data.guilds[guildId] && this.data.guilds[guildId].users[userId]) {
            this.data.guilds[guildId].users[userId] = {
                xp: 0,
                level: 0,
                totalMessages: 0,
                lastMessageTime: 0
            };
            this.saveData();
            return true;
        }
        return false;
    }

    /**
     * Reset all guild XP
     */
    resetGuild(guildId) {
        if (this.data.guilds[guildId]) {
            this.data.guilds[guildId] = { users: {} };
            this.saveData();
            return true;
        }
        return false;
    }

    /**
     * Set user XP (admin function)
     */
    setUserXP(guildId, userId, xp) {
        const userData = this.getUserData(guildId, userId);
        userData.xp = xp;
        userData.level = this.calculateLevel(xp);
        this.saveData();
        return userData;
    }

    /**
     * Set user level (admin function)
     */
    setUserLevel(guildId, userId, level) {
        const userData = this.getUserData(guildId, userId);
        userData.level = level;
        userData.xp = this.calculateXPForLevel(level);
        this.saveData();
        return userData;
    }

    /**
     * Get detailed user stats
     */
    getUserStats(guildId, userId) {
        const userData = this.getUserData(guildId, userId);
        const rank = this.getUserRank(guildId, userId);
        const totalUsers = this.getTotalUsers(guildId);
        const currentLevelXP = this.calculateXPForLevel(userData.level);
        const nextLevelXP = this.calculateXPForNextLevel(userData.level);
        const xpProgress = userData.xp - currentLevelXP;
        const xpNeeded = nextLevelXP - currentLevelXP;
        const progressPercent = (xpProgress / xpNeeded) * 100;
        
        // Calculate top percentage
        const topPercent = totalUsers > 0 ? ((rank / totalUsers) * 100).toFixed(1) : 0;

        return {
            userId,
            xp: userData.xp,
            level: userData.level,
            totalMessages: userData.totalMessages,
            messagesToday: userData.messagesToday || 0,
            streak: userData.streak || 0,
            weeklyXP: userData.weeklyXP || 0,
            monthlyXP: userData.monthlyXP || 0,
            rank,
            totalUsers,
            topPercent,
            currentLevelXP,
            nextLevelXP,
            xpProgress,
            xpNeeded,
            progressPercent: Math.min(100, Math.max(0, progressPercent))
        };
    }

    /**
     * Start XP boost
     */
    startBoost(multiplier, durationMs, reason = 'XP Boost Active') {
        this.activeBoost = {
            multiplier,
            endTime: Date.now() + durationMs,
            reason
        };
        console.log(`[RankSystem] XP Boost started: ${multiplier}x for ${durationMs / 1000 / 60} minutes`);
        return this.activeBoost;
    }

    /**
     * Get active boost info
     */
    getActiveBoost() {
        if (this.activeBoost && Date.now() < this.activeBoost.endTime) {
            return {
                ...this.activeBoost,
                timeRemaining: this.activeBoost.endTime - Date.now()
            };
        }
        return null;
    }

    /**
     * Clear active boost
     */
    clearBoost() {
        this.activeBoost = null;
        console.log('[RankSystem] XP Boost cleared');
    }

    /**
     * Format XP number (e.g., 11543 -> "11.5K")
     */
    formatXP(xp) {
        if (xp >= 1000000) {
            return (xp / 1000000).toFixed(1) + 'M';
        } else if (xp >= 1000) {
            return (xp / 1000).toFixed(1) + 'K';
        }
        return xp.toString();
    }
}

module.exports = RankSystem;
