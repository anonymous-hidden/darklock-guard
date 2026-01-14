/**
 * Analytics Service
 * Business logic for analytics and statistics
 */

class AnalyticsService {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get cached data or fetch fresh
     */
    async getCached(key, fetchFn) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        const data = await fetchFn();
        this.cache.set(key, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Get guild overview statistics
     */
    async getGuildOverview(guildId) {
        return this.getCached(`overview:${guildId}`, async () => {
            const guild = this.bot.guilds.cache.get(guildId);
            if (!guild) return null;

            const [messageStats, modStats, securityEvents] = await Promise.all([
                this.getMessageStats(guildId, '24h'),
                this.getModerationStats(guildId, '24h'),
                this.getSecurityEvents(guildId, '24h')
            ]);

            return {
                memberCount: guild.memberCount,
                onlineCount: guild.members.cache.filter(m => m.presence?.status !== 'offline').size,
                channelCount: guild.channels.cache.size,
                roleCount: guild.roles.cache.size,
                boostLevel: guild.premiumTier,
                boostCount: guild.premiumSubscriptionCount,
                messageStats,
                modStats,
                securityEvents: securityEvents.length
            };
        });
    }

    /**
     * Get message statistics
     */
    async getMessageStats(guildId, period) {
        const startDate = this.calculateStartDate(period);

        const result = await this.db.getAsync(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT channel_id) as active_channels
            FROM message_logs
            WHERE guild_id = ? AND timestamp >= ?
        `, [guildId, startDate.toISOString()]);

        return result || { total: 0, unique_users: 0, active_channels: 0 };
    }

    /**
     * Get moderation statistics
     */
    async getModerationStats(guildId, period) {
        const startDate = this.calculateStartDate(period);

        const result = await this.db.getAsync(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN action_type = 'warn' THEN 1 ELSE 0 END) as warns,
                SUM(CASE WHEN action_type = 'mute' THEN 1 ELSE 0 END) as mutes,
                SUM(CASE WHEN action_type = 'kick' THEN 1 ELSE 0 END) as kicks,
                SUM(CASE WHEN action_type = 'ban' THEN 1 ELSE 0 END) as bans,
                SUM(CASE WHEN action_type = 'timeout' THEN 1 ELSE 0 END) as timeouts
            FROM mod_logs
            WHERE guild_id = ? AND timestamp >= ?
        `, [guildId, startDate.toISOString()]);

        return result || { total: 0, warns: 0, mutes: 0, kicks: 0, bans: 0, timeouts: 0 };
    }

    /**
     * Get security events
     */
    async getSecurityEvents(guildId, period) {
        const startDate = this.calculateStartDate(period);

        const events = await this.db.allAsync(`
            SELECT * FROM security_logs
            WHERE guild_id = ? AND timestamp >= ?
            ORDER BY timestamp DESC
            LIMIT 100
        `, [guildId, startDate.toISOString()]);

        return events || [];
    }

    /**
     * Get top users by activity
     */
    async getTopUsers(guildId, metric, limit = 10, period = '30d') {
        const startDate = this.calculateStartDate(period);
        let query;

        switch (metric) {
            case 'messages':
                query = `
                    SELECT user_id, COUNT(*) as value
                    FROM message_logs
                    WHERE guild_id = ? AND timestamp >= ?
                    GROUP BY user_id
                    ORDER BY value DESC
                    LIMIT ?
                `;
                break;
            case 'xp':
                query = `
                    SELECT user_id, xp as value, level
                    FROM user_levels
                    WHERE guild_id = ?
                    ORDER BY xp DESC
                    LIMIT ?
                `;
                return this.db.allAsync(query, [guildId, limit]);
            case 'reputation':
                query = `
                    SELECT user_id, reputation as value
                    FROM user_reputation
                    WHERE guild_id = ?
                    ORDER BY reputation DESC
                    LIMIT ?
                `;
                return this.db.allAsync(query, [guildId, limit]);
            default:
                throw new Error('Invalid metric');
        }

        return this.db.allAsync(query, [guildId, startDate.toISOString(), limit]);
    }

