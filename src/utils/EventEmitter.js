/**
 * Event System for Bot → Backend → Dashboard Communication
 * Standardized event contract to prevent undefined/malformed data issues
 */

class EventEmitter {
    constructor(bot) {
        this.bot = bot;
        this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
        this.internalApiKey = process.env.INTERNAL_API_KEY;
    }

    /**
     * Send event to backend (which broadcasts to dashboard clients)
     * @param {Object} event - Event object matching standardized contract
     */
    async sendEvent(event) {
        // Validate event structure
        if (!event.type || !event.guildId) {
            console.error('❌ Invalid event: missing type or guildId', event);
            return false;
        }

        // Standardize event contract
        const standardizedEvent = {
            type: event.type, // 'setting_change', 'security_event', 'moderation_action', etc.
            guildId: event.guildId,
            timestamp: event.timestamp || new Date().toISOString(),
            data: event.data || {}
        };

        // Validate data for setting_change events
        if (event.type === 'setting_change') {
            if (!event.data || event.data.key === undefined || event.data.value === undefined) {
                console.error('❌ Invalid setting_change event: missing data.key or data.value', event);
                return false;
            }
        }

        try {
            // If dashboard is in the same process, broadcast directly (skip HTTP)
            if (this.bot && this.bot.dashboard && typeof this.bot.dashboard.broadcastToGuild === 'function') {
                try {
                    this.bot.dashboard.broadcastToGuild(event.guildId, standardizedEvent);
                    this.bot?.logger?.debug(`✅ Event broadcast directly: ${event.type} for guild ${event.guildId}`);
                    return true;
                } catch (directErr) {
                    this.bot?.logger?.warn('Failed to broadcast directly, falling back to HTTP:', directErr.message);
                }
            }

            // Fallback: Use HTTP (when bot and dashboard are separate processes)
            const response = await fetch(`${this.backendUrl}/api/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.internalApiKey
                },
                body: JSON.stringify(standardizedEvent),
                signal: AbortSignal.timeout(5000) // 5s timeout
            });

            if (!response.ok) {
                throw new Error(`Backend responded with ${response.status}`);
            }

            this.bot?.logger?.debug(`✅ Event sent: ${event.type} for guild ${event.guildId}`);
            return true;

        } catch (error) {
            // Log but don't crash - events are non-critical
            // Only log if it's not a direct broadcast (which already succeeded)
            if (!(this.bot?.dashboard?.broadcastToGuild)) {
                console.error('❌ Failed to send event to backend:', error.message);
            }
            return false;
        }
    }

    /**
     * Emit setting change event (bot command → dashboard sync)
     */
    async emitSettingChange(guildId, key, value, moderatorId = null) {
        return await this.sendEvent({
            type: 'setting_change',
            guildId: guildId,
            data: {
                key: key, // exact DB column name (e.g., 'antinuke_enabled')
                value: value, // boolean, string, or number
                moderatorId: moderatorId,
                timestamp: Date.now()
            }
        });
    }

    /**
     * Emit security event (anti-nuke, anti-raid, etc.)
     */
    async emitSecurityEvent(guildId, action, details) {
        return await this.sendEvent({
            type: 'security_event',
            guildId: guildId,
            data: {
                action: action, // 'antinuke_detected', 'raid_blocked', etc.
                executorId: details.executorId,
                targetId: details.targetId,
                targetType: details.targetType, // 'channel', 'role', 'member'
                count: details.count,
                threshold: details.threshold,
                mitigated: details.mitigated,
                details: details.additionalInfo || {},
                timestamp: Date.now()
            }
        });
    }

    /**
     * Emit moderation action (ban, kick, warn, timeout)
     */
    async emitModerationAction(guildId, action, target, moderator, reason, canUndo = false) {
        return await this.sendEvent({
            type: 'moderation_action',
            guildId: guildId,
            data: {
                action: action, // 'ban', 'kick', 'warn', 'timeout'
                targetId: target.id,
                targetTag: target.tag || target.username,
                moderatorId: moderator.id,
                moderatorTag: moderator.tag || moderator.username,
                reason: reason,
                canUndo: canUndo,
                timestamp: Date.now()
            }
        });
    }

    /**
     * Emit bot status change
     */
    async emitBotStatus(online, details = {}) {
        // Broadcast to all guilds the bot is in
        if (this.bot?.guilds?.cache) {
            for (const [guildId, guild] of this.bot.guilds.cache) {
                await this.sendEvent({
                    type: 'bot_status',
                    guildId: guildId,
                    data: {
                        online: online,
                        ...details
                    }
                });
            }
        }
    }

    /**
     * Emit member join event for analytics
     */
    async emitMemberJoin(guildId, member) {
        return await this.sendEvent({
            type: 'member_join',
            guildId: guildId,
            data: {
                userId: member.id,
                username: member.user?.username || member.username,
                accountAge: Date.now() - member.user?.createdTimestamp,
                timestamp: Date.now()
            }
        });
    }

    /**
     * Emit member leave event for analytics
     */
    async emitMemberLeave(guildId, member, reason = 'left') {
        return await this.sendEvent({
            type: 'member_leave',
            guildId: guildId,
            data: {
                userId: member.id,
                username: member.user?.username || member.username,
                reason: reason, // 'left', 'kicked', 'banned'
                timestamp: Date.now()
            }
        });
    }

    /**
     * Emit analytics update event
     */
    async emitAnalytics(guildId, metrics) {
        return await this.sendEvent({
            type: 'analytics_update',
            guildId: guildId,
            data: {
                metrics: metrics, // { totalMembers, joins24h, leaves24h, messages24h, commands24h }
                timestamp: Date.now()
            }
        });
    }

    /**
     * Convenience local emit for in-process events (dashboard -> bot) or to reuse sendEvent formatting.
     * Accepts an event name and a payload object which should include `guildId`.
     */
    async emit(eventName, payload = {}) {
        if (!eventName) return false;
        const guildId = payload.guildId || payload.guild_id || null;
        const event = {
            type: eventName,
            guildId: guildId,
            timestamp: payload.timestamp || new Date().toISOString(),
            data: payload
        };
        return await this.sendEvent(event);
    }

    /**
     * Emit command usage event
     */
    async emitCommandUsed(guildId, commandName, userId) {
        return await this.sendEvent({
            type: 'command_used',
            guildId: guildId,
            data: {
                command: commandName,
                userId: userId,
                timestamp: Date.now()
            }
        });
    }
}

module.exports = EventEmitter;
