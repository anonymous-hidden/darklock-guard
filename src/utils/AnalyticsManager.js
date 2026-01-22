const { EmbedBuilder } = require('discord.js');

class AnalyticsManager {
    constructor(bot) {
        this.bot = bot;
        this.metrics = {
            messages: new Map(),
            commands: new Map(),
            joins: new Map(),
            leaves: new Map(),
            reactions: new Map()
        };
        
        // Real-time counters for WebSocket broadcasts (reset hourly)
        this.liveCounters = new Map(); // guildId -> { messages, joins, leaves, timeouts, bans, kicks, spamEvents }
        
        this.startCleanupInterval();
    }

    /**
     * Broadcast analytics_update via WebSocket for real-time dashboard charts
     * Now includes full chart-ready data format for live updates
     */
    broadcastAnalyticsUpdate(guildId, incrementType) {
        try {
            // Get or initialize counters for this guild
            if (!this.liveCounters.has(guildId)) {
                this.liveCounters.set(guildId, {
                    messages: 0,
                    joins: 0,
                    leaves: 0,
                    timeouts: 0,
                    bans: 0,
                    kicks: 0,
                    spamEvents: 0
                });
            }
            
            const counters = this.liveCounters.get(guildId);
            
            // Increment the appropriate counter
            if (incrementType && counters[incrementType] !== undefined) {
                counters[incrementType]++;
            }
            
            // Broadcast via WebSocket if dashboard is available
            if (this.bot.dashboard && this.bot.dashboard.broadcastToGuild) {
                const now = new Date();
                const timestamp = now.toISOString();
                
                // Build chart-ready payload with data object
                this.bot.dashboard.broadcastToGuild(guildId, {
                    type: 'analytics_update',
                    guildId: guildId,
                    data: {
                        // Summary counters (legacy format)
                        messages: counters.messages,
                        joins: counters.joins,
                        leaves: counters.leaves,
                        timeouts: counters.timeouts,
                        bans: counters.bans,
                        kicks: counters.kicks,
                        spamEvents: counters.spamEvents,
                        // Metrics object for dashboard-pro.js compatibility
                        metrics: {
                            messages24h: counters.messages,
                            joins24h: counters.joins,
                            leaves24h: counters.leaves
                        },
                        // Increment info for partial updates
                        incrementType: incrementType,
                        incrementValue: 1,
                        timestamp: timestamp
                    },
                    timestamp: timestamp
                });
            }
        } catch (e) {
            // Silent fail for WebSocket broadcasts
            this.bot.logger?.debug && this.bot.logger.debug('Analytics broadcast failed:', e.message);
        }
    }
    