    /**
     * Get activity timeline
     */
    async getActivityTimeline(guildId, period = '30d', interval = 'day') {
        const startDate = this.calculateStartDate(period);
        const dateFormat = this.getDateFormat(interval);

        const messageActivity = await this.db.allAsync(`
            SELECT 
                strftime('${dateFormat}', timestamp) as period,
                COUNT(*) as messages,
                COUNT(DISTINCT user_id) as users
            FROM message_logs
            WHERE guild_id = ? AND timestamp >= ?
            GROUP BY strftime('${dateFormat}', timestamp)
            ORDER BY period ASC
        `, [guildId, startDate.toISOString()]);

        return messageActivity || [];
    }

    /**
     * Get member growth data
     */
    async getMemberGrowth(guildId, period = '30d') {
        const startDate = this.calculateStartDate(period);

        const growth = await this.db.allAsync(`
            SELECT 
                date(joined_at) as date,
                SUM(CASE WHEN event_type = 'join' THEN 1 ELSE 0 END) as joins,
                SUM(CASE WHEN event_type = 'leave' THEN 1 ELSE 0 END) as leaves
            FROM member_logs
            WHERE guild_id = ? AND joined_at >= ?
            GROUP BY date(joined_at)
            ORDER BY date ASC
        `, [guildId, startDate.toISOString()]);

        // Calculate cumulative growth
        let cumulative = 0;
        const withCumulative = (growth || []).map(day => {
            cumulative += (day.joins || 0) - (day.leaves || 0);
            return { ...day, cumulative };
        });

        return withCumulative;
    }

    /**
     * Get command usage statistics
     */
    async getCommandUsage(guildId, period = '30d', limit = 20) {
        const startDate = this.calculateStartDate(period);

        const usage = await this.db.allAsync(`
            SELECT 
                command_name,
                COUNT(*) as uses,
                COUNT(DISTINCT user_id) as unique_users
            FROM command_logs
            WHERE guild_id = ? AND timestamp >= ?
            GROUP BY command_name
            ORDER BY uses DESC
            LIMIT ?
        `, [guildId, startDate.toISOString(), limit]);

        return usage || [];
    }

    /**
     * Record analytics event
     */
    async recordEvent(guildId, eventType, data) {
        try {
            await this.db.runAsync(`
                INSERT INTO analytics_events (guild_id, event_type, data, timestamp)
                VALUES (?, ?, ?, ?)
            `, [guildId, eventType, JSON.stringify(data), new Date().toISOString()]);
        } catch (error) {
            this.bot.logger?.warn('Failed to record analytics event:', error.message);
        }
    }

    /**
     * Calculate start date from period string
     */
    calculateStartDate(period) {
        const now = new Date();
        const start = new Date();

        const match = period.match(/^(\d+)([hdwmy])$/);
        if (match) {
            const [, num, unit] = match;
            const value = parseInt(num);

            switch (unit) {
                case 'h':
                    start.setHours(now.getHours() - value);
                    break;
                case 'd':
                    start.setDate(now.getDate() - value);
                    break;
                case 'w':
                    start.setDate(now.getDate() - (value * 7));
                    break;
                case 'm':
                    start.setMonth(now.getMonth() - value);
                    break;
                case 'y':
                    start.setFullYear(now.getFullYear() - value);
                    break;
            }
        } else {
            // Default to 30 days
            start.setDate(now.getDate() - 30);
        }

        return start;
    }

    /**
     * Get SQLite date format string
     */
    getDateFormat(interval) {
        switch (interval) {
            case 'hour':
                return '%Y-%m-%d %H:00';
            case 'day':
                return '%Y-%m-%d';
            case 'week':
                return '%Y-W%W';
            case 'month':
                return '%Y-%m';
            default:
                return '%Y-%m-%d';
        }
    }

    /**
     * Clear analytics cache
     */
    clearCache(guildId = null) {
        if (guildId) {
            for (const key of this.cache.keys()) {
                if (key.includes(guildId)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }
}

module.exports = AnalyticsService;
