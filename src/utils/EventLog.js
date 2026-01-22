/**
 * Unified Event Logging System
 * 
 * ARCHITECTURE DECISION:
 * This is the SINGLE canonical event logging system for the entire bot.
 * All other logging utilities (Logger, AuditLogger, ForensicsManager, DashboardLogger)
 * should delegate to this class or read from its output.
 * 
 * DESIGN PRINCIPLES:
 * 1. One writer, many readers
 * 2. All events in one table with consistent schema
 * 3. Optional encryption for sensitive data
 * 4. WebSocket broadcast for real-time dashboard updates
 * 5. Backward compatible with existing log queries
 */

const crypto = require('crypto');

// Event categories for filtering and organization
const EventCategory = {
    COMMAND: 'command',
    MODERATION: 'moderation',
    SECURITY: 'security',
    GUILD_CHANGE: 'guild_change',
    USER_ACTION: 'user_action',
    SYSTEM: 'system',
    DASHBOARD: 'dashboard',
    BILLING: 'billing',
    TICKET: 'ticket',
    VERIFICATION: 'verification'
};

// Event severity levels
const Severity = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

class EventLog {
    constructor(database) {
        this.db = database;
        this.encryptionKey = process.env.AUDIT_ENCRYPTION_KEY || process.env.AUDIT_LOG_SECRET || null;
        this.encryptionEnabled = !!this.encryptionKey;
        this.broadcastHandlers = new Set();
        this.consoleBuffer = [];
        this.maxConsoleBuffer = 5000;
    }

    /**
     * Register a broadcast handler (e.g., WebSocket)
     */
    onBroadcast(handler) {
        this.broadcastHandlers.add(handler);
        return () => this.broadcastHandlers.delete(handler);
    }

    /**
     * Broadcast event to all registered handlers
     */
    _broadcast(event) {
        for (const handler of this.broadcastHandlers) {
            try {
                handler(event);
            } catch (e) {
                console.error('[EventLog] Broadcast handler error:', e.message);
            }
        }
    }

    /**
     * Add to console buffer for dashboard
     */
    _addToConsoleBuffer(guildId, message, level = 'info') {
        const entry = {
            timestamp: new Date().toISOString(),
            guildId,
            message,
            level
        };
        this.consoleBuffer.push(entry);
        if (this.consoleBuffer.length > this.maxConsoleBuffer) {
            this.consoleBuffer.shift();
        }
        return entry;
    }

    /**
     * Get console buffer for guild
     */
    getConsoleBuffer(guildId = null, limit = 100) {
        const filtered = guildId 
            ? this.consoleBuffer.filter(e => e.guildId === guildId || !e.guildId)
            : this.consoleBuffer;
        return filtered.slice(-limit);
    }

    /**
     * Hash IP address for privacy
     */
    hashIP(ip) {
        if (!ip) return null;
        const salt = this.encryptionKey || 'eventlog_salt';
        return crypto.createHash('sha256').update(`${ip}:${salt}`).digest('hex').slice(0, 32);
    }

    /**
     * Encrypt sensitive payload data
     */
    encryptPayload(payload) {
        if (!payload) return null;
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!this.encryptionEnabled) return serialized;

