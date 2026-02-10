/**
 * UnifiedLogger - Single entry point for all logging in DarkLock
 * 
 * ARCHITECTURE:
 * This module consolidates what was previously 4 separate logging systems:
 *   1. Logger (bot_logs, dashboard_audit)
 *   2. AuditLogger (audit_logs - encrypted)
 *   3. ForensicsManager (audit_logs - replay-capable)
 *   4. DashboardLogger (WebSocket broadcast)
 * 
 * All event types now flow through this single class.
 * The underlying storage still uses the same tables for backwards compatibility.
 * 
 * USAGE:
 *   const logger = bot.unifiedLogger;
 *   logger.logCommand({ ... });
 *   logger.logSecurityEvent({ ... });
 *   logger.logAudit({ ... });
 */

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4
};

class UnifiedLogger {
    /**
     * @param {Object} options
     * @param {Object} options.bot - Bot instance
     * @param {Object} options.logger - Primary Logger instance
     * @param {Object} options.forensics - ForensicsManager instance
     * @param {Object} options.dashboardLogger - DashboardLogger instance (optional)
     */
    constructor({ bot, logger, forensics, dashboardLogger = null }) {
        this.bot = bot;
        this.logger = logger;
        this.forensics = forensics;
        this.dashboardLogger = dashboardLogger;
        this.logLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;
        
        // In-memory event buffer for deduplication (prevents double-writes)
        this._recentEvents = new Map();
        this._dedupeWindowMs = 500; // Ignore duplicate events within 500ms
        
        // Cleanup dedup buffer every 30 seconds
        this._cleanupInterval = setInterval(() => this._cleanupDedup(), 30000);
    }

    /**
     * Cleanup dedup buffer
     */
    _cleanupDedup() {
        const cutoff = Date.now() - this._dedupeWindowMs * 2;
        for (const [key, ts] of this._recentEvents) {
            if (ts < cutoff) this._recentEvents.delete(key);
        }
    }

    /**
     * Check if event was already logged recently (dedup)
     */
    _isDuplicate(key) {
        const last = this._recentEvents.get(key);
        const now = Date.now();
        if (last && (now - last) < this._dedupeWindowMs) {
            return true;
        }
        this._recentEvents.set(key, now);
        return false;
    }

    /**
     * Generate a dedup key from event data
     */
    _dedupKey(type, data) {
        const parts = [type, data.guildId, data.userId, data.eventType || data.commandName || ''].filter(Boolean);
        return parts.join(':');
    }

    // ═══════════════════════════════════════════════════════════════
    // BOT EVENT LOGGING (writes to bot_logs)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log a slash command execution
     */
    async logCommand(data) {
        if (this.logger) {
            return this.logger.logCommand(data);
        }
    }

    /**
     * Log a button/modal interaction
     */
    async logButton(data) {
        if (this.logger) {
            return this.logger.logButton(data);
        }
    }

    /**
     * Log a security event (anti-raid, anti-spam, anti-nuke, etc.)
     * Writes to BOTH bot_logs AND audit_logs for full coverage.
     */
    async logSecurityEvent(data) {
        const key = this._dedupKey('security', data);
        if (this._isDuplicate(key)) return;

        // Write to bot_logs via Logger
        if (this.logger?.logSecurity) {
            try {
                await this.logger.logSecurity(data);
            } catch (e) {
                console.error('[UnifiedLogger] Logger.logSecurity failed:', e.message);
            }
        }

        // Write to audit_logs via ForensicsManager (encrypted, replay-capable)
        if (this.forensics) {
            try {
                await this.forensics.logAuditEvent({
                    guildId: data.guildId,
                    eventType: data.eventType || data.type || 'security_event',
                    eventCategory: 'security',
                    executor: { id: data.userId, tag: data.userTag },
                    target: { type: data.targetType, id: data.targetId },
                    changes: data.details || data.data || {},
                    reason: data.description || data.reason,
                    canReplay: false
                });
            } catch (e) {
                console.error('[UnifiedLogger] Forensics.logAuditEvent failed:', e.message);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DASHBOARD ACTION LOGGING (writes to dashboard_audit)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log a dashboard action (settings change, etc.)
     */
    async logDashboardAction(data) {
        if (this.logger?.logDashboardAction) {
            return this.logger.logDashboardAction(data);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // FORENSIC AUDIT LOGGING (writes to audit_logs, encrypted)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log an audit event (role changes, channel changes, etc.)
     * This is the primary method for detailed audit trail entries.
     */
    async logAudit(data) {
        const key = this._dedupKey('audit', data);
        if (this._isDuplicate(key)) return;

        if (this.forensics) {
            return this.forensics.logAuditEvent(data);
        }
    }

    /**
     * Get recent audit events for replay
     */
    async getRecentAuditEvents(guildId, minutes = 10) {
        if (this.forensics) {
            return this.forensics.getRecentEvents(guildId, minutes);
        }
        return [];
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log a system/lifecycle event
     */
    async logSystem(data) {
        if (this.logger?.logSystem) {
            return this.logger.logSystem(data);
        }
    }

    /**
     * Log an error
     */
    async logError(data) {
        if (this.logger?.logError) {
            return this.logger.logError(data);
        }
    }

    /**
     * Log an API call
     */
    async logAPI(data) {
        if (this.logger?.logAPI) {
            return this.logger.logAPI(data);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // WINSTON-STYLE CONVENIENCE METHODS
    // ═══════════════════════════════════════════════════════════════

    info(message, ...args) {
        if (this.logLevel <= LOG_LEVELS.INFO) {
            console.log(`[DarkLock] ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        if (this.logLevel <= LOG_LEVELS.WARN) {
            console.warn(`[DarkLock] ⚠️  ${message}`, ...args);
        }
    }

    error(message, ...args) {
        if (this.logLevel <= LOG_LEVELS.ERROR) {
            console.error(`[DarkLock] ❌ ${message}`, ...args);
        }
    }

    debug(message, ...args) {
        if (this.logLevel <= LOG_LEVELS.DEBUG) {
            console.log(`[DarkLock] 🔍 ${message}`, ...args);
        }
    }

    /**
     * Graceful shutdown - cleanup intervals
     */
    destroy() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        this._recentEvents.clear();
    }
}

module.exports = UnifiedLogger;
