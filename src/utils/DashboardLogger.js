/**
 * Enhanced Dashboard Logger for Real-time Command Tracking
 * Automatically logs all moderation actions to dashboard with user details
 */

class DashboardLogger {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Log a moderation action to both database and dashboard
     * @param {Object} actionData - The action data to log
     * @param {string} actionData.type - Type of action (ban, kick, warn, etc.)
     * @param {Object} actionData.target - Target user object
     * @param {Object} actionData.moderator - Moderator user object  
     * @param {string} actionData.guildId - Guild ID
     * @param {string} actionData.reason - Reason for action
     * @param {Object} actionData.extra - Extra data (duration, etc.)
     * @returns {Promise<string>} Action ID if successful
     */
    async logModerationAction(actionData) {
        try {
            const {
                type,
                target,
                moderator,
                guildId,
                reason = 'No reason provided',
                extra = {}
            } = actionData;

            // Generate action ID
            const actionId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Log to database
            if (this.bot && this.bot.database) {
                await this.bot.database.run(`
                    INSERT INTO mod_actions (
                        id, guild_id, action, reason, target_user_id, target_username, target_tag,
                        moderator_user_id, moderator_username, moderator_tag, created_at,
                        duration, can_undo, undone, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    actionId,
                    guildId,
                    type,
                    reason,
                    target.id,
                    target.username || target.tag?.split('#')[0] || 'Unknown',
                    target.tag || `${target.username}#0000`,
                    moderator.id,
                    moderator.username || moderator.tag?.split('#')[0] || 'Unknown',
                    moderator.tag || `${moderator.username}#0000`,
                    new Date().toISOString(),
                    extra.duration || null,
                    ['ban', 'kick', 'timeout', 'warn'].includes(type) ? 1 : 0,
                    0,
                    JSON.stringify(extra)
                ]);

                this.bot.logger?.info(`[DASHBOARD] Logged ${type} action ${actionId} by ${moderator.tag} on ${target.tag}`);
            }

            // Send to dashboard in real-time
            if (this.bot.dashboard && this.bot.dashboard.wss) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'action',
                    action: {
                        id: actionId,
                        type: type,
                        category: this.getCategoryFromType(type),
                        target: {
                            id: target.id,
                            tag: target.tag || `${target.username}#0000`,
                            username: target.username || 'Unknown',
                            avatar: target.displayAvatarURL?.() || target.avatarURL?.() || null
                        },
                        moderator: {
                            id: moderator.id,
                            tag: moderator.tag || `${moderator.username}#0000`,
                            username: moderator.username || 'Unknown',
                            avatar: moderator.displayAvatarURL?.() || moderator.avatarURL?.() || null
                        },
                        reason: reason,
                        timestamp: Date.now(),
                        duration: extra.duration || null,
                        canUndo: ['ban', 'kick', 'timeout', 'warn'].includes(type),
                        ...extra
                    }
                });

                this.bot.logger?.info(`[DASHBOARD] Broadcasted ${type} action to dashboard for guild ${guildId}`);
            }

            return actionId;

        } catch (error) {
            this.bot.logger?.error('[DASHBOARD] Error logging moderation action:', error);
            return null;
        }
    }

    /**
     * Log a utility command usage
     * @param {Object} commandData - Command usage data
     */
    async logCommandUsage(commandData) {
        try {
            const {
                commandName,
                user,
                guildId,
                options = {},
                success = true,
                responseTime = 0
            } = commandData;

            // Log to database if command logging table exists
            if (this.bot && this.bot.database) {
                try {
                    await this.bot.database.run(`
                        INSERT OR IGNORE INTO command_logs (
                            command_name, user_id, user_tag, guild_id, 
                            options, success, response_time, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        commandName,
                        user.id,
                        user.tag || `${user.username}#0000`,
                        guildId,
                        JSON.stringify(options),
                        success ? 1 : 0,
                        responseTime,
                        new Date().toISOString()
                    ]);
                } catch (dbError) {
                    // Table might not exist, that's ok for now
                    this.bot.logger?.debug('[DASHBOARD] Command logs table not available');
                }
            }

            // Send to dashboard for real-time command tracking
            if (this.bot.dashboard && this.bot.dashboard.wss && guildId) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'command_usage',
                    command: {
                        name: commandName,
                        user: {
                            id: user.id,
                            tag: user.tag || `${user.username}#0000`,
                            username: user.username || 'Unknown'
                        },
                        timestamp: Date.now(),
                        success: success,
                        responseTime: responseTime,
                        options: options
                    }
                });
            }

        } catch (error) {
            this.bot.logger?.error('[DASHBOARD] Error logging command usage:', error);
        }
    }

    /**
     * Log a security event (anti-spam, anti-raid, etc.)
     * @param {Object} eventData - Security event data
     */
    async logSecurityEvent(eventData) {
        try {
            const {
                type,
                severity,
                description,
                guildId,
                userId = null,
                autoAction = null,
                metadata = {}
            } = eventData;

            const eventId = `security_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Send to dashboard
            if (this.bot.dashboard && this.bot.dashboard.wss) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'security_event',
                    event: {
                        id: eventId,
                        type: type,
                        severity: severity,
                        description: description,
                        userId: userId,
                        autoAction: autoAction,
                        timestamp: Date.now(),
                        metadata: metadata
                    }
                });
            }

            // Log as moderation action if auto-action was taken
            if (autoAction && userId) {
                await this.logModerationAction({
                    type: autoAction.type,
                    target: { id: userId, tag: autoAction.userTag || 'Unknown#0000' },
                    moderator: { id: this.bot.user?.id || 'bot', tag: 'Security System' },
                    guildId: guildId,
                    reason: `Auto-moderation: ${description}`,
                    extra: { automated: true, securityEvent: type, ...metadata }
                });
            }

        } catch (error) {
            this.bot.logger?.error('[DASHBOARD] Error logging security event:', error);
        }
    }

    /**
     * Get category from action type
     * @param {string} type - Action type
     * @returns {string} Category
     */
    getCategoryFromType(type) {
        const categories = {
            'ban': 'moderation',
            'unban': 'moderation', 
            'kick': 'moderation',
            'warn': 'moderation',
            'timeout': 'moderation',
            'mute': 'moderation',
            'unmute': 'moderation',
            'purge': 'moderation',
            'slowmode': 'moderation',
            'lock': 'security',
            'unlock': 'security',
            'lockdown': 'security',
            'antispam': 'security',
            'antiraid': 'security',
            'antiphishing': 'security'
        };

        return categories[type] || 'utility';
    }

    /**
     * Create database table for command logging if it doesn't exist
     */
    async initializeTables() {
        if (this.bot && this.bot.database) {
            try {
                // Command logs table
                await this.bot.database.run(`
                    CREATE TABLE IF NOT EXISTS command_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        command_name TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        user_tag TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        options TEXT,
                        success INTEGER DEFAULT 1,
                        response_time INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                `);

                // Settings changes table
                await this.bot.database.run(`
                    CREATE TABLE IF NOT EXISTS settings_changes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        action_id TEXT UNIQUE NOT NULL,
                        guild_id TEXT NOT NULL,
                        guild_name TEXT NOT NULL,
                        category TEXT NOT NULL,
                        setting_name TEXT NOT NULL,
                        old_value TEXT,
                        new_value TEXT NOT NULL,
                        changed_by_id TEXT NOT NULL,
                        changed_by_name TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        extra_data TEXT DEFAULT '{}'
                    )
                `);

                this.bot.logger?.info('[DASHBOARD] Dashboard logging tables initialized');
            } catch (error) {
                this.bot.logger?.error('[DASHBOARD] Error initializing dashboard tables:', error);
            }
        }
    }

    /**
     * Generate a unique action ID
     */
    generateActionId() {
        return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Log setting changes from dashboard
     */
    async logSettingChange(category, settingName, newValue, oldValue, userId, username, guildId, guildName, extra = {}) {
        try {
            if (!this.bot.database) {
                this.bot.logger?.warn('[DASHBOARD] Database not available for setting change logging');
                return;
            }

            const actionId = this.generateActionId();
            const timestamp = new Date().toISOString();

            // Insert into settings_changes table
            await this.bot.database.run(`
                INSERT INTO settings_changes (
                    action_id, guild_id, guild_name, category, setting_name,
                    old_value, new_value, changed_by_id, changed_by_name,
                    timestamp, extra_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                actionId, guildId, guildName, category, settingName,
                JSON.stringify(oldValue), JSON.stringify(newValue),
                userId, username, timestamp, JSON.stringify(extra)
            ]);

            this.bot.logger?.info(`[DASHBOARD] Logged setting change ${actionId}: ${category}.${settingName} by ${username}`);

            // Send to dashboard in real-time
            if (this.bot.dashboard && this.bot.dashboard.wss) {
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'setting_change',
                    data: {
                        id: actionId,
                        category: category,
                        setting: settingName,
                        oldValue: oldValue,
                        newValue: newValue,
                        changedBy: {
                            id: userId,
                            username: username
                        },
                        timestamp: timestamp,
                        guildName: guildName,
                        ...extra
                    }
                });
            }

            return actionId;

        } catch (error) {
            this.bot.logger?.error('[DASHBOARD] Error logging setting change:', error);
            throw error;
        }
    }
}

module.exports = DashboardLogger;