/**
 * Audit Log Service
 * Handles dashboard action logging for audit trail
 */

class AuditLogService {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
    }

    /**
     * Initialize audit log tables
     */
    async initialize() {
        await this.db.runAsync(`
            CREATE TABLE IF NOT EXISTS dashboard_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                timestamp TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.db.runAsync(`
            CREATE INDEX IF NOT EXISTS idx_audit_guild ON dashboard_audit_logs(guild_id)
        `);
        await this.db.runAsync(`
            CREATE INDEX IF NOT EXISTS idx_audit_user ON dashboard_audit_logs(user_id)
        `);
        await this.db.runAsync(`
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON dashboard_audit_logs(timestamp)
        `);
    }

    /**
     * Log an action
     */
    async logAction(options) {
        const {
            guildId = null,
            userId,
            action,
            targetType = null,
            targetId = null,
            details = null,
            ipAddress = null,
            userAgent = null
        } = options;

        try {
            await this.db.runAsync(`
                INSERT INTO dashboard_audit_logs 
                (guild_id, user_id, action, target_type, target_id, details, ip_address, user_agent, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                userId,
                action,
                targetType,
                targetId,
                typeof details === 'object' ? JSON.stringify(details) : details,
                ipAddress,
                userAgent,
                new Date().toISOString()
            ]);

            this.bot.logger?.debug(`Audit log: ${action} by ${userId}${guildId ? ` in ${guildId}` : ''}`);
        } catch (error) {
            this.bot.logger?.error('Failed to write audit log:', error);
        }
    }

    /**
     * Get audit logs for a guild
     */
    async getGuildLogs(guildId, options = {}) {
        const {
            page = 1,
            limit = 50,
            action = null,
            userId = null,
            startDate = null,
            endDate = null
        } = options;

        let query = 'SELECT * FROM dashboard_audit_logs WHERE guild_id = ?';
        const params = [guildId];

        if (action) {
            query += ' AND action = ?';
            params.push(action);
        }
        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        if (startDate) {
            query += ' AND timestamp >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND timestamp <= ?';
            params.push(endDate);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, (page - 1) * limit);

        const logs = await this.db.allAsync(query, params);

        // Parse details JSON
        return (logs || []).map(log => ({
            ...log,
            details: log.details ? this.safeParseJSON(log.details) : null
        }));
    }

    /**
     * Get audit logs for a user (global)
     */
    async getUserLogs(userId, options = {}) {
        const { page = 1, limit = 50 } = options;

        const logs = await this.db.allAsync(`
            SELECT * FROM dashboard_audit_logs 
            WHERE user_id = ?
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        `, [userId, limit, (page - 1) * limit]);

        return (logs || []).map(log => ({
            ...log,
            details: log.details ? this.safeParseJSON(log.details) : null
        }));
    }

    /**
     * Get recent security-related logs
     */
    async getSecurityLogs(guildId, limit = 100) {
        const securityActions = [
            'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
            'PERMISSION_CHANGE', 'ROLE_UPDATE',
            'SECURITY_SETTINGS_UPDATE', 'VERIFICATION_SETTINGS_UPDATE',
            'BAN', 'UNBAN', 'KICK', 'QUARANTINE'
        ];

        const logs = await this.db.allAsync(`
            SELECT * FROM dashboard_audit_logs 
            WHERE guild_id = ? AND action IN (${securityActions.map(() => '?').join(',')})
            ORDER BY timestamp DESC
            LIMIT ?
        `, [guildId, ...securityActions, limit]);

        return (logs || []).map(log => ({
            ...log,
            details: log.details ? this.safeParseJSON(log.details) : null
        }));
    }

    /**
     * Get action counts by type
     */
    async getActionCounts(guildId, period = '30d') {
        const startDate = this.calculateStartDate(period);

        const counts = await this.db.allAsync(`
            SELECT action, COUNT(*) as count
            FROM dashboard_audit_logs
            WHERE guild_id = ? AND timestamp >= ?
            GROUP BY action
            ORDER BY count DESC
        `, [guildId, startDate.toISOString()]);

        return counts || [];
    }

    /**
     * Get most active dashboard users
     */
    async getActiveUsers(guildId, period = '30d', limit = 10) {
        const startDate = this.calculateStartDate(period);

        const users = await this.db.allAsync(`
            SELECT user_id, COUNT(*) as action_count
            FROM dashboard_audit_logs
            WHERE guild_id = ? AND timestamp >= ?
            GROUP BY user_id
            ORDER BY action_count DESC
            LIMIT ?
        `, [guildId, startDate.toISOString(), limit]);

        return users || [];
    }

    /**
     * Clean old audit logs
     */
    async cleanOldLogs(daysToKeep = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const result = await this.db.runAsync(`
            DELETE FROM dashboard_audit_logs WHERE timestamp < ?
        `, [cutoffDate.toISOString()]);

        this.bot.logger?.info(`Cleaned ${result.changes || 0} old audit logs`);
        return result.changes || 0;
    }

    /**
     * Export audit logs for a guild
     */
    async exportLogs(guildId, startDate, endDate) {
        const logs = await this.db.allAsync(`
            SELECT * FROM dashboard_audit_logs
            WHERE guild_id = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `, [guildId, startDate, endDate]);

        return (logs || []).map(log => ({
            ...log,
            details: log.details ? this.safeParseJSON(log.details) : null
        }));
    }

    /**
     * Safe JSON parse
     */
    safeParseJSON(str) {
        try {
            return JSON.parse(str);
        } catch {
            return str;
        }
    }

    /**
     * Calculate start date from period
     */
    calculateStartDate(period) {
        const now = new Date();
        const match = period.match(/^(\d+)([dwmy])$/);
        
        if (match) {
            const [, num, unit] = match;
            const value = parseInt(num);

            switch (unit) {
                case 'd':
                    now.setDate(now.getDate() - value);
                    break;
                case 'w':
                    now.setDate(now.getDate() - (value * 7));
                    break;
                case 'm':
                    now.setMonth(now.getMonth() - value);
                    break;
                case 'y':
                    now.setFullYear(now.getFullYear() - value);
                    break;
            }
        } else {
            now.setDate(now.getDate() - 30);
        }

        return now;
    }
}

