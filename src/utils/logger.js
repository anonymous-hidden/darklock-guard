/**
 * Centralized Logging System for DarkLock
 * Captures all bot actions, dashboard changes, and security events
 */

class Logger {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        this.dashboard = null; // Set later by dashboard
    }

    /**
     * Initialize database tables for logging
     */
    async initialize() {
        try {
            // Create bot_logs table
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS bot_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    user_id TEXT,
                    user_tag TEXT,
                    guild_id TEXT,
                    channel_id TEXT,
                    command TEXT,
                    endpoint TEXT,
                    payload TEXT,
                    success INTEGER DEFAULT 1,
                    duration_ms INTEGER,
                    error TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create dashboard_audit table
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS dashboard_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id TEXT,
                    admin_tag TEXT,
                    guild_id TEXT,
                    event_type TEXT NOT NULL,
                    before_data TEXT,
                    after_data TEXT,
                    ip TEXT,
                    user_agent TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for faster queries
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_type ON bot_logs(type)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_guild ON bot_logs(guild_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_user ON bot_logs(user_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_bot_logs_created ON bot_logs(created_at)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_guild ON dashboard_audit(guild_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_admin ON dashboard_audit(admin_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_created ON dashboard_audit(created_at)`);

            console.log('[Logger] Database tables initialized successfully');
            return true;
        } catch (error) {
            console.error('[Logger] Failed to initialize database:', error);
            return false;
        }
    }

    /**
     * Set dashboard reference for WebSocket broadcasting
     */
    setDashboard(dashboard) {
        this.dashboard = dashboard;
    }

    /**
     * Log a slash command execution
     */
    async logCommand(data) {
        try {
            const {
                commandName,
                userId,
                userTag,
                guildId,
                channelId,
                options = {},
                success = true,
                duration = 0,
                error = null
            } = data;

            const payload = JSON.stringify({
                command: commandName,
                options: options,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, user_id, user_tag, guild_id, channel_id, command, payload, success, duration_ms, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['command', userId, userTag, guildId, channelId, commandName, payload, success ? 1 : 0, duration, error]);

            // Broadcast to dashboard via WebSocket
            this._broadcastLog({
                type: 'command',
                commandName,
                userId,
                userTag,
                guildId,
                channelId,
                success,
                duration,
                error,
                timestamp: new Date().toISOString()
            });

            if (this.bot.consoleBuffer) {
                const msg = `[CMD] ${userTag} executed /${commandName} in ${guildId} ${success ? '✓' : '✗'}`;
                this._addToConsoleBuffer(guildId, msg);
            }
        } catch (err) {
            console.error('[Logger] Failed to log command:', err);
        }
    }

    /**
     * Log button clicks and modal submissions
     */
    async logButton(data) {
        try {
            const {
                customId,
                userId,
                userTag,
                guildId,
                channelId,
                messageId,
                action,
                success = true,
                error = null
            } = data;

            const payload = JSON.stringify({
                customId,
                messageId,
                action,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, user_id, user_tag, guild_id, channel_id, command, payload, success, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['button', userId, userTag, guildId, channelId, customId, payload, success ? 1 : 0, error]);

            this._broadcastLog({
                type: 'button',
                customId,
                userId,
                userTag,
                guildId,
                channelId,
                action,
                success,
                error,
                timestamp: new Date().toISOString()
            });

            if (this.bot.consoleBuffer) {
                const msg = `[BTN] ${userTag} clicked ${customId} in ${guildId}`;
                this._addToConsoleBuffer(guildId, msg);
            }
        } catch (err) {
            console.error('[Logger] Failed to log button:', err);
        }
    }

    /**
     * Log dashboard actions and setting changes
     */
    async logDashboardAction(data) {
        try {
            const {
                adminId,
                adminTag,
                guildId,
                eventType,
                beforeData = null,
                afterData = null,
                ip = null,
                userAgent = null
            } = data;

            const before = beforeData ? JSON.stringify(beforeData) : null;
            const after = afterData ? JSON.stringify(afterData) : null;

            await this.db.run(`
                INSERT INTO dashboard_audit (admin_id, admin_tag, guild_id, event_type, before_data, after_data, ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [adminId, adminTag, guildId, eventType, before, after, ip, userAgent]);

            // Also log to bot_logs for unified view
            const payload = JSON.stringify({
                eventType,
                beforeData,
                afterData,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, user_id, user_tag, guild_id, endpoint, payload, success)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, ['dashboard', adminId, adminTag, guildId, eventType, payload, 1]);

            this._broadcastLog({
                type: 'dashboard',
                adminId,
                adminTag,
                guildId,
                eventType,
                beforeData,
                afterData,
                timestamp: new Date().toISOString()
            });

            if (this.bot.consoleBuffer) {
                const msg = `[DASHBOARD] ${adminTag} changed ${eventType} in ${guildId}`;
                this._addToConsoleBuffer(guildId, msg);
            }
        } catch (err) {
            console.error('[Logger] Failed to log dashboard action:', err);
        }
    }

    /**
     * Log security events (kicks, bans, raids, etc.)
     */
    async logSecurityEvent(data) {
        try {
            const {
                eventType,
                guildId,
                channelId = null,
                moderatorId = null,
                moderatorTag = null,
                targetId = null,
                targetTag = null,
                reason = null,
                details = {}
            } = data;

            const payload = JSON.stringify({
                eventType,
                moderatorId,
                moderatorTag,
                targetId,
                targetTag,
                reason,
                details,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, user_id, user_tag, guild_id, channel_id, command, payload, success)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, ['security', targetId, targetTag, guildId, channelId, eventType, payload, 1]);

            this._broadcastLog({
                type: 'security',
                eventType,
                guildId,
                channelId,
                moderatorId,
                moderatorTag,
                targetId,
                targetTag,
                reason,
                details,
                timestamp: new Date().toISOString()
            });

            if (this.bot.consoleBuffer) {
                const msg = `[SECURITY] ${eventType}: ${targetTag || 'unknown'} by ${moderatorTag || 'system'} in ${guildId}`;
                this._addToConsoleBuffer(guildId, msg);
            }
        } catch (err) {
            console.error('[Logger] Failed to log security event:', err);
        }
    }

    /**
     * Log errors and exceptions
     */
    async logError(data) {
        try {
            const {
                error,
                context = '',
                userId = null,
                userTag = null,
                guildId = null,
                channelId = null,
                stack = null
            } = data;

            const errorMessage = error instanceof Error ? error.message : String(error);
            const stackTrace = stack || (error instanceof Error ? error.stack : null);

            const payload = JSON.stringify({
                context,
                error: errorMessage,
                stack: stackTrace,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, user_id, user_tag, guild_id, channel_id, command, payload, success, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['error', userId, userTag, guildId, channelId, context, payload, 0, errorMessage]);

            this._broadcastLog({
                type: 'error',
                context,
                error: errorMessage,
                stack: stackTrace,
                userId,
                userTag,
                guildId,
                channelId,
                timestamp: new Date().toISOString()
            });

            if (this.bot.consoleBuffer && guildId) {
                const msg = `[ERROR] ${context}: ${errorMessage}`;
                this._addToConsoleBuffer(guildId, msg);
            }

            console.error(`[Logger] Error logged: ${context}:`, errorMessage);
        } catch (err) {
            console.error('[Logger] Failed to log error:', err);
        }
    }

    /**
     * Log internal bot events (startup, shutdown, etc.)
     */
    async logInternal(data) {
        try {
            const {
                eventType,
                message,
                details = {}
            } = data;

            const payload = JSON.stringify({
                eventType,
                message,
                details,
                timestamp: new Date().toISOString()
            });

            await this.db.run(`
                INSERT INTO bot_logs (type, command, payload, success)
                VALUES (?, ?, ?, ?)
            `, ['internal', eventType, payload, 1]);

            this._broadcastLog({
                type: 'internal',
                eventType,
                message,
                details,
                timestamp: new Date().toISOString()
            });

            console.log(`[Logger] Internal event: ${eventType} - ${message}`);
        } catch (err) {
            console.error('[Logger] Failed to log internal event:', err);
        }
    }

    /**
     * Get logs with filtering and pagination
     */
    async getLogs(filters = {}) {
        try {
            const {
                type = null,
                guildId = null,
                userId = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = filters;

            let query = 'SELECT * FROM bot_logs WHERE 1=1';
            const params = [];

            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }
            if (guildId) {
                query += ' AND guild_id = ?';
                params.push(guildId);
            }
            if (userId) {
                query += ' AND user_id = ?';
                params.push(userId);
            }
            if (startDate) {
                query += ' AND created_at >= ?';
                params.push(startDate);
            }
            if (endDate) {
                query += ' AND created_at <= ?';
                params.push(endDate);
            }

            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const logs = await this.db.all(query, params);
            return logs || [];
        } catch (err) {
            console.error('[Logger] Failed to get logs:', err);
            return [];
        }
    }

    /**
     * Get dashboard audit logs
     */
    async getDashboardAudit(filters = {}) {
        try {
            const {
                guildId = null,
                adminId = null,
                eventType = null,
                limit = 100,
                offset = 0
            } = filters;

            let query = 'SELECT * FROM dashboard_audit WHERE 1=1';
            const params = [];

            if (guildId) {
                query += ' AND guild_id = ?';
                params.push(guildId);
            }
            if (adminId) {
                query += ' AND admin_id = ?';
                params.push(adminId);
            }
            if (eventType) {
                query += ' AND event_type = ?';
                params.push(eventType);
            }

            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const logs = await this.db.all(query, params);
            return logs;
        } catch (err) {
            console.error('[Logger] Failed to get dashboard audit:', err);
            return [];
        }
    }

    /**
     * Broadcast log to dashboard via WebSocket
     */
    _broadcastLog(logData) {
        if (this.dashboard && this.dashboard.wss) {
            try {
                const message = JSON.stringify({
                    type: 'log',
                    data: logData
                });

                this.dashboard.wss.clients.forEach(client => {
                    if (client.readyState === 1) { // WebSocket.OPEN
                        client.send(message);
                    }
                });
            } catch (err) {
                // Non-fatal, don't log to avoid recursion
            }
        }
    }

    /**
     * Add message to bot's console buffer
     */
    _addToConsoleBuffer(guildId, message) {
        if (!this.bot.consoleBuffer) return;
        
        const timestamp = new Date().toISOString();
        const formattedMsg = `[${timestamp}] ${message}`;
        
        if (!this.bot.consoleBuffer.has(guildId)) {
            this.bot.consoleBuffer.set(guildId, []);
        }
        
        const buffer = this.bot.consoleBuffer.get(guildId);
        buffer.push(formattedMsg);
        
        // Keep last 5000 messages per guild
        if (buffer.length > 5000) {
            buffer.shift();
        }
    }

    // ========================================
    // Winston-compatible wrapper methods
    // ========================================

    /**
     * Log info message (backward compatibility)
     */
    info(message, meta = {}) {
        console.log(`[INFO] ${message}`, meta);
        this.logInternal({
            eventType: 'info',
            message: String(message),
            details: meta
        }).catch(() => {});
    }

    /**
     * Log warning message (backward compatibility)
     */
    warn(message, meta = {}) {
        console.warn(`[WARN] ${message}`, meta);
        this.logInternal({
            eventType: 'warning',
            message: String(message),
            details: meta
        }).catch(() => {});
    }

    /**
     * Log error message (backward compatibility)
     */
    error(message, meta = {}) {
        console.error(`[ERROR] ${message}`, meta);
        this.logError({
            error: meta instanceof Error ? meta : new Error(String(message)),
            context: 'legacy_error_log',
            userId: meta.userId || null,
            userTag: meta.userTag || null,
            guildId: meta.guildId || null,
            channelId: meta.channelId || null
        }).catch(() => {});
    }

    /**
     * Log debug message (backward compatibility)
     */
    debug(message, meta = {}) {
        if (process.env.LOG_LEVEL === 'debug') {
            console.debug(`[DEBUG] ${message}`, meta);
        }
    }

    /**
     * Log security event (backward compatibility)
     */
    security(message, meta = {}) {
        console.warn(`[SECURITY] ${message}`, meta);
        this.logSecurityEvent({
            eventType: 'security_alert',
            guildId: meta.guildId || null,
            channelId: meta.channelId || null,
            moderatorId: meta.moderatorId || null,
            moderatorTag: meta.moderatorTag || null,
            targetId: meta.targetId || null,
            targetTag: meta.targetTag || null,
            reason: String(message),
            details: meta
        }).catch(() => {});
    }

    /**
     * Log audit event (backward compatibility)
     */
    audit(guildId, action, details = {}) {
        console.log(`[AUDIT] Guild: ${guildId} | Action: ${action}`, details);
        this.logInternal({
            eventType: 'audit',
            message: `${action} in guild ${guildId}`,
            details: { guildId, action, ...details }
        }).catch(() => {});
    }

    /**
     * Log moderation action (backward compatibility)
     */
    moderation(guildId, action, moderator, target, reason = '') {
        const message = `Guild: ${guildId} | ${action} | Moderator: ${moderator} | Target: ${target} | Reason: ${reason}`;
        console.log(`[MODERATION] ${message}`);
        this.logSecurityEvent({
            eventType: action,
            guildId: guildId,
            moderatorTag: moderator,
            targetTag: target,
            reason: reason,
            details: { action, moderator, target, reason }
        }).catch(() => {});
    }

    /**
     * Log performance metric (backward compatibility)
     */
    performance(operation, duration, meta = {}) {
        console.log(`[PERFORMANCE] ${operation} took ${duration}ms`, meta);
        this.logInternal({
            eventType: 'performance',
            message: `${operation} took ${duration}ms`,
            details: { operation, duration, ...meta }
        }).catch(() => {});
    }
}

module.exports = Logger;