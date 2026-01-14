/**
 * Scheduled Actions System
 * Schedule unbans, unmutes, announcements, reminders, and custom actions
 */

const { EmbedBuilder } = require('discord.js');

class ScheduledActions {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        // Active timers
        this.timers = new Map(); // actionId -> timeout
        this.checkInterval = null;
    }

    async initialize() {
        await this.ensureTables();
        // Load and start pending actions
        await this.loadPendingActions();
        // Start periodic checker (every minute)
        this.startPeriodicChecker();
        this.bot.logger.info('ScheduledActions system initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS scheduled_actions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        action_type TEXT NOT NULL,
                        target_id TEXT,
                        target_type TEXT,
                        channel_id TEXT,
                        message TEXT,
                        metadata TEXT DEFAULT '{}',
                        scheduled_by TEXT NOT NULL,
                        execute_at DATETIME NOT NULL,
                        repeat_interval INTEGER,
                        repeat_unit TEXT,
                        max_repeats INTEGER,
                        repeat_count INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'pending',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        executed_at DATETIME,
                        error_message TEXT
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_actions_guild ON scheduled_actions(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_actions_status ON scheduled_actions(status)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_actions_execute ON scheduled_actions(execute_at)`);
            });
        });
    }

    // Start the periodic checker
    startPeriodicChecker() {
        // Check every minute for actions that need to execute
        this.checkInterval = setInterval(() => this.checkPendingActions(), 60000);
    }

    // Stop the periodic checker
    stopPeriodicChecker() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        // Clear all timers
        for (const timeout of this.timers.values()) {
            clearTimeout(timeout);
        }
        this.timers.clear();
    }

    // Load pending actions on startup
    async loadPendingActions() {
        const pending = await this.getPendingActions();
        this.bot.logger.info(`Loading ${pending.length} pending scheduled actions`);

        for (const action of pending) {
            this.scheduleAction(action);
        }
    }

    // Check for actions that need to execute now
    async checkPendingActions() {
        const now = new Date();
        const pending = await this.getActionsToExecute(now);

        for (const action of pending) {
            await this.executeAction(action);
        }
    }

    // Get all pending actions
    async getPendingActions() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM scheduled_actions WHERE status = 'pending' ORDER BY execute_at ASC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get actions ready to execute
    async getActionsToExecute(date) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM scheduled_actions 
                 WHERE status = 'pending' AND execute_at <= ?
                 ORDER BY execute_at ASC`,
                [date.toISOString()],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Schedule an action
    scheduleAction(action) {
        const executeAt = new Date(action.execute_at);
        const delay = executeAt.getTime() - Date.now();

        if (delay <= 0) {
            // Execute immediately
            this.executeAction(action);
            return;
        }

        // Only set timer if within 24 hours (longer timers handled by periodic checker)
        if (delay <= 24 * 60 * 60 * 1000) {
            const timeout = setTimeout(() => {
                this.executeAction(action);
            }, delay);
            this.timers.set(action.id, timeout);
        }
    }

    // Create a new scheduled action
    async createAction(options) {
        const {
            guildId,
            actionType,
            targetId,
            targetType,
            channelId,
            message,
            metadata = {},
            scheduledBy,
            executeAt,
            repeatInterval,
            repeatUnit,
            maxRepeats
        } = options;

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO scheduled_actions 
                 (guild_id, action_type, target_id, target_type, channel_id, message, metadata, scheduled_by, execute_at, repeat_interval, repeat_unit, max_repeats)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [guildId, actionType, targetId, targetType, channelId, message, JSON.stringify(metadata), scheduledBy, executeAt.toISOString(), repeatInterval, repeatUnit, maxRepeats],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        // Schedule the action
                        const action = {
                            id: this.lastID,
                            guild_id: guildId,
                            action_type: actionType,
                            target_id: targetId,
                            target_type: targetType,
                            channel_id: channelId,
                            message,
                            metadata: JSON.stringify(metadata),
                            scheduled_by: scheduledBy,
                            execute_at: executeAt.toISOString(),
                            repeat_interval: repeatInterval,
                            repeat_unit: repeatUnit,
                            max_repeats: maxRepeats,
                            status: 'pending'
                        };
                        resolve(action);
                    }
                }
            );
        }).then(action => {
            this.scheduleAction(action);
            return action;
        });
    }

    // Execute a scheduled action
    async executeAction(action) {
        // Clear timer if exists
        if (this.timers.has(action.id)) {
            clearTimeout(this.timers.get(action.id));
            this.timers.delete(action.id);
        }

        try {
            // Check if this is a global action (applies to all guilds)
            if (action.guild_id === 'global') {
                return await this.executeGlobalAction(action);
            }

            const guild = await this.bot.client.guilds.fetch(action.guild_id).catch(() => null);
            if (!guild) {
                await this.markActionFailed(action.id, 'Guild not found');
                return;
            }

            let success = false;
            let error = null;

            switch (action.action_type) {
                case 'unban':
                    success = await this.executeUnban(guild, action);
                    break;
                case 'unmute':
                    success = await this.executeUnmute(guild, action);
                    break;
                case 'remove_role':
                    success = await this.executeRemoveRole(guild, action);
                    break;
                case 'add_role':
                    success = await this.executeAddRole(guild, action);
                    break;
                case 'announcement':
                    success = await this.executeAnnouncement(guild, action);
                    break;
                case 'reminder':
                    success = await this.executeReminder(guild, action);
                    break;
                case 'unlock_channel':
                    success = await this.executeUnlockChannel(guild, action);
                    break;
                case 'lock_channel':
                    success = await this.executeLockChannel(guild, action);
                    break;
                // Punishment actions
                case 'kick':
                    success = await this.executeKick(guild, action);
                    break;
                case 'ban':
                    success = await this.executeBan(guild, action);
                    break;
                case 'timeout':
                    success = await this.executeTimeout(guild, action);
                    break;
                case 'warn':
                    success = await this.executeWarn(guild, action);
                    break;
                case 'custom':
                    success = await this.executeCustom(guild, action);
                    break;
                default:
                    error = `Unknown action type: ${action.action_type}`;
            }

            if (success) {
                await this.markActionComplete(action);
                
                // Handle repeat
                if (action.repeat_interval && action.repeat_unit) {
                    if (!action.max_repeats || action.repeat_count < action.max_repeats) {
                        await this.scheduleRepeat(action);
                    }
                }
            } else if (error) {
                await this.markActionFailed(action.id, error);
            }

        } catch (err) {
            this.bot.logger.error(`Failed to execute scheduled action ${action.id}:`, err);
            await this.markActionFailed(action.id, err.message);
        }
    }

    // Execute unban
    async executeUnban(guild, action) {
        try {
            await guild.members.unban(action.target_id, `Scheduled unban by <@${action.scheduled_by}>`);
            this.bot.logger.info(`Executed scheduled unban for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled unban failed:', err);
            return false;
        }
    }

    // Execute unmute (remove timeout)
    async executeUnmute(guild, action) {
        try {
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            if (!member) return false;

            await member.timeout(null, `Scheduled unmute by <@${action.scheduled_by}>`);
            this.bot.logger.info(`Executed scheduled unmute for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled unmute failed:', err);
            return false;
        }
    }

    // Execute remove role
    async executeRemoveRole(guild, action) {
        try {
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            if (!member) return false;

            const metadata = JSON.parse(action.metadata || '{}');
            const roleId = metadata.role_id;
            if (!roleId) return false;

            await member.roles.remove(roleId, `Scheduled role removal by <@${action.scheduled_by}>`);
            this.bot.logger.info(`Executed scheduled role removal for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled role removal failed:', err);
            return false;
        }
    }

    // Execute add role
    async executeAddRole(guild, action) {
        try {
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            if (!member) return false;

            const metadata = JSON.parse(action.metadata || '{}');
            const roleId = metadata.role_id;
            if (!roleId) return false;

            await member.roles.add(roleId, `Scheduled role addition by <@${action.scheduled_by}>`);
            this.bot.logger.info(`Executed scheduled role addition for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled role addition failed:', err);
            return false;
        }
    }

    // Execute announcement
    async executeAnnouncement(guild, action) {
        try {
            const channel = await guild.channels.fetch(action.channel_id).catch(() => null);
            if (!channel) return false;

            const metadata = JSON.parse(action.metadata || '{}');
            
            if (metadata.embed) {
                const embed = new EmbedBuilder()
                    .setDescription(action.message)
                    .setColor(metadata.color || 0x5865F2)
                    .setTimestamp();
                
                if (metadata.title) embed.setTitle(metadata.title);
                
                await channel.send({ embeds: [embed] });
            } else {
                await channel.send(action.message);
            }

            this.bot.logger.info(`Executed scheduled announcement in ${channel.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled announcement failed:', err);
            return false;
        }
    }

    // Execute reminder
    async executeReminder(guild, action) {
        try {
            const channel = await guild.channels.fetch(action.channel_id).catch(() => null);
            if (!channel) return false;

            const metadata = JSON.parse(action.metadata || '{}');
            const mention = action.target_id ? `<@${action.target_id}>` : '';

            const embed = new EmbedBuilder()
                .setTitle('⏰ Reminder')
                .setDescription(action.message)
                .setColor(0x5865F2)
                .setFooter({ text: `Set by ${metadata.scheduled_by_tag || 'Unknown'}` })
                .setTimestamp();

            await channel.send({ content: mention, embeds: [embed] });
            this.bot.logger.info(`Executed scheduled reminder in ${channel.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled reminder failed:', err);
            return false;
        }
    }

    // Execute unlock channel
    async executeUnlockChannel(guild, action) {
        try {
            const channel = await guild.channels.fetch(action.channel_id).catch(() => null);
            if (!channel) return false;

            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: null
            }, { reason: `Scheduled unlock by <@${action.scheduled_by}>` });

            this.bot.logger.info(`Executed scheduled channel unlock for ${channel.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled channel unlock failed:', err);
            return false;
        }
    }

    // Execute lock channel
    async executeLockChannel(guild, action) {
        try {
            const channel = await guild.channels.fetch(action.channel_id).catch(() => null);
            if (!channel) return false;

            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: false
            }, { reason: `Scheduled lock by <@${action.scheduled_by}>` });

            this.bot.logger.info(`Executed scheduled channel lock for ${channel.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled channel lock failed:', err);
            return false;
        }
    }

    // Execute scheduled kick
    async executeKick(guild, action) {
        try {
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            if (!member) {
                this.bot.logger.warn(`Scheduled kick failed: member ${action.target_id} not found`);
                return false;
            }

            if (!member.kickable) {
                this.bot.logger.warn(`Scheduled kick failed: member ${action.target_id} is not kickable`);
                return false;
            }

            const metadata = JSON.parse(action.metadata || '{}');
            const reason = metadata.reason || `Scheduled kick by <@${action.scheduled_by}>`;

            // Try to DM the user before kicking
            try {
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ You have been kicked')
                    .setDescription(`You have been kicked from **${guild.name}**`)
                    .addFields({ name: 'Reason', value: reason })
                    .setColor(0xf59e0b)
                    .setTimestamp();
                await member.send({ embeds: [embed] });
            } catch (_) {}

            await member.kick(reason);
            
            // Log to database
            await this.bot.database.logAction({
                guildId: guild.id,
                actionType: 'kick',
                actionCategory: 'moderation',
                targetUserId: action.target_id,
                targetUsername: member.user.tag,
                moderatorId: action.scheduled_by,
                moderatorUsername: metadata.scheduled_by_tag || 'System',
                reason: reason,
                canUndo: false,
                details: { scheduled: true, actionId: action.id }
            });

            this.bot.logger.info(`Executed scheduled kick for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled kick failed:', err);
            return false;
        }
    }

    // Execute scheduled ban
    async executeBan(guild, action) {
        try {
            const metadata = JSON.parse(action.metadata || '{}');
            const reason = metadata.reason || `Scheduled ban by <@${action.scheduled_by}>`;
            const deleteMessageDays = metadata.deleteMessageDays || 0;

            // Try to fetch and DM the user first
            try {
                const member = await guild.members.fetch(action.target_id).catch(() => null);
                if (member) {
                    const embed = new EmbedBuilder()
                        .setTitle('🔨 You have been banned')
                        .setDescription(`You have been banned from **${guild.name}**`)
                        .addFields({ name: 'Reason', value: reason })
                        .setColor(0xef4444)
                        .setTimestamp();
                    await member.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (_) {}

            await guild.members.ban(action.target_id, { 
                reason: reason,
                deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60
            });
            
            // Log to database
            await this.bot.database.logAction({
                guildId: guild.id,
                actionType: 'ban',
                actionCategory: 'moderation',
                targetUserId: action.target_id,
                targetUsername: metadata.target_tag || action.target_id,
                moderatorId: action.scheduled_by,
                moderatorUsername: metadata.scheduled_by_tag || 'System',
                reason: reason,
                canUndo: true,
                details: { scheduled: true, actionId: action.id }
            });

            this.bot.logger.info(`Executed scheduled ban for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled ban failed:', err);
            return false;
        }
    }

    // Execute scheduled timeout
    async executeTimeout(guild, action) {
        try {
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            if (!member) {
                this.bot.logger.warn(`Scheduled timeout failed: member ${action.target_id} not found`);
                return false;
            }

            if (!member.moderatable) {
                this.bot.logger.warn(`Scheduled timeout failed: member ${action.target_id} is not moderatable`);
                return false;
            }

            const metadata = JSON.parse(action.metadata || '{}');
            const reason = metadata.reason || `Scheduled timeout by <@${action.scheduled_by}>`;
            const duration = metadata.duration || 60 * 60 * 1000; // Default 1 hour

            await member.timeout(duration, reason);
            
            // Log to database
            await this.bot.database.logAction({
                guildId: guild.id,
                actionType: 'timeout',
                actionCategory: 'moderation',
                targetUserId: action.target_id,
                targetUsername: member.user.tag,
                moderatorId: action.scheduled_by,
                moderatorUsername: metadata.scheduled_by_tag || 'System',
                reason: reason,
                duration: `${Math.round(duration / 60000)}m`,
                canUndo: true,
                expiresAt: new Date(Date.now() + duration).toISOString(),
                details: { scheduled: true, actionId: action.id }
            });

            this.bot.logger.info(`Executed scheduled timeout for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled timeout failed:', err);
            return false;
        }
    }

    // Execute scheduled warn
    async executeWarn(guild, action) {
        try {
            const metadata = JSON.parse(action.metadata || '{}');
            const reason = metadata.reason || `Scheduled warning by <@${action.scheduled_by}>`;

            // Try to fetch the member
            const member = await guild.members.fetch(action.target_id).catch(() => null);
            const targetTag = member?.user?.tag || metadata.target_tag || action.target_id;

            // Add warning to database
            await this.bot.database.addWarning(
                guild.id,
                action.target_id,
                action.scheduled_by,
                reason
            );

            // Try to DM the user
            if (member) {
                try {
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ Warning')
                        .setDescription(`You have received a warning in **${guild.name}**`)
                        .addFields({ name: 'Reason', value: reason })
                        .setColor(0xfbbf24)
                        .setTimestamp();
                    await member.send({ embeds: [embed] });
                } catch (_) {}
            }
            
            // Log to database
            await this.bot.database.logAction({
                guildId: guild.id,
                actionType: 'warn',
                actionCategory: 'moderation',
                targetUserId: action.target_id,
                targetUsername: targetTag,
                moderatorId: action.scheduled_by,
                moderatorUsername: metadata.scheduled_by_tag || 'System',
                reason: reason,
                canUndo: true,
                details: { scheduled: true, actionId: action.id }
            });

            this.bot.logger.info(`Executed scheduled warning for ${action.target_id} in ${guild.id}`);
            return true;
        } catch (err) {
            this.bot.logger.error('Scheduled warning failed:', err);
            return false;
        }
    }

    // Execute custom action (using metadata)
    async executeCustom(guild, action) {
        const metadata = JSON.parse(action.metadata || '{}');
        // Custom actions can be extended here
        this.bot.logger.info(`Executed custom scheduled action: ${metadata.custom_type || 'unknown'}`);
        return true;
    }

    // Mark action as complete
    async markActionComplete(action) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE scheduled_actions SET status = 'completed', executed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [action.id],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Mark action as failed
    async markActionFailed(actionId, errorMessage) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE scheduled_actions SET status = 'failed', error_message = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [errorMessage, actionId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Schedule a repeat
    async scheduleRepeat(action) {
        const nextExecute = this.calculateNextExecute(action.execute_at, action.repeat_interval, action.repeat_unit);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE scheduled_actions 
                 SET execute_at = ?, status = 'pending', repeat_count = repeat_count + 1
                 WHERE id = ?`,
                [nextExecute.toISOString(), action.id],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Re-schedule
                        action.execute_at = nextExecute.toISOString();
                        this.scheduleAction(action);
                        resolve(true);
                    }
                }
            );
        });
    }

    // Calculate next execution time
    calculateNextExecute(currentExecute, interval, unit) {
        const date = new Date(currentExecute);
        
        switch (unit) {
            case 'minutes':
                date.setMinutes(date.getMinutes() + interval);
                break;
            case 'hours':
                date.setHours(date.getHours() + interval);
                break;
            case 'days':
                date.setDate(date.getDate() + interval);
                break;
            case 'weeks':
                date.setDate(date.getDate() + (interval * 7));
                break;
            case 'months':
                date.setMonth(date.getMonth() + interval);
                break;
        }
        
        return date;
    }

    // Execute a global action (applies to all guilds or bot-wide)
    async executeGlobalAction(action) {
        try {
            const metadata = JSON.parse(action.metadata || '{}');
            let successCount = 0;
            let failCount = 0;

            switch (action.action_type) {
                case 'global_announcement':
                    // Send announcement to all guilds with a specified channel type
                    const channelType = metadata.channel_type || 'announcements';
                    
                    for (const guild of this.bot.client.guilds.cache.values()) {
                        try {
                            // Find the target channel by name or type
                            const channel = guild.channels.cache.find(c => 
                                c.name.includes(channelType) || 
                                (metadata.channel_name && c.name.toLowerCase() === metadata.channel_name.toLowerCase())
                            );
                            
                            if (channel && channel.isTextBased()) {
                                const embed = new EmbedBuilder()
                                    .setTitle(metadata.title || '📢 Global Announcement')
                                    .setDescription(action.message)
                                    .setColor(metadata.color || 0x5865F2)
                                    .setFooter({ text: 'DarkLock Global Announcement' })
                                    .setTimestamp();
                                
                                if (metadata.image) embed.setImage(metadata.image);
                                
                                await channel.send({ embeds: [embed] });
                                successCount++;
                            }
                        } catch (err) {
                            failCount++;
                            this.bot.logger.debug(`Global announcement failed for guild ${guild.id}: ${err.message}`);
                        }
                    }
                    
                    this.bot.logger.info(`Global announcement sent to ${successCount} guilds (${failCount} failed)`);
                    break;

                case 'global_maintenance':
                    // Set maintenance mode for all guilds
                    this.bot.maintenanceMode = metadata.enabled !== false;
                    this.bot.maintenanceMessage = action.message || 'Bot is under maintenance';
                    this.bot.logger.info(`Maintenance mode ${this.bot.maintenanceMode ? 'enabled' : 'disabled'}`);
                    successCount = 1;
                    break;

                case 'global_status':
                    // Update bot status/activity
                    try {
                        await this.bot.client.user.setPresence({
                            activities: [{
                                name: action.message,
                                type: metadata.activity_type || 0 // 0 = Playing, 1 = Streaming, 2 = Listening, 3 = Watching
                            }],
                            status: metadata.status || 'online' // online, idle, dnd, invisible
                        });
                        this.bot.logger.info(`Bot status updated: ${action.message}`);
                        successCount = 1;
                    } catch (err) {
                        failCount = 1;
                        this.bot.logger.error('Failed to update bot status:', err);
                    }
                    break;

                case 'global_dm':
                    // DM specific users (from target list in metadata)
                    const userIds = metadata.user_ids || [];
                    for (const userId of userIds) {
                        try {
                            const user = await this.bot.client.users.fetch(userId);
                            const embed = new EmbedBuilder()
                                .setTitle(metadata.title || '📬 Message from DarkLock')
                                .setDescription(action.message)
                                .setColor(metadata.color || 0x5865F2)
                                .setTimestamp();
                            
                            await user.send({ embeds: [embed] });
                            successCount++;
                        } catch (err) {
                            failCount++;
                        }
                    }
                    this.bot.logger.info(`Global DM sent to ${successCount} users (${failCount} failed)`);
                    break;

                default:
                    this.bot.logger.warn(`Unknown global action type: ${action.action_type}`);
                    await this.markActionFailed(action.id, `Unknown global action type: ${action.action_type}`);
                    return false;
            }

            // Mark as complete with success info
            await this.markActionComplete(action);
            
            // Store execution results in metadata for logging
            const results = { successCount, failCount, executedAt: new Date().toISOString() };
            await new Promise((resolve) => {
                this.db.run(
                    `UPDATE scheduled_actions SET metadata = ? WHERE id = ?`,
                    [JSON.stringify({ ...metadata, execution_results: results }), action.id],
                    resolve
                );
            });

            return successCount > 0;
        } catch (err) {
            this.bot.logger.error(`Failed to execute global action ${action.id}:`, err);
            await this.markActionFailed(action.id, err.message);
            return false;
        }
    }

    // Create a global scheduled action (helper method)
    async createGlobalAction(options) {
        return this.createAction({
            ...options,
            guildId: 'global'
        });
    }

    // Get all global actions
    async getGlobalActions(status = null, limit = 20) {
        return this.getGuildActions('global', status, limit);
    }

    // Cancel an action
    async cancelAction(actionId) {
        // Clear timer if exists
        if (this.timers.has(actionId)) {
            clearTimeout(this.timers.get(actionId));
            this.timers.delete(actionId);
        }

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE scheduled_actions SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
                [actionId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Get actions for a guild
    async getGuildActions(guildId, status = null, limit = 20) {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM scheduled_actions WHERE guild_id = ?`;
            const params = [guildId];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }

            query += ` ORDER BY execute_at ASC LIMIT ?`;
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Get a specific action
    async getAction(actionId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM scheduled_actions WHERE id = ?`,
                [actionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Parse duration string (e.g., "1h", "30m", "1d")
    parseDuration(durationStr) {
        const match = durationStr.match(/^(\d+)([mhdwM])$/);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2];

        const unitMap = {
            'm': 'minutes',
            'h': 'hours',
            'd': 'days',
            'w': 'weeks',
            'M': 'months'
        };

        const msMap = {
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
            'w': 7 * 24 * 60 * 60 * 1000,
            'M': 30 * 24 * 60 * 60 * 1000
        };

        return {
            value,
            unit: unitMap[unit],
            ms: value * msMap[unit]
        };
    }
}

module.exports = ScheduledActions;