// Action types for consistency
AuditLogService.Actions = {
    // Authentication
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    SESSION_REVOKED: 'SESSION_REVOKED',
    
    // Guild Settings
    SETTINGS_UPDATE: 'SETTINGS_UPDATE',
    SECURITY_SETTINGS_UPDATE: 'SECURITY_SETTINGS_UPDATE',
    VERIFICATION_SETTINGS_UPDATE: 'VERIFICATION_SETTINGS_UPDATE',
    WELCOME_SETTINGS_UPDATE: 'WELCOME_SETTINGS_UPDATE',
    
    // Moderation
    WARN: 'WARN',
    MUTE: 'MUTE',
    UNMUTE: 'UNMUTE',
    KICK: 'KICK',
    BAN: 'BAN',
    UNBAN: 'UNBAN',
    TIMEOUT: 'TIMEOUT',
    QUARANTINE: 'QUARANTINE',
    
    // Tickets
    TICKET_CREATE: 'TICKET_CREATE',
    TICKET_CLOSE: 'TICKET_CLOSE',
    TICKET_REOPEN: 'TICKET_REOPEN',
    TICKET_DELETE: 'TICKET_DELETE',
    TICKET_SETTINGS_UPDATE: 'TICKET_SETTINGS_UPDATE',
    
    // Verification
    VERIFY_USER: 'VERIFY_USER',
    REJECT_USER: 'REJECT_USER',
    
    // Roles & Permissions
    ROLE_UPDATE: 'ROLE_UPDATE',
    PERMISSION_CHANGE: 'PERMISSION_CHANGE',
    
    // Other
    FEATURE_TOGGLE: 'FEATURE_TOGGLE',
    COMMAND_EXECUTED: 'COMMAND_EXECUTED'
};

module.exports = AuditLogService;
