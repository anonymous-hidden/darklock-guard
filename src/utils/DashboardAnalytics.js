/**
 * Dashboard Usage Analytics
 * 
 * Tracks user behavior in the dashboard to improve UX:
 * - Page visits
 * - Settings changes
 * - Feature toggle usage
 * - Most popular features
 */

const Database = require('../src/database/database');

class DashboardAnalytics {
    constructor(database) {
        this.db = database;
        this.initializeTable();
    }

    async initializeTable() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS dashboard_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    guild_id TEXT,
                    event_type TEXT NOT NULL,
                    page TEXT,
                    feature TEXT,
                    action TEXT,
                    metadata TEXT,
                    ip_address TEXT,
                    user_agent TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id),
                    INDEX idx_guild_id (guild_id),
                    INDEX idx_event_type (event_type),
                    INDEX idx_timestamp (timestamp)
                )
            `);
            console.log('✅ Dashboard analytics table initialized');
        } catch (error) {
            console.error('Failed to initialize analytics table:', error);
        }
    }

    /**
     * Track a page visit
     */
    async trackPageView(userId, page, metadata = {}) {
        try {
            await this.db.run(`
                INSERT INTO dashboard_usage (user_id, event_type, page, metadata)
                VALUES (?, ?, ?, ?)
            `, [userId, 'page_view', page, JSON.stringify(metadata)]);
        } catch (error) {
            console.error('Analytics tracking error:', error);
        }
    }

    /**
     * Track a settings change
     */
    async trackSettingsChange(userId, guildId, feature, action, oldValue, newValue) {
        try {
            await this.db.run(`
                INSERT INTO dashboard_usage (user_id, guild_id, event_type, feature, action, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                userId,
                guildId,
                'settings_change',
                feature,
                action,
                JSON.stringify({ oldValue, newValue })
            ]);
        } catch (error) {
            console.error('Analytics tracking error:', error);
        }
    }

    /**
     * Track a feature toggle
     */
    async trackFeatureToggle(userId, guildId, feature, enabled) {
        try {
            await this.db.run(`
                INSERT INTO dashboard_usage (user_id, guild_id, event_type, feature, action, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                userId,
                guildId,
                'feature_toggle',
                feature,
                enabled ? 'enabled' : 'disabled',
                JSON.stringify({ enabled })
            ]);
        } catch (error) {
            console.error('Analytics tracking error:', error);
        }
    }

    /**
     * Get most visited pages
     */
    async getMostVisitedPages(days = 30) {
        try {
            const result = await this.db.all(`
                SELECT 
                    page,
                    COUNT(*) as visit_count,
                    COUNT(DISTINCT user_id) as unique_visitors
                FROM dashboard_usage
                WHERE event_type = 'page_view'
                AND timestamp >= datetime('now', '-${days} days')
                GROUP BY page
                ORDER BY visit_count DESC
                LIMIT 10
            `);
            return result;
        } catch (error) {
            console.error('Failed to get page stats:', error);
            return [];
        }
    }

    /**
     * Get most popular features
     */
    async getMostPopularFeatures(days = 30) {
        try {
            const result = await this.db.all(`
                SELECT 
                    feature,
                    COUNT(*) as toggle_count,
                    SUM(CASE WHEN action = 'enabled' THEN 1 ELSE 0 END) as enabled_count,
                    SUM(CASE WHEN action = 'disabled' THEN 1 ELSE 0 END) as disabled_count
                FROM dashboard_usage
                WHERE event_type = 'feature_toggle'
                AND timestamp >= datetime('now', '-${days} days')
                GROUP BY feature
                ORDER BY toggle_count DESC
            `);
            return result;
        } catch (error) {
            console.error('Failed to get feature stats:', error);
            return [];
        }
    }

    /**
     * Get user activity summary
     */
    async getUserActivity(userId, days = 30) {
        try {
            const result = await this.db.all(`
                SELECT 
                    event_type,
                    COUNT(*) as count
                FROM dashboard_usage
                WHERE user_id = ?
                AND timestamp >= datetime('now', '-${days} days')
                GROUP BY event_type
            `, [userId]);
            return result;
        } catch (error) {
            console.error('Failed to get user activity:', error);
            return [];
        }
    }

    /**
     * Get guild activity summary
     */
    async getGuildActivity(guildId, days = 30) {
        try {
            const result = await this.db.all(`
                SELECT 
                    feature,
                    action,
                    COUNT(*) as count,
                    MAX(timestamp) as last_changed
                FROM dashboard_usage
                WHERE guild_id = ?
                AND event_type IN ('settings_change', 'feature_toggle')
                AND timestamp >= datetime('now', '-${days} days')
                GROUP BY feature, action
                ORDER BY count DESC
            `, [guildId]);
            return result;
        } catch (error) {
            console.error('Failed to get guild activity:', error);
            return [];
        }
    }

    /**
     * Get daily active users
     */
    async getDailyActiveUsers(days = 30) {
        try {
            const result = await this.db.all(`
                SELECT 
                    DATE(timestamp) as date,
                    COUNT(DISTINCT user_id) as active_users
                FROM dashboard_usage
                WHERE timestamp >= datetime('now', '-${days} days')
                GROUP BY DATE(timestamp)
                ORDER BY date DESC
            `);
            return result;
        } catch (error) {
            console.error('Failed to get DAU:', error);
            return [];
        }
    }

    /**
     * Get comprehensive analytics report
     */
    async getAnalyticsReport(days = 30) {
        try {
            const [popularPages, popularFeatures, dailyUsers] = await Promise.all([
                this.getMostVisitedPages(days),
                this.getMostPopularFeatures(days),
                this.getDailyActiveUsers(days)
            ]);

            const totalEvents = await this.db.get(`
                SELECT COUNT(*) as total
                FROM dashboard_usage
                WHERE timestamp >= datetime('now', '-${days} days')
            `);

            const uniqueUsers = await this.db.get(`
                SELECT COUNT(DISTINCT user_id) as total
                FROM dashboard_usage
                WHERE timestamp >= datetime('now', '-${days} days')
            `);

            return {
                period: `Last ${days} days`,
                totalEvents: totalEvents.total,
                uniqueUsers: uniqueUsers.total,
                popularPages,
                popularFeatures,
                dailyActiveUsers: dailyUsers
            };
        } catch (error) {
            console.error('Failed to generate analytics report:', error);
            return null;
        }
    }

    /**
     * Cleanup old analytics data (keep last 90 days)
     */
    async cleanup(retentionDays = 90) {
        try {
            const result = await this.db.run(`
                DELETE FROM dashboard_usage
                WHERE timestamp < datetime('now', '-${retentionDays} days')
            `);
            console.log(`✅ Cleaned up ${result.changes} old analytics records`);
            return result.changes;
        } catch (error) {
            console.error('Failed to cleanup analytics:', error);
            return 0;
        }
    }
}

module.exports = DashboardAnalytics;
