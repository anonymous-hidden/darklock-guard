/**
 * Analytics Routes
 * Handles dashboard analytics and statistics endpoints
 */

const express = require('express');
const router = express.Router();

module.exports = function(dashboard) {
    const { bot, db, authMiddleware, requireGuildAccess } = dashboard;
    const t = bot.i18n?.t?.bind(bot.i18n) || ((key) => key);

    /**
     * GET /api/guilds/:guildId/analytics
     * Get comprehensive guild analytics
     */
    router.get('/guilds/:guildId/analytics', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d' } = req.query;

            const startDate = calculateStartDate(period);
            const guild = bot.guilds.cache.get(guildId);

            // Member statistics
            const memberStats = {
                total: guild?.memberCount || 0,
                online: guild?.members.cache.filter(m => m.presence?.status !== 'offline').size || 0,
                bots: guild?.members.cache.filter(m => m.user.bot).size || 0,
                humans: guild?.memberCount - (guild?.members.cache.filter(m => m.user.bot).size || 0) || 0
            };

            // Message activity from database
            const messageStats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT user_id) as active_users,
                    COUNT(DISTINCT channel_id) as active_channels
                FROM message_logs 
                WHERE guild_id = ? AND timestamp >= ?
            `, [guildId, startDate.toISOString()]);

            // Moderation stats
            const modStats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total_actions,
                    SUM(CASE WHEN action_type = 'warn' THEN 1 ELSE 0 END) as warns,
                    SUM(CASE WHEN action_type = 'mute' THEN 1 ELSE 0 END) as mutes,
                    SUM(CASE WHEN action_type = 'kick' THEN 1 ELSE 0 END) as kicks,
                    SUM(CASE WHEN action_type = 'ban' THEN 1 ELSE 0 END) as bans
                FROM mod_logs 
                WHERE guild_id = ? AND timestamp >= ?
            `, [guildId, startDate.toISOString()]);

            // Security events
            const securityStats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total_events,
                    SUM(CASE WHEN event_type = 'raid' THEN 1 ELSE 0 END) as raids,
                    SUM(CASE WHEN event_type = 'spam' THEN 1 ELSE 0 END) as spam,
                    SUM(CASE WHEN event_type = 'link' THEN 1 ELSE 0 END) as malicious_links
                FROM security_logs 
                WHERE guild_id = ? AND timestamp >= ?
            `, [guildId, startDate.toISOString()]);

            // Verification stats
            const verificationStats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM verification_logs 
                WHERE guild_id = ? AND timestamp >= ?
            `, [guildId, startDate.toISOString()]);

            res.json({
                period,
                memberStats,
                messageStats: messageStats || { total_messages: 0, active_users: 0, active_channels: 0 },
                modStats: modStats || { total_actions: 0, warns: 0, mutes: 0, kicks: 0, bans: 0 },
                securityStats: securityStats || { total_events: 0, raids: 0, spam: 0, malicious_links: 0 },
                verificationStats: verificationStats || { total: 0, verified: 0, pending: 0, rejected: 0 }
            });
        } catch (error) {
            bot.logger?.error('Error fetching analytics:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/analytics/activity
     * Get activity over time (for charts)
     */
    router.get('/guilds/:guildId/analytics/activity', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d', interval = 'day' } = req.query;

            const startDate = calculateStartDate(period);
            
            // Determine date grouping format based on interval
            let dateFormat;
            switch (interval) {
                case 'hour':
                    dateFormat = '%Y-%m-%d %H:00';
                    break;
                case 'day':
                    dateFormat = '%Y-%m-%d';
                    break;
                case 'week':
                    dateFormat = '%Y-W%W';
                    break;
                case 'month':
                    dateFormat = '%Y-%m';
                    break;
                default:
                    dateFormat = '%Y-%m-%d';
            }

            // Message activity over time
            const messageActivity = await db.allAsync(`
                SELECT 
                    strftime('${dateFormat}', timestamp) as period,
                    COUNT(*) as count
                FROM message_logs 
                WHERE guild_id = ? AND timestamp >= ?
                GROUP BY strftime('${dateFormat}', timestamp)
                ORDER BY period ASC
            `, [guildId, startDate.toISOString()]);

            // Member joins over time
            const joinActivity = await db.allAsync(`
                SELECT 
                    strftime('${dateFormat}', joined_at) as period,
                    COUNT(*) as count
                FROM member_logs 
                WHERE guild_id = ? AND joined_at >= ? AND event_type = 'join'
                GROUP BY strftime('${dateFormat}', joined_at)
                ORDER BY period ASC
            `, [guildId, startDate.toISOString()]);

            // Moderation actions over time
            const modActivity = await db.allAsync(`
                SELECT 
                    strftime('${dateFormat}', timestamp) as period,
                    action_type,
                    COUNT(*) as count
                FROM mod_logs 
                WHERE guild_id = ? AND timestamp >= ?
                GROUP BY strftime('${dateFormat}', timestamp), action_type
                ORDER BY period ASC
            `, [guildId, startDate.toISOString()]);

            res.json({
                period,
                interval,
                messageActivity: messageActivity || [],
                joinActivity: joinActivity || [],
                modActivity: modActivity || []
            });
        } catch (error) {
            bot.logger?.error('Error fetching activity data:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/analytics/leaderboard
     * Get top active members
     */
    router.get('/guilds/:guildId/analytics/leaderboard', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { type = 'messages', limit = 10, period = '30d' } = req.query;

            const startDate = calculateStartDate(period);
            let leaderboard;

            switch (type) {
                case 'messages':
                    leaderboard = await db.allAsync(`
                        SELECT user_id, COUNT(*) as count
                        FROM message_logs
                        WHERE guild_id = ? AND timestamp >= ?
                        GROUP BY user_id
                        ORDER BY count DESC
                        LIMIT ?
                    `, [guildId, startDate.toISOString(), parseInt(limit)]);
                    break;

                case 'xp':
                    leaderboard = await db.allAsync(`
                        SELECT user_id, xp as count, level
                        FROM user_levels
                        WHERE guild_id = ?
                        ORDER BY xp DESC
                        LIMIT ?
                    `, [guildId, parseInt(limit)]);
                    break;

                case 'reputation':
                    leaderboard = await db.allAsync(`
                        SELECT user_id, reputation as count
                        FROM user_reputation
                        WHERE guild_id = ?
                        ORDER BY reputation DESC
                        LIMIT ?
                    `, [guildId, parseInt(limit)]);
                    break;

                default:
                    return res.status(400).json({ error: 'Invalid leaderboard type' });
            }

            // Enrich with user data from Discord
            const guild = bot.guilds.cache.get(guildId);
            const enriched = await Promise.all(
                (leaderboard || []).map(async (entry, index) => {
                    let member;
                    try {
                        member = await guild?.members.fetch(entry.user_id);
                    } catch {}
                    
                    return {
                        rank: index + 1,
                        userId: entry.user_id,
                        username: member?.user.username || 'Unknown User',
                        displayName: member?.displayName || 'Unknown',
                        avatar: member?.user.displayAvatarURL({ size: 64 }) || null,
                        count: entry.count,
                        level: entry.level || null
                    };
                })
            );

            res.json({
                type,
                period,
                leaderboard: enriched
            });
        } catch (error) {
            bot.logger?.error('Error fetching leaderboard:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/analytics/channels
     * Get channel activity statistics
     */
    router.get('/guilds/:guildId/analytics/channels', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d', limit = 20 } = req.query;

            const startDate = calculateStartDate(period);

            const channelActivity = await db.allAsync(`
                SELECT channel_id, COUNT(*) as message_count
                FROM message_logs
                WHERE guild_id = ? AND timestamp >= ?
                GROUP BY channel_id
                ORDER BY message_count DESC
                LIMIT ?
            `, [guildId, startDate.toISOString(), parseInt(limit)]);

            // Enrich with channel data
            const guild = bot.guilds.cache.get(guildId);
            const enriched = (channelActivity || []).map(entry => {
                const channel = guild?.channels.cache.get(entry.channel_id);
                return {
                    channelId: entry.channel_id,
                    name: channel?.name || 'Deleted Channel',
                    type: channel?.type || 'unknown',
                    messageCount: entry.message_count
                };
            });

            res.json({
                period,
                channels: enriched
            });
        } catch (error) {
            bot.logger?.error('Error fetching channel analytics:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/analytics/growth
     * Get member growth statistics
     */
    router.get('/guilds/:guildId/analytics/growth', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d' } = req.query;

            const startDate = calculateStartDate(period);

            // Daily join/leave stats
            const growthData = await db.allAsync(`
                SELECT 
                    date(joined_at) as date,
                    SUM(CASE WHEN event_type = 'join' THEN 1 ELSE 0 END) as joins,
                    SUM(CASE WHEN event_type = 'leave' THEN 1 ELSE 0 END) as leaves
                FROM member_logs
                WHERE guild_id = ? AND joined_at >= ?
                GROUP BY date(joined_at)
                ORDER BY date ASC
            `, [guildId, startDate.toISOString()]);

            // Calculate totals
            const totals = (growthData || []).reduce((acc, day) => {
                acc.totalJoins += day.joins || 0;
                acc.totalLeaves += day.leaves || 0;
                return acc;
            }, { totalJoins: 0, totalLeaves: 0 });

            res.json({
                period,
                daily: growthData || [],
                totals: {
                    ...totals,
                    netGrowth: totals.totalJoins - totals.totalLeaves
                }
            });
        } catch (error) {
            bot.logger?.error('Error fetching growth data:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/analytics/retention
     * Get member retention statistics
     */
    router.get('/guilds/:guildId/analytics/retention', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;

            // Members who joined and stayed (still in server)
            const retentionData = await db.allAsync(`
                SELECT 
                    strftime('%Y-%m', joined_at) as month,
                    COUNT(*) as joined,
                    SUM(CASE WHEN still_member = 1 THEN 1 ELSE 0 END) as retained
                FROM (
                    SELECT 
                        ml.user_id,
                        ml.joined_at,
                        CASE WHEN ml2.event_type IS NULL THEN 1 ELSE 0 END as still_member
                    FROM member_logs ml
                    LEFT JOIN member_logs ml2 ON ml.user_id = ml2.user_id 
                        AND ml.guild_id = ml2.guild_id 
                        AND ml2.event_type = 'leave'
                        AND ml2.joined_at > ml.joined_at
                    WHERE ml.guild_id = ? AND ml.event_type = 'join'
                )
                GROUP BY strftime('%Y-%m', joined_at)
                ORDER BY month DESC
                LIMIT 12
            `, [guildId]);

            res.json({
                retention: (retentionData || []).map(row => ({
                    month: row.month,
                    joined: row.joined,
                    retained: row.retained,
                    rate: row.joined > 0 ? ((row.retained / row.joined) * 100).toFixed(1) : 0
                }))
            });
        } catch (error) {
            bot.logger?.error('Error fetching retention data:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/admin/analytics/global
     * Get global bot statistics (admin only)
     */
    router.get('/admin/analytics/global', authMiddleware, async (req, res) => {
        try {
            // Verify admin access
            const isAdmin = await dashboard.isAdmin(req.user.userId);
            if (!isAdmin) {
                return res.status(403).json({ error: t('dashboard.errors.adminOnly') });
            }

            res.json({
                guilds: bot.guilds.cache.size,
                users: bot.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0),
                channels: bot.channels.cache.size,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                shards: bot.shard?.count || 1
            });
        } catch (error) {
            bot.logger?.error('Error fetching global analytics:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * Helper function to calculate start date from period string
     */
    function calculateStartDate(period) {
        const now = new Date();
        const startDate = new Date();

        switch (period) {
            case '24h':
                startDate.setHours(now.getHours() - 24);
                break;
            case '7d':
                startDate.setDate(now.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(now.getDate() - 30);
                break;
            case '90d':
                startDate.setDate(now.getDate() - 90);
                break;
            case '1y':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            default:
                startDate.setDate(now.getDate() - 30);
        }

        return startDate;
    }

    return router;
};
