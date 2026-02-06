/**
 * ModerationQueue - Enterprise-grade moderation action queue
 * Features: retries, idempotency, rate-limit safety, escalation
 */

const { PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');

class ModerationQueue {
    constructor(bot) {
        this.bot = bot;
        this.queue = [];
        this.processing = false;
        this.processingLock = Promise.resolve(); // Mutex for race condition prevention
        this.actionHistory = new Map(); // idempotency: actionKey -> timestamp
        this.rateLimits = new Map(); // guildId -> { count, resetAt }
        this.maxRetries = 3;
        this.retryDelayMs = 2000;
        this.rateLimitWindow = 10000; // 10 seconds
        this.rateLimitMax = 10; // max 10 actions per window per guild
        this.idempotencyTTL = 60000; // 1 minute
        
        // Escalation thresholds (configurable per guild)
        this.defaultEscalation = {
            warnToTimeout: 3,
            timeoutToKick: 2,
            kickToBan: 1,
            offenseDecayDays: 30
        };
        
        // Start processing loop
        this.startProcessing();
        
        // Cleanup old idempotency keys
        setInterval(() => this.cleanupIdempotency(), 60000);
    }

    /**
     * Generate idempotency key for an action
     */
    generateActionKey(guildId, targetId, actionType, reason) {
        const data = `${guildId}:${targetId}:${actionType}:${reason || ''}`;
        return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
    }

    /**
     * Check if action was recently executed (idempotency)
     */
    isDuplicate(actionKey) {
        const lastExec = this.actionHistory.get(actionKey);
        if (!lastExec) return false;
        return Date.now() - lastExec < this.idempotencyTTL;
    }

    /**
     * Check rate limit for guild
     */
    isRateLimited(guildId) {
        const limit = this.rateLimits.get(guildId);
        if (!limit) return false;
        if (Date.now() > limit.resetAt) {
            this.rateLimits.delete(guildId);
            return false;
        }
        return limit.count >= this.rateLimitMax;
    }

    /**
     * Increment rate limit counter
     */
    incrementRateLimit(guildId) {
        const limit = this.rateLimits.get(guildId);
        if (!limit || Date.now() > limit.resetAt) {
            this.rateLimits.set(guildId, { count: 1, resetAt: Date.now() + this.rateLimitWindow });
        } else {
            limit.count++;
        }
    }

    /**
     * Enqueue a moderation action
     * @param {Object} action - { guildId, targetId, actionType, reason, moderatorId, severity, skipEscalation }
     * @returns {Promise<Object>} - { queued, actionKey, position }
     */
    async enqueue(action) {
        const { guildId, targetId, actionType, reason, moderatorId, skipEscalation = false } = action;
        
        // Validate required fields
        if (!guildId || !targetId || !actionType) {
            throw new Error('Missing required fields: guildId, targetId, actionType');
        }

        // Generate idempotency key
        const actionKey = this.generateActionKey(guildId, targetId, actionType, reason);
        
        // Check for duplicate
        if (this.isDuplicate(actionKey)) {
            this.bot.logger?.info(`[ModerationQueue] Duplicate action blocked: ${actionKey}`);
            return { queued: false, actionKey, reason: 'duplicate' };
        }

        // Check rate limit
        if (this.isRateLimited(guildId)) {
            this.bot.logger?.warn(`[ModerationQueue] Rate limited for guild ${guildId}`);
            return { queued: false, actionKey, reason: 'rate_limited' };
        }

        // Check if escalation should be applied
        let finalActionType = actionType;
        if (!skipEscalation && ['warn', 'timeout', 'kick'].includes(actionType)) {
            finalActionType = await this.checkEscalation(guildId, targetId, actionType);
        }

        // Add to queue
        const queueItem = {
            ...action,
            actionType: finalActionType,
            originalActionType: actionType,
            actionKey,
            retries: 0,
            enqueuedAt: Date.now()
        };
        
        this.queue.push(queueItem);
        this.bot.logger?.info(`[ModerationQueue] Queued ${finalActionType} for ${targetId} in ${guildId}`);
        
        return { queued: true, actionKey, position: this.queue.length, escalated: finalActionType !== actionType };
    }

    /**
     * Check and apply escalation based on user's offense history
     */
    async checkEscalation(guildId, targetId, requestedAction) {
        try {
            const config = await this.getEscalationConfig(guildId);
            const history = await this.getOffenseHistory(guildId, targetId, config.offenseDecayDays);
            
            const warnCount = history.filter(h => h.action_type === 'warn').length;
            const timeoutCount = history.filter(h => h.action_type === 'timeout').length;
            const kickCount = history.filter(h => h.action_type === 'kick').length;

            // Escalation logic
            if (requestedAction === 'warn') {
                if (warnCount >= config.warnToTimeout) {
                    this.bot.logger?.info(`[ModerationQueue] Escalating warn to timeout (${warnCount} previous warns)`);
                    return 'timeout';
                }
            } else if (requestedAction === 'timeout') {
                if (timeoutCount >= config.timeoutToKick) {
                    this.bot.logger?.info(`[ModerationQueue] Escalating timeout to kick (${timeoutCount} previous timeouts)`);
                    return 'kick';
                }
            } else if (requestedAction === 'kick') {
                if (kickCount >= config.kickToBan) {
                    this.bot.logger?.info(`[ModerationQueue] Escalating kick to ban (${kickCount} previous kicks)`);
                    return 'ban';
                }
            }

            return requestedAction;
        } catch (err) {
            this.bot.logger?.warn(`[ModerationQueue] Escalation check failed: ${err.message}`);
            return requestedAction;
        }
    }

    /**
     * Get escalation config for guild
     */
    async getEscalationConfig(guildId) {
        try {
            const cfg = await this.bot.database?.getGuildConfig(guildId);
            return {
                warnToTimeout: cfg?.escalation_warn_to_timeout || this.defaultEscalation.warnToTimeout,
                timeoutToKick: cfg?.escalation_timeout_to_kick || this.defaultEscalation.timeoutToKick,
                kickToBan: cfg?.escalation_kick_to_ban || this.defaultEscalation.kickToBan,
                offenseDecayDays: cfg?.offense_decay_days || this.defaultEscalation.offenseDecayDays
            };
        } catch {
            return this.defaultEscalation;
        }
    }

    /**
     * Get user's offense history within decay period
     */
    async getOffenseHistory(guildId, targetId, decayDays) {
        try {
            const cutoffDate = new Date(Date.now() - decayDays * 24 * 60 * 60 * 1000).toISOString();
            const rows = await this.bot.database?.all(
                `SELECT action_type, created_at FROM mod_actions 
                 WHERE guild_id = ? AND target_id = ? AND created_at > ?
                 ORDER BY created_at DESC`,
                [guildId, targetId, cutoffDate]
            );
            return rows || [];
        } catch {
            return [];
        }
    }

    /**
     * Start the processing loop
     */
    startProcessing() {
        setInterval(async () => {
            if (this.processing || this.queue.length === 0) return;
            
            this.processing = true;
            try {
                await this.processNext();
            } catch (err) {
                this.bot.logger?.error(`[ModerationQueue] Processing error: ${err.message}`);
            } finally {
                this.processing = false;
            }
        }, 500); // Process every 500ms
    }

    /**
     * Process the next item in queue
     */
    async processNext() {
        const item = this.queue.shift();
        if (!item) return;

        // Recheck rate limit before executing
        if (this.isRateLimited(item.guildId)) {
            // Re-queue at the end
            this.queue.push(item);
            return;
        }

        try {
            await this.executeAction(item);
            
            // Mark as executed for idempotency
            this.actionHistory.set(item.actionKey, Date.now());
            this.incrementRateLimit(item.guildId);
            
        } catch (err) {
            item.retries++;
            
            if (item.retries < this.maxRetries) {
                this.bot.logger?.warn(`[ModerationQueue] Retry ${item.retries}/${this.maxRetries} for ${item.actionKey}: ${err.message}`);
                // Re-queue with delay
                setTimeout(() => this.queue.unshift(item), this.retryDelayMs * item.retries);
            } else {
                this.bot.logger?.error(`[ModerationQueue] Action failed after ${this.maxRetries} retries: ${item.actionKey}`);
                // Log failure for audit
                await this.logFailedAction(item, err);
            }
        }
    }

    /**
     * Execute a moderation action
     */
    async executeAction(item) {
        const { guildId, targetId, actionType, reason, moderatorId, duration } = item;
        
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) throw new Error('Guild not found');

        const member = await guild.members.fetch(targetId).catch(() => null);
        
        // Check hierarchy before executing
        const botMember = guild.members.me;
        if (member && botMember) {
            if (member.roles.highest.position >= botMember.roles.highest.position) {
                throw new Error('Target has equal or higher role than bot');
            }
        }

        // Check protected roles
        const cfg = await this.bot.database?.getGuildConfig(guildId);
        const protectedRoles = cfg?.protected_roles ? JSON.parse(cfg.protected_roles) : [];
        if (member && protectedRoles.some(r => member.roles.cache.has(r))) {
            throw new Error('Target has a protected role');
        }

        // Check owner immunity
        if (targetId === guild.ownerId) {
            throw new Error('Cannot moderate server owner');
        }

        // Execute based on action type
        switch (actionType) {
            case 'warn':
                await this.executeWarn(guild, member, reason, moderatorId);
                break;
            case 'timeout':
                await this.executeTimeout(guild, member, reason, moderatorId, duration);
                break;
            case 'kick':
                await this.executeKick(guild, member, reason, moderatorId);
                break;
            case 'ban':
                await this.executeBan(guild, targetId, reason, moderatorId);
                break;
            case 'unban':
                await this.executeUnban(guild, targetId, reason, moderatorId);
                break;
            default:
                throw new Error(`Unknown action type: ${actionType}`);
        }

        // Log successful action
        await this.logSuccessfulAction(item);
    }

    async executeWarn(guild, member, reason, moderatorId) {
        if (!member) throw new Error('Member not found');
        
        await this.bot.database?.run(
            `INSERT INTO mod_actions (guild_id, target_id, action_type, reason, moderator_id, created_at)
             VALUES (?, ?, 'warn', ?, ?, CURRENT_TIMESTAMP)`,
            [guild.id, member.id, reason, moderatorId]
        );

        // Try to DM user
        try {
            await member.send(`⚠️ You have been warned in **${guild.name}**\nReason: ${reason || 'No reason provided'}`);
        } catch {}
    }

    async executeTimeout(guild, member, reason, moderatorId, duration = 600000) {
        if (!member) throw new Error('Member not found');
        
        await member.timeout(duration, reason || 'No reason provided');
        
        await this.bot.database?.run(
            `INSERT INTO mod_actions (guild_id, target_id, action_type, reason, moderator_id, duration, created_at)
             VALUES (?, ?, 'timeout', ?, ?, ?, CURRENT_TIMESTAMP)`,
            [guild.id, member.id, reason, moderatorId, duration]
        );
    }

    async executeKick(guild, member, reason, moderatorId) {
        if (!member) throw new Error('Member not found');
        
        // Try to DM before kick
        try {
            await member.send(`👢 You have been kicked from **${guild.name}**\nReason: ${reason || 'No reason provided'}`);
        } catch {}

        await member.kick(reason || 'No reason provided');
        
        await this.bot.database?.run(
            `INSERT INTO mod_actions (guild_id, target_id, action_type, reason, moderator_id, created_at)
             VALUES (?, ?, 'kick', ?, ?, CURRENT_TIMESTAMP)`,
            [guild.id, member.id, reason, moderatorId]
        );
    }

    async executeBan(guild, targetId, reason, moderatorId) {
        // Try to DM before ban
        try {
            const user = await this.bot.client.users.fetch(targetId);
            await user.send(`🔨 You have been banned from **${guild.name}**\nReason: ${reason || 'No reason provided'}`);
        } catch {}

        await guild.bans.create(targetId, { reason: reason || 'No reason provided', deleteMessageDays: 1 });
        
        await this.bot.database?.run(
            `INSERT INTO mod_actions (guild_id, target_id, action_type, reason, moderator_id, created_at)
             VALUES (?, ?, 'ban', ?, ?, CURRENT_TIMESTAMP)`,
            [guild.id, targetId, reason, moderatorId]
        );
    }

    async executeUnban(guild, targetId, reason, moderatorId) {
        await guild.bans.remove(targetId, reason || 'Unbanned');
        
        await this.bot.database?.run(
            `INSERT INTO mod_actions (guild_id, target_id, action_type, reason, moderator_id, created_at)
             VALUES (?, ?, 'unban', ?, ?, CURRENT_TIMESTAMP)`,
            [guild.id, targetId, reason, moderatorId]
        );
    }

    async logSuccessfulAction(item) {
        try {
            if (this.bot.forensicsManager) {
                await this.bot.forensicsManager.logAuditEvent({
                    guildId: item.guildId,
                    eventType: item.actionType,
                    eventCategory: 'moderation',
                    executor: { id: item.moderatorId },
                    target: { id: item.targetId, type: 'user' },
                    reason: item.reason,
                    metadata: { escalated: item.originalActionType !== item.actionType, queuedAt: item.enqueuedAt }
                });
            }
        } catch {}
    }

    async logFailedAction(item, error) {
        try {
            this.bot.logger?.error(`[ModerationQueue] Failed action logged: ${JSON.stringify({
                ...item,
                error: error.message
            })}`);
        } catch {}
    }

    cleanupIdempotency() {
        const now = Date.now();
        for (const [key, timestamp] of this.actionHistory) {
            if (now - timestamp > this.idempotencyTTL * 2) {
                this.actionHistory.delete(key);
            }
        }
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            idempotencyKeys: this.actionHistory.size,
            rateLimits: Object.fromEntries(this.rateLimits)
        };
    }
}

module.exports = ModerationQueue;