    /**
     * Broadcast full analytics data for chart refresh
     * Called periodically or on significant events
     */
    async broadcastFullAnalytics(guildId) {
        try {
            if (!this.bot.dashboard || !this.bot.dashboard.broadcastToGuild) return;
            if (!this.bot.database) return;
            
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
            
            // Fetch live data from database
            const [messages, joins, leaves, modActions, spam] = await Promise.all([
                this.bot.database.all(`
                    SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp, SUM(message_count) as count
                    FROM message_analytics WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at) ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]).catch(() => []),
                
                this.bot.database.all(`
                    SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp, COUNT(*) as count
                    FROM join_analytics WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at) ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]).catch(() => []),
                
                this.bot.database.all(`
                    SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp, COUNT(*) as count
                    FROM leave_analytics WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at) ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]).catch(() => []),
                
                this.bot.database.all(`
                    SELECT action_type, strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp, COUNT(*) as count
                    FROM mod_actions WHERE guild_id = ? AND created_at > ?
                    GROUP BY action_type, strftime('%Y-%m-%d %H', created_at) ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]).catch(() => []),
                
                this.bot.database.all(`
                    SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) as timestamp, COUNT(*) as count
                    FROM spam_detection WHERE guild_id = ? AND created_at > ?
                    GROUP BY strftime('%Y-%m-%d %H', created_at) ORDER BY timestamp ASC
                `, [guildId, twentyFourHoursAgo]).catch(() => [])
            ]);
            
            // Process mod actions into categories
            const modActionsByType = { timeout: [], ban: [], kick: [], warn: [] };
            (modActions || []).forEach(d => {
                const type = (d.action_type || '').toLowerCase();
                const entry = { timestamp: d.timestamp, count: d.count || 0 };
                if (type.includes('timeout') || type.includes('mute')) modActionsByType.timeout.push(entry);
                else if (type.includes('ban')) modActionsByType.ban.push(entry);
                else if (type.includes('kick')) modActionsByType.kick.push(entry);
                else if (type.includes('warn')) modActionsByType.warn.push(entry);
            });
            
            // Broadcast full data
            this.bot.dashboard.broadcastToGuild(guildId, {
                type: 'analytics_update',
                guildId: guildId,
                data: {
                    messages: (messages || []).map(d => ({ timestamp: d.timestamp, count: d.count || 0 })),
                    joins: (joins || []).map(d => ({ timestamp: d.timestamp, count: d.count || 0 })),
                    leaves: (leaves || []).map(d => ({ timestamp: d.timestamp, count: d.count || 0 })),
                    modActions: modActionsByType,
                    spam: (spam || []).map(d => ({ timestamp: d.timestamp, count: d.count || 0 })),
                    hasData: (messages?.length > 0 || joins?.length > 0 || spam?.length > 0),
                    summary: {
                        totalMessages: (messages || []).reduce((s, d) => s + (d.count || 0), 0),
                        totalJoins: (joins || []).reduce((s, d) => s + (d.count || 0), 0),
                        totalLeaves: (leaves || []).reduce((s, d) => s + (d.count || 0), 0)
                    }
                },
                timestamp: now.toISOString()
            });
            
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('Full analytics broadcast failed:', e.message);
        }
    }

    // Message Analytics
    async trackMessage(message) {
        if (!message.guild || message.author.bot) return;
        
        const guildId = message.guild.id;
        const userId = message.author.id;
        const channelId = message.channel.id;
        const hour = new Date().getHours();
        
        try {
            // Log message activity
            await this.bot.database.run(`
                INSERT INTO message_analytics (
                    guild_id, user_id, channel_id, message_count, 
                    character_count, hour_of_day, date, created_at
                ) VALUES (?, ?, ?, 1, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
                ON CONFLICT(guild_id, user_id, channel_id, date, hour_of_day) 
                DO UPDATE SET 
                    message_count = message_count + 1,
                    character_count = character_count + ?
            `, [
                guildId, userId, channelId, 
                message.content.length, hour, 
                message.content.length
            ]);
            
            // Track in memory for real-time stats
            const key = `${guildId}-${hour}`;
            const current = this.metrics.messages.get(key) || { count: 0, users: new Set() };
            current.count++;
            current.users.add(userId);
            this.metrics.messages.set(key, current);
            
            // Broadcast analytics_update via WebSocket for real-time charts
            this.broadcastAnalyticsUpdate(guildId, 'messages');
            
            // Emit lightweight analytics increment for real-time dashboards
            try {
                if (this.bot.eventEmitter) {
                    await this.bot.eventEmitter.emitAnalytics(guildId, { messagesIncrement: 1, hour });
                }
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to emit analytics event:', e.message || e);
            }
            
        } catch (error) {
            this.bot.logger.error('Error tracking message:', error);
        }
    }

    // Command Analytics
    async trackCommand(interaction) {
        if (!interaction.guild) return;
        
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const commandName = interaction.commandName;
        const subCommand = interaction.options?.getSubcommand?.(false);
        const fullCommand = subCommand ? `${commandName} ${subCommand}` : commandName;
        
        try {
            await this.bot.database.run(`
                INSERT INTO command_analytics (
                    guild_id, user_id, command_name, success, 
                    response_time, date, created_at
                ) VALUES (?, ?, ?, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
            `, [
                guildId, userId, fullCommand, 1, 
                Date.now() - interaction.createdTimestamp
            ]);
            
            // Track popular commands
            const commandKey = `${guildId}-${fullCommand}`;
            const commandCount = this.metrics.commands.get(commandKey) || 0;
            this.metrics.commands.set(commandKey, commandCount + 1);
            // Emit command usage event for real-time dashboards
            try {
                if (this.bot.eventEmitter) await this.bot.eventEmitter.emitCommandUsed(guildId, fullCommand, userId);
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to emit command event:', e.message || e);
            }
            
        } catch (error) {
            this.bot.logger.error('Error tracking command:', error);
        }
    }

    // Member Join Analytics
    async trackMemberJoin(member) {
        const guildId = member.guild.id;
        const userId = member.user.id;
        const accountAge = Date.now() - member.user.createdTimestamp;
        const inviteCode = await this.getUsedInvite(member);
        
        try {
            await this.bot.database.run(`
                INSERT INTO join_analytics (
                    guild_id, user_id, account_age_days, 
                    invite_code, date, created_at
                ) VALUES (?, ?, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
            `, [
                guildId, userId, 
                Math.floor(accountAge / (1000 * 60 * 60 * 24)),
                inviteCode
            ]);
            
            // Track hourly joins
            const hour = new Date().getHours();
            const key = `${guildId}-${hour}`;
            const current = this.metrics.joins.get(key) || 0;
            this.metrics.joins.set(key, current + 1);
            
            // Broadcast analytics_update via WebSocket for real-time charts
            this.broadcastAnalyticsUpdate(guildId, 'joins');
            
            // Emit join analytics event
            try {
                if (this.bot.eventEmitter) await this.bot.eventEmitter.emitMemberJoin(guildId, member);
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to emit member join event:', e.message || e);
            }
            
        } catch (error) {
            this.bot.logger.error('Error tracking member join:', error);
        }
    }

    // Member Leave Analytics
    async trackMemberLeave(member) {
        const guildId = member.guild.id;
        const userId = member.user.id;
        const stayDuration = Date.now() - member.joinedTimestamp;
        
        try {
            await this.bot.database.run(`
                INSERT INTO leave_analytics (
                    guild_id, user_id, stay_duration_hours, 
                    date, created_at
                ) VALUES (?, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
            `, [
                guildId, userId, 
                Math.floor(stayDuration / (1000 * 60 * 60))
            ]);
            
            // Track hourly leaves
            const hour = new Date().getHours();
            const key = `${guildId}-${hour}`;
            const current = this.metrics.leaves.get(key) || 0;
            this.metrics.leaves.set(key, current + 1);
            
            // Broadcast analytics_update via WebSocket for real-time charts
            this.broadcastAnalyticsUpdate(guildId, 'leaves');
            
            // Emit leave analytics event
            try {
                if (this.bot.eventEmitter) await this.bot.eventEmitter.emitMemberLeave(guildId, member, 'left');
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('Failed to emit member leave event:', e.message || e);
            }
            
        } catch (error) {
            this.bot.logger.error('Error tracking member leave:', error);
        }
    }

    // Reaction Analytics
    async trackReaction(reaction, user, type = 'add') {
        if (!reaction.message.guild || user.bot) return;
        
        const guildId = reaction.message.guild.id;
        const userId = user.id;
        const channelId = reaction.message.channel.id;
        const emoji = reaction.emoji.name;
        const messageId = reaction.message.id;
        
        try {
            await this.bot.database.run(`
                INSERT INTO reaction_analytics (
                    guild_id, user_id, channel_id, message_id,
                    emoji, reaction_type, date, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
            `, [
                guildId, userId, channelId, messageId,
                emoji, type
            ]);
            
        } catch (error) {
            this.bot.logger.error('Error tracking reaction:', error);
        }
    }

    // Voice Analytics
    async trackVoiceActivity(oldState, newState) {
        if (!newState.guild) return;
        
        const guildId = newState.guild.id;
        const userId = newState.id;
        
        try {
            if (!oldState.channel && newState.channel) {
                // User joined voice
                await this.bot.database.run(`
                    INSERT INTO voice_analytics (
                        guild_id, user_id, channel_id, action,
                        date, created_at
                    ) VALUES (?, ?, ?, 'join', DATE('now'), CURRENT_TIMESTAMP)
                `, [guildId, userId, newState.channel.id]);
                
            } else if (oldState.channel && !newState.channel) {
                // User left voice
                await this.bot.database.run(`
                    INSERT INTO voice_analytics (
                        guild_id, user_id, channel_id, action,
                        date, created_at
                    ) VALUES (?, ?, ?, 'leave', DATE('now'), CURRENT_TIMESTAMP)
                `, [guildId, userId, oldState.channel.id]);
            }
        } catch (error) {
            this.bot.logger.error('Error tracking voice activity:', error);
        }
    }

    // Bot Performance Metrics
    async trackBotMetrics() {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = process.uptime();
        
        try {
            // Safely compute guild and user counts even if client not ready
            const guildsCache = this.bot?.client?.guilds?.cache;
            const guildCount = guildsCache?.size || 0;
            const userCount = guildsCache
                ? Array.from(guildsCache.values()).reduce((acc, guild) => acc + (guild.memberCount || 0), 0)
                : 0;

            await this.bot.database.run(`
                INSERT INTO bot_metrics (
                    memory_used_mb, memory_total_mb, cpu_usage,
                    uptime_seconds, guild_count, user_count,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                Math.round(memoryUsage.heapUsed / 1024 / 1024),
                Math.round(memoryUsage.heapTotal / 1024 / 1024),
                (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
                uptime,
                guildCount,
                userCount
            ]);
        } catch (error) {
            this.bot.logger.error('Error tracking bot metrics:', error);
        }
    }

    // Get Analytics Data
    async getMessageAnalytics(guildId, timeframe = '24h') {
        const hours = this.getHoursFromTimeframe(timeframe);
        
        try {
            const data = await this.bot.database.all(`
                SELECT 
                    hour_of_day,
                    SUM(message_count) as total_messages,
                    COUNT(DISTINCT user_id) as active_users,
                    SUM(character_count) as total_characters
                FROM message_analytics 
                WHERE guild_id = ? 
                AND created_at > datetime('now', '-${hours} hours')
                GROUP BY hour_of_day
                ORDER BY hour_of_day
            `, [guildId]);
            
            // Fill missing hours with zeros
            const result = Array(24).fill(null).map((_, i) => {
                const existing = data.find(d => d.hour_of_day === i);
                return {
                    hour: i,
                    messages: existing?.total_messages || 0,
                    users: existing?.active_users || 0,
                    characters: existing?.total_characters || 0
                };
            });
            
            return result;
        } catch (error) {
            this.bot.logger.error('Error getting message analytics:', error);
            return [];
        }
    }

    async getCommandAnalytics(guildId, timeframe = '7d') {
        const hours = this.getHoursFromTimeframe(timeframe);
        
        try {
            const data = await this.bot.database.all(`
                SELECT 
                    command_name,
                    COUNT(*) as usage_count,
                    AVG(response_time) as avg_response_time,
                    SUM(success) as success_count
                FROM command_analytics 
                WHERE guild_id = ? 
                AND created_at > datetime('now', '-${hours} hours')
                GROUP BY command_name
                ORDER BY usage_count DESC
                LIMIT 10
            `, [guildId]);
            
            return data.map(cmd => ({
                command: cmd.command_name,
                uses: cmd.usage_count,
                avgResponseTime: Math.round(cmd.avg_response_time),
                successRate: cmd.success_count / cmd.usage_count
            }));
        } catch (error) {
            this.bot.logger.error('Error getting command analytics:', error);
            return [];
        }
    }

    async getMemberAnalytics(guildId, timeframe = '7d') {
        const hours = this.getHoursFromTimeframe(timeframe);
        
        try {
            const joinData = await this.bot.database.all(`
                SELECT DATE(created_at) as date, COUNT(*) as joins
                FROM join_analytics 
                WHERE guild_id = ? 
                AND created_at > datetime('now', '-${hours} hours')
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `, [guildId]);
            
            const leaveData = await this.bot.database.all(`
                SELECT DATE(created_at) as date, COUNT(*) as leaves
                FROM leave_analytics 
                WHERE guild_id = ? 
                AND created_at > datetime('now', '-${hours} hours')
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `, [guildId]);
            
            // Combine join and leave data
            const dates = [...new Set([
                ...joinData.map(d => d.date),
                ...leaveData.map(d => d.date)
            ])].sort();
            
            return dates.map(date => ({
                date,
                joins: joinData.find(d => d.date === date)?.joins || 0,
                leaves: leaveData.find(d => d.date === date)?.leaves || 0,
                net: (joinData.find(d => d.date === date)?.joins || 0) - 
                     (leaveData.find(d => d.date === date)?.leaves || 0)
            }));
        } catch (error) {
            this.bot.logger.error('Error getting member analytics:', error);
            return [];
        }
    }

    async getTopUsers(guildId, metric = 'messages', timeframe = '7d', limit = 10) {
        const hours = this.getHoursFromTimeframe(timeframe);
        
        try {
            let query = '';
            switch (metric) {
                case 'messages':
                    query = `
                        SELECT user_id, SUM(message_count) as value
                        FROM message_analytics 
                        WHERE guild_id = ? AND created_at > datetime('now', '-${hours} hours')
                        GROUP BY user_id ORDER BY value DESC LIMIT ?
                    `;
                    break;
                case 'commands':
                    query = `
                        SELECT user_id, COUNT(*) as value
                        FROM command_analytics 
                        WHERE guild_id = ? AND created_at > datetime('now', '-${hours} hours')
                        GROUP BY user_id ORDER BY value DESC LIMIT ?
                    `;
                    break;
                case 'reactions':
                    query = `
                        SELECT user_id, COUNT(*) as value
                        FROM reaction_analytics 
                        WHERE guild_id = ? AND created_at > datetime('now', '-${hours} hours')
                        GROUP BY user_id ORDER BY value DESC LIMIT ?
                    `;
                    break;
            }
            
            const data = await this.bot.database.all(query, [guildId, limit]);
            return data;
        } catch (error) {
            this.bot.logger.error('Error getting top users:', error);
            return [];
        }
    }

    async getBotHealthMetrics() {
        try {
            const latest = await this.bot.database.get(`
                SELECT * FROM bot_metrics 
                ORDER BY created_at DESC LIMIT 1
            `);
            
            const hourlyData = await this.bot.database.all(`
                SELECT 
                    strftime('%H', created_at) as hour,
                    AVG(memory_used_mb) as avg_memory,
                    AVG(cpu_usage) as avg_cpu
                FROM bot_metrics 
                WHERE created_at > datetime('now', '-24 hours')
                GROUP BY strftime('%H', created_at)
                ORDER BY hour
            `);
            
            return {
                current: latest,
                hourly: hourlyData
            };
        } catch (error) {
            this.bot.logger.error('Error getting bot health metrics:', error);
            return null;
        }
    }

    // Helper Methods
    getHoursFromTimeframe(timeframe) {
        switch (timeframe) {
            case '1h': return 1;
            case '6h': return 6;
            case '24h': return 24;
            case '7d': return 168;
            case '30d': return 720;
            default: return 24;
        }
    }

    async getUsedInvite(member) {
        try {
            const invites = await member.guild.invites.fetch();
            // This is a simplified approach - in reality, you'd need to track invite usage
            return invites.first()?.code || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    // Generate Analytics Report
    async generateReport(guildId, timeframe = '7d') {
        try {
            const [
                messageStats,
                commandStats,
                memberStats,
                topUsers
            ] = await Promise.all([
                this.getMessageAnalytics(guildId, timeframe),
                this.getCommandAnalytics(guildId, timeframe),
                this.getMemberAnalytics(guildId, timeframe),
                this.getTopUsers(guildId, 'messages', timeframe, 5)
            ]);

            const totalMessages = messageStats.reduce((sum, h) => sum + h.messages, 0);
            const totalUsers = Math.max(...messageStats.map(h => h.users));
            const totalCommands = commandStats.reduce((sum, c) => sum + c.uses, 0);

            const embed = new EmbedBuilder()
                .setTitle(`📊 Analytics Report - ${timeframe.toUpperCase()}`)
                .setColor(0x00ff00)
                .addFields([
                    { 
                        name: '💬 Messages', 
                        value: `Total: ${totalMessages}\nActive Users: ${totalUsers}`, 
                        inline: true 
                    },
                    { 
                        name: '⚡ Commands', 
                        value: `Total: ${totalCommands}\nUnique: ${commandStats.length}`, 
                        inline: true 
                    },
                    { 
                        name: '👥 Members', 
                        value: `Joins: ${memberStats.reduce((s, d) => s + d.joins, 0)}\nLeaves: ${memberStats.reduce((s, d) => s + d.leaves, 0)}`, 
                        inline: true 
                    }
                ])
                .setTimestamp();

            if (topUsers.length > 0) {
                const topUsersList = topUsers.map((user, i) => 
                    `${i + 1}. <@${user.user_id}> - ${user.value} messages`
                ).join('\n');
                
                embed.addFields([
                    { name: '🏆 Top Active Users', value: topUsersList, inline: false }
                ]);
            }

            if (commandStats.length > 0) {
                const topCommands = commandStats.slice(0, 5).map((cmd, i) => 
                    `${i + 1}. \`${cmd.command}\` - ${cmd.uses} uses`
                ).join('\n');
                
                embed.addFields([
                    { name: '📈 Top Commands', value: topCommands, inline: false }
                ]);
            }

            return embed;
        } catch (error) {
            this.bot.logger.error('Error generating analytics report:', error);
            return null;
        }
    }

    // Cleanup old data
    startCleanupInterval() {
        setInterval(() => {
            this.cleanup();
            this.trackBotMetrics();
        }, 300000); // Every 5 minutes
    }

    cleanup() {
        const now = Date.now();
        const maxAge = 3600000; // 1 hour
        
        // Clean up in-memory metrics
        for (const [key, data] of this.metrics.messages.entries()) {
            // Keep recent data for real-time stats
            if (typeof data === 'object' && data.timestamp && now - data.timestamp > maxAge) {
                this.metrics.messages.delete(key);
            }
        }
    }

    // Export data for external analysis
    async exportData(guildId, timeframe = '30d', format = 'json') {
        const hours = this.getHoursFromTimeframe(timeframe);
        
        try {
            const data = {
                messages: await this.getMessageAnalytics(guildId, timeframe),
                commands: await this.getCommandAnalytics(guildId, timeframe),
                members: await this.getMemberAnalytics(guildId, timeframe),
                topUsers: await this.getTopUsers(guildId, 'messages', timeframe, 50),
                exported: new Date().toISOString(),
                timeframe
            };
            
            if (format === 'csv') {
                // Convert to CSV format
                return this.convertToCSV(data);
            }
            
            return JSON.stringify(data, null, 2);
        } catch (error) {
            this.bot.logger.error('Error exporting analytics data:', error);
            return null;
        }
    }

    convertToCSV(data) {
        let csv = '';
        
        // Messages CSV
        csv += 'Messages by Hour\n';
        csv += 'Hour,Messages,Users,Characters\n';
        data.messages.forEach(h => {
            csv += `${h.hour},${h.messages},${h.users},${h.characters}\n`;
        });
        
        csv += '\nTop Commands\n';
        csv += 'Command,Uses,Avg Response Time,Success Rate\n';
        data.commands.forEach(c => {
            csv += `${c.command},${c.uses},${c.avgResponseTime},${c.successRate}\n`;
        });
        
        return csv;
    }

    /**
     * Track moderation action and broadcast via WebSocket
     * @param {string} guildId - The guild ID
     * @param {string} actionType - 'timeout', 'ban', 'kick', 'warn'
     */
    trackModerationAction(guildId, actionType) {
        try {
            const type = (actionType || '').toLowerCase();
            let counterKey = null;
            
            if (type.includes('timeout') || type.includes('mute')) {
                counterKey = 'timeouts';
            } else if (type.includes('ban')) {
                counterKey = 'bans';
            } else if (type.includes('kick')) {
                counterKey = 'kicks';
            }
            
            if (counterKey) {
                this.broadcastAnalyticsUpdate(guildId, counterKey);
            }
        } catch (e) {
            this.bot.logger?.debug && this.bot.logger.debug('Failed to track mod action:', e.message);
        }
    }

    /**
     * Track spam detection event and broadcast via WebSocket
     * @param {string} guildId - The guild ID
     */
    trackSpamEvent(guildId) {
        try {
            this.broadcastAnalyticsUpdate(guildId, 'spamEvents');
        } catch (e) {
            this.bot.logger?.debug && this.bot.logger.debug('Failed to track spam event:', e.message);
        }
    }

    /**
     * Reset live counters (call hourly or when needed)
     */
    resetLiveCounters(guildId = null) {
        if (guildId) {
            this.liveCounters.delete(guildId);
        } else {
            this.liveCounters.clear();
        }
    }
}

module.exports = AnalyticsManager;