        try {
            const iv = crypto.randomBytes(12);
            const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            let encrypted = cipher.update(serialized, 'utf8', 'base64');
            encrypted += cipher.final('base64');
            const tag = cipher.getAuthTag().toString('base64');

            return JSON.stringify({ iv: iv.toString('base64'), tag, data: encrypted });
        } catch (e) {
            console.error('[EventLog] Encryption failed:', e.message);
            return serialized;
        }
    }

    /**
     * Decrypt sensitive payload data
     */
    decryptPayload(serialized) {
        if (!serialized) return null;
        try {
            const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
            if (!parsed?.data || !parsed?.iv || !parsed?.tag) {
                return parsed;
            }

            const key = crypto.createHash('sha256').update(this.encryptionKey || '').digest();
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                key,
                Buffer.from(parsed.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
            let decrypted = decipher.update(parsed.data, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (e) {
            // Return raw value if decryption fails (might be unencrypted)
            return serialized;
        }
    }

    /**
     * Log an event to the unified events table
     * This is the CORE logging method - all other methods call this
     */
    async log({
        eventType,
        category = EventCategory.SYSTEM,
        severity = Severity.INFO,
        guildId = null,
        userId = null,
        userTag = null,
        executorId = null,
        executorTag = null,
        targetType = null,
        targetId = null,
        targetName = null,
        channelId = null,
        command = null,
        action = null,
        reason = null,
        beforeState = null,
        afterState = null,
        metadata = null,
        ip = null,
        userAgent = null,
        deviceFingerprint = null,
        success = true,
        duration = null,
        error = null,
        canReplay = false
    }) {
        const timestamp = new Date().toISOString();

        try {
            // Encrypt sensitive data
            const encryptedBefore = this.encryptPayload(beforeState);
            const encryptedAfter = this.encryptPayload(afterState);
            const encryptedMetadata = this.encryptPayload(metadata);

            await this.db.run(`
                INSERT INTO events (
                    event_type, category, severity, guild_id, user_id, user_tag,
                    executor_id, executor_tag, target_type, target_id, target_name,
                    channel_id, command, action, reason, before_state, after_state,
                    metadata, ip_hash, user_agent, device_fingerprint, success,
                    duration_ms, error, can_replay, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                eventType,
                category,
                severity,
                guildId,
                userId,
                userTag,
                executorId,
                executorTag,
                targetType,
                targetId,
                targetName,
                channelId,
                command,
                action,
                reason,
                encryptedBefore,
                encryptedAfter,
                encryptedMetadata,
                this.hashIP(ip),
                userAgent,
                deviceFingerprint,
                success ? 1 : 0,
                duration,
                error,
                canReplay ? 1 : 0,
                timestamp
            ]);

            // Create broadcast event
            const broadcastEvent = {
                eventType,
                category,
                severity,
                guildId,
                userId,
                userTag,
                executorId,
                executorTag,
                targetId,
                targetName,
                command,
                action,
                success,
                error,
                timestamp
            };

            // Broadcast to WebSocket clients
            this._broadcast(broadcastEvent);

            // Add to console buffer
            const consoleMsg = this._formatConsoleMessage(broadcastEvent);
            this._addToConsoleBuffer(guildId, consoleMsg, severity);

            return { success: true, timestamp };
        } catch (err) {
            console.error('[EventLog] Failed to log event:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Format event for console buffer display
     */
    _formatConsoleMessage(event) {
        const parts = [];
        
        if (event.category) parts.push(`[${event.category.toUpperCase()}]`);
        if (event.eventType) parts.push(event.eventType);
        if (event.userTag) parts.push(`by ${event.userTag}`);
        if (event.command) parts.push(`/${event.command}`);
        if (event.action) parts.push(event.action);
        if (event.targetName) parts.push(`→ ${event.targetName}`);
        if (!event.success) parts.push('✗');
        else parts.push('✓');

        return parts.join(' ');
    }

    // ============================================================
    // CONVENIENCE METHODS - Call log() with appropriate defaults
    // ============================================================

    /**
     * Log a slash command execution
     */
    async logCommand(data) {
        return this.log({
            eventType: 'COMMAND_EXECUTE',
            category: EventCategory.COMMAND,
            severity: data.success === false ? Severity.WARNING : Severity.INFO,
            guildId: data.guildId,
            userId: data.userId,
            userTag: data.userTag,
            channelId: data.channelId,
            command: data.commandName,
            metadata: data.options,
            success: data.success !== false,
            duration: data.duration,
            error: data.error
        });
    }

    /**
     * Log a moderation action
     */
    async logModAction(data) {
        return this.log({
            eventType: `MOD_${data.action?.toUpperCase() || 'ACTION'}`,
            category: EventCategory.MODERATION,
            severity: Severity.INFO,
            guildId: data.guildId,
            executorId: data.moderatorId,
            executorTag: data.moderatorTag,
            targetType: 'user',
            targetId: data.targetId,
            targetName: data.targetTag,
            action: data.action,
            reason: data.reason,
            metadata: { duration: data.duration },
            canReplay: ['ban', 'kick'].includes(data.action?.toLowerCase())
        });
    }

    /**
     * Log a security event
     */
    async logSecurity(data) {
        return this.log({
            eventType: data.eventType || 'SECURITY_EVENT',
            category: EventCategory.SECURITY,
            severity: data.severity || Severity.WARNING,
            guildId: data.guildId,
            userId: data.userId,
            userTag: data.userTag,
            action: data.action,
            metadata: data.details,
            ip: data.ip
        });
    }

    /**
     * Log a guild configuration change
     */
    async logGuildChange(data) {
        return this.log({
            eventType: data.eventType || 'GUILD_CHANGE',
            category: EventCategory.GUILD_CHANGE,
            severity: Severity.INFO,
            guildId: data.guildId,
            executorId: data.executorId,
            executorTag: data.executorTag,
            targetType: data.targetType,
            targetId: data.targetId,
            targetName: data.targetName,
            beforeState: data.before,
            afterState: data.after,
            reason: data.reason,
            canReplay: data.canReplay || false
        });
    }

    /**
     * Log a dashboard action
     */
    async logDashboard(data) {
        return this.log({
            eventType: data.eventType || 'DASHBOARD_ACTION',
            category: EventCategory.DASHBOARD,
            severity: Severity.INFO,
            guildId: data.guildId,
            userId: data.adminId,
            userTag: data.adminTag,
            action: data.action,
            beforeState: data.before,
            afterState: data.after,
            ip: data.ip,
            userAgent: data.userAgent
        });
    }

    /**
     * Log a ticket event
     */
    async logTicket(data) {
        return this.log({
            eventType: `TICKET_${data.action?.toUpperCase() || 'EVENT'}`,
            category: EventCategory.TICKET,
            severity: Severity.INFO,
            guildId: data.guildId,
            userId: data.userId,
            userTag: data.userTag,
            channelId: data.channelId,
            metadata: { ticketId: data.ticketId, ...data.metadata }
        });
    }

    /**
     * Log a verification event
     */
    async logVerification(data) {
        return this.log({
            eventType: `VERIFICATION_${data.action?.toUpperCase() || 'EVENT'}`,
            category: EventCategory.VERIFICATION,
            severity: data.success === false ? Severity.WARNING : Severity.INFO,
            guildId: data.guildId,
            userId: data.userId,
            userTag: data.userTag,
            action: data.action,
            success: data.success !== false,
            metadata: data.details
        });
    }

    /**
     * Log a system event
     */
    async logSystem(data) {
        return this.log({
            eventType: data.eventType || 'SYSTEM_EVENT',
            category: EventCategory.SYSTEM,
            severity: data.severity || Severity.INFO,
            metadata: data.details,
            error: data.error
        });
    }

    // ============================================================
    // QUERY METHODS - Read from the unified events table
    // ============================================================

    /**
     * Get events with filtering
     */
    async getEvents({
        guildId = null,
        category = null,
        eventType = null,
        userId = null,
        severity = null,
        startDate = null,
        endDate = null,
        limit = 100,
        offset = 0,
        decrypt = true
    } = {}) {
        let query = 'SELECT * FROM events WHERE 1=1';
        const params = [];

        if (guildId) { query += ' AND guild_id = ?'; params.push(guildId); }
        if (category) { query += ' AND category = ?'; params.push(category); }
        if (eventType) { query += ' AND event_type = ?'; params.push(eventType); }
        if (userId) { query += ' AND (user_id = ? OR executor_id = ?)'; params.push(userId, userId); }
        if (severity) { query += ' AND severity = ?'; params.push(severity); }
        if (startDate) { query += ' AND created_at >= ?'; params.push(startDate); }
        if (endDate) { query += ' AND created_at <= ?'; params.push(endDate); }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = await this.db.all(query, params);

        if (decrypt) {
            return rows.map(row => ({
                ...row,
                before_state: this.decryptPayload(row.before_state),
                after_state: this.decryptPayload(row.after_state),
                metadata: this.decryptPayload(row.metadata)
            }));
        }

        return rows;
    }

    /**
     * Get recent events for a guild (for nuke detection, etc.)
     */
    async getRecentEvents(guildId, minutes = 10) {
        const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        return this.getEvents({
            guildId,
            startDate: since,
            limit: 1000
        });
    }

    /**
     * Get event statistics for a guild
     */
    async getStats(guildId, days = 7) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        
        const stats = await this.db.all(`
            SELECT 
                category,
                COUNT(*) as count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
            FROM events
            WHERE guild_id = ? AND created_at >= ?
            GROUP BY category
        `, [guildId, since]);

        const total = await this.db.get(`
            SELECT COUNT(*) as count FROM events
            WHERE guild_id = ? AND created_at >= ?
        `, [guildId, since]);

        return {
            total: total?.count || 0,
            byCategory: stats,
            period: { days, since }
        };
    }

    /**
     * Get moderation action history for a user
     */
    async getUserModHistory(guildId, userId, limit = 50) {
        return this.getEvents({
            guildId,
            category: EventCategory.MODERATION,
            userId,
            limit
        });
    }

    /**
     * Get security events for a guild
     */
    async getSecurityEvents(guildId, limit = 100) {
        return this.getEvents({
            guildId,
            category: EventCategory.SECURITY,
            limit
        });
    }
}

// Export class and constants
module.exports = EventLog;
module.exports.EventCategory = EventCategory;
module.exports.Severity = Severity;
