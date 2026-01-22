const { PermissionFlagsBits, ChannelType } = require('discord.js');

/**
 * Professional Lockdown Management System
 * Handles server-wide or selective channel lockdowns with permission restoration
 */
class LockdownManager {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        this.logger = bot.logger;
    }

    /**
     * Initialize lockdown tables
     */
    async initialize() {
        try {
            // Main lockdown state table
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS lockdown_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    enabled BOOLEAN DEFAULT 1,
                    mode TEXT NOT NULL,
                    reason TEXT,
                    activated_by TEXT,
                    activated_by_tag TEXT,
                    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    deactivated_at DATETIME,
                    deactivated_by TEXT,
                    settings TEXT,
                    UNIQUE(guild_id, enabled)
                )
            `);

            // Channel permission backups
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS lockdown_channel_backups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lockdown_id INTEGER NOT NULL,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    original_slowmode INTEGER DEFAULT 0,
                    permission_overwrites TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(lockdown_id) REFERENCES lockdown_state(id)
                )
            `);

            // Indexes
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_lockdown_guild ON lockdown_state(guild_id, enabled)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_lockdown_backups ON lockdown_channel_backups(lockdown_id, channel_id)`);

            this.logger.info('[LockdownManager] Initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('[LockdownManager] Initialization failed:', error);
            return false;
        }
    }

    /**
     * Check if guild is in lockdown
     */
    async isLocked(guildId) {
        const row = await this.db.get(
            'SELECT id, mode, reason FROM lockdown_state WHERE guild_id = ? AND enabled = 1',
            [guildId]
        );
        return row || null;
    }

    /**
     * Activate lockdown with specified mode
     * @param {Guild} guild - Discord guild
     * @param {Object} options - Lockdown options
     * @returns {Object} Result with success status and details
     */
    async activate(guild, options = {}) {
        const {
            mode = 'full',
            reason = 'Server lockdown activated',
            activatedBy,
            activatedByTag,
            channelIds = [],
            settings = {}
        } = options;

        try {
            // Check if already locked
            const existing = await this.isLocked(guild.id);
            if (existing) {
                return { success: false, error: 'Server is already in lockdown' };
            }

            // Create lockdown record
            const result = await this.db.run(`
                INSERT INTO lockdown_state (guild_id, enabled, mode, reason, activated_by, activated_by_tag, settings)
                VALUES (?, 1, ?, ?, ?, ?, ?)
            `, [guild.id, mode, reason, activatedBy, activatedByTag, JSON.stringify(settings)]);

            const lockdownId = result.lastID;

            // Get channels to lock based on mode
            let channelsToLock = [];
            if (mode === 'full') {
                channelsToLock = guild.channels.cache.filter(c => 
                    c.type === ChannelType.GuildText || 
                    c.type === ChannelType.GuildAnnouncement ||
                    c.type === ChannelType.GuildForum
                ).map(c => c);
            } else if (mode === 'soft') {
                // Soft mode: only public channels (exclude staff channels)
                channelsToLock = guild.channels.cache.filter(c => {
                    if (c.type !== ChannelType.GuildText && c.type !== ChannelType.GuildAnnouncement) return false;
                    const name = c.name.toLowerCase();
                    return !name.includes('staff') && !name.includes('mod') && !name.includes('admin');
                }).map(c => c);
            } else if (mode === 'channels') {
                // Specific channels
                channelsToLock = channelIds.map(id => guild.channels.cache.get(id)).filter(Boolean);
            }

            const results = {
                locked: 0,
                failed: 0,
                channels: []
            };

            // Lock each channel
            for (const channel of channelsToLock) {
                try {
                    const lockResult = await this.lockChannel(channel, lockdownId, settings);
                    if (lockResult.success) {
                        results.locked++;
                        results.channels.push({ id: channel.id, name: channel.name, success: true });
                    } else {
                        results.failed++;
                        results.channels.push({ id: channel.id, name: channel.name, success: false, error: lockResult.error });
                    }
                } catch (error) {
                    results.failed++;
                    results.channels.push({ id: channel.id, name: channel.name, success: false, error: error.message });
                    this.logger.error(`[Lockdown] Failed to lock channel ${channel.name}:`, error);
                }
            }

            // Update guild config
            await this.db.run(`
                UPDATE guild_configs 
                SET updated_at = CURRENT_TIMESTAMP 
                WHERE guild_id = ?
            `, [guild.id]);

            // Log the lockdown activation
            await this.bot.logger.logSecurityEvent({
                eventType: 'LOCKDOWN_ACTIVATED',
                guildId: guild.id,
                moderatorId: activatedBy,
                moderatorTag: activatedByTag,
                reason: reason,
                details: {
                    mode,
                    channelsLocked: results.locked,
                    channelsFailed: results.failed,
                    settings
                }
            });

            this.logger.info(`[Lockdown] Activated in ${guild.name} (${mode}): ${results.locked} channels locked`);

            return {
                success: true,
                lockdownId,
                mode,
                ...results
            };

        } catch (error) {
            this.logger.error('[Lockdown] Activation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Lock a single channel
     */
    async lockChannel(channel, lockdownId, settings = {}) {
        try {
            const guild = channel.guild;

            // Backup original permissions
            const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString()
            }));

            // Store backup
            await this.db.run(`
                INSERT INTO lockdown_channel_backups (lockdown_id, guild_id, channel_id, channel_name, original_slowmode, permission_overwrites)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [lockdownId, guild.id, channel.id, channel.name, channel.rateLimitPerUser || 0, JSON.stringify(permissionOverwrites)]);

            // Get @everyone role
            const everyoneRole = guild.roles.everyone;

            // Lock @everyone permissions
            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: false,
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                SendMessagesInThreads: false
            }, { reason: `Lockdown: ${settings.reason || 'Server lockdown'}` });

            // Apply slowmode if configured
            if (settings.applySlowmode !== false) {
                await channel.setRateLimitPerUser(settings.slowmode || 60, 'Lockdown slowmode');
            }

            return { success: true };

        } catch (error) {
            this.logger.error(`[Lockdown] Failed to lock channel ${channel.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Deactivate lockdown and restore permissions
     */
    async deactivate(guild, options = {}) {
        const {
            deactivatedBy,
            deactivatedByTag,
            reason = 'Lockdown ended'
        } = options;

        try {
            // Get active lockdown
            const lockdown = await this.isLocked(guild.id);
            if (!lockdown) {
                return { success: false, error: 'Server is not in lockdown' };
            }

            const lockdownId = lockdown.id;

            // Get all backed up channels
            const backups = await this.db.all(`
                SELECT * FROM lockdown_channel_backups 
                WHERE lockdown_id = ?
            `, [lockdownId]);

            const results = {
                restored: 0,
                failed: 0,
                channels: []
            };

            // Restore each channel
            for (const backup of backups) {
                try {
                    const channel = guild.channels.cache.get(backup.channel_id);
                    if (!channel) {
                        results.failed++;
                        results.channels.push({ id: backup.channel_id, name: backup.channel_name, success: false, error: 'Channel not found' });
                        continue;
                    }

                    const restoreResult = await this.restoreChannel(channel, backup);
                    if (restoreResult.success) {
                        results.restored++;
                        results.channels.push({ id: channel.id, name: channel.name, success: true });
                    } else {
                        results.failed++;
                        results.channels.push({ id: channel.id, name: channel.name, success: false, error: restoreResult.error });
                    }
                } catch (error) {
                    results.failed++;
                    results.channels.push({ id: backup.channel_id, name: backup.channel_name, success: false, error: error.message });
                    this.logger.error(`[Lockdown] Failed to restore channel ${backup.channel_name}:`, error);
                }
            }

            // Mark lockdown as disabled
            await this.db.run(`
                UPDATE lockdown_state 
                SET enabled = 0, deactivated_at = CURRENT_TIMESTAMP, deactivated_by = ?
                WHERE id = ?
            `, [deactivatedBy, lockdownId]);

            // Log the deactivation
            await this.bot.logger.logSecurityEvent({
                eventType: 'LOCKDOWN_DEACTIVATED',
                guildId: guild.id,
                moderatorId: deactivatedBy,
                moderatorTag: deactivatedByTag,
                reason: reason,
                details: {
                    channelsRestored: results.restored,
                    channelsFailed: results.failed
                }
            });

            this.logger.info(`[Lockdown] Deactivated in ${guild.name}: ${results.restored} channels restored`);

            return {
                success: true,
                lockdownId,
                ...results
            };

        } catch (error) {
            this.logger.error('[Lockdown] Deactivation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Restore a single channel
     */
    async restoreChannel(channel, backup) {
        try {
            // Parse original permissions
            const originalPerms = JSON.parse(backup.permission_overwrites);

            // Clear current overwrites for @everyone to prevent conflicts
            const everyoneRole = channel.guild.roles.everyone;
            await channel.permissionOverwrites.delete(everyoneRole, 'Lockdown restore');

            // Restore original permission overwrites
            for (const overwrite of originalPerms) {
                try {
                    await channel.permissionOverwrites.create(overwrite.id, {
                        allow: BigInt(overwrite.allow),
                        deny: BigInt(overwrite.deny)
                    }, { 
                        type: overwrite.type,
                        reason: 'Lockdown restore' 
                    });
                } catch (error) {
                    // Log but continue with other overwrites
                    this.logger.warn(`[Lockdown] Failed to restore overwrite for ${overwrite.id}:`, error.message);
                }
            }

            // Restore slowmode
            await channel.setRateLimitPerUser(backup.original_slowmode || 0, 'Lockdown restore');

            return { success: true };

        } catch (error) {
            this.logger.error(`[Lockdown] Failed to restore channel ${channel.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get lockdown status for dashboard
     */
    async getStatus(guildId) {
        const lockdown = await this.db.get(`
            SELECT l.*, 
                   COUNT(b.id) as affected_channels
            FROM lockdown_state l
            LEFT JOIN lockdown_channel_backups b ON b.lockdown_id = l.id
            WHERE l.guild_id = ? AND l.enabled = 1
            GROUP BY l.id
        `, [guildId]);

        if (!lockdown) {
            return { active: false };
        }

        return {
            active: true,
            mode: lockdown.mode,
            reason: lockdown.reason,
            activatedBy: lockdown.activated_by_tag,
            activatedAt: lockdown.activated_at,
            affectedChannels: lockdown.affected_channels,
            settings: JSON.parse(lockdown.settings || '{}')
        };
    }

    /**
     * Get lockdown history
     */
    async getHistory(guildId, limit = 10) {
        return await this.db.all(`
            SELECT l.*,
                   COUNT(b.id) as affected_channels
            FROM lockdown_state l
            LEFT JOIN lockdown_channel_backups b ON b.lockdown_id = l.id
            WHERE l.guild_id = ?
            GROUP BY l.id
            ORDER BY l.activated_at DESC
            LIMIT ?
        `, [guildId, limit]);
    }

    /**
     * Handle new member join during lockdown
     */
    async handleNewJoin(member) {
        const lockdown = await this.isLocked(member.guild.id);
        if (!lockdown) return;

        const settings = JSON.parse(lockdown.settings || '{}');

        try {
            // Auto-timeout new accounts if configured
            if (settings.timeoutNewAccounts) {
                const accountAge = Date.now() - member.user.createdTimestamp;
                const hoursSinceCreated = accountAge / (1000 * 60 * 60);

                if (hoursSinceCreated < (settings.newAccountHours || 24)) {
                    await member.timeout(10 * 60 * 1000, 'New account during lockdown');
                    
                    await this.bot.logger.logSecurityEvent({
                        eventType: 'LOCKDOWN_AUTO_TIMEOUT',
                        guildId: member.guild.id,
                        targetId: member.user.id,
                        targetTag: member.user.tag,
                        reason: `New account (${hoursSinceCreated.toFixed(1)}h old) joined during lockdown`,
                        details: { accountAge: hoursSinceCreated }
                    });
                }
            }

            // Send DM notification if configured
            if (settings.notifyJoins) {
                try {
                    await member.send(`⚠️ ${member.guild.name} is currently in lockdown. Your access may be restricted until the lockdown is lifted.\n\n**Reason:** ${lockdown.reason}`);
                } catch (error) {
                    // Ignore DM failures
                }
            }

        } catch (error) {
            this.logger.error('[Lockdown] Failed to handle new join:', error);
        }
    }

    /**
     * Check if tickets should be disabled during lockdown
     */
    async shouldBlockTickets(guildId) {
        const lockdown = await this.isLocked(guildId);
        if (!lockdown) return false;

        const settings = JSON.parse(lockdown.settings || '{}');
        return settings.disableTickets === true;
    }
}

module.exports = LockdownManager;
