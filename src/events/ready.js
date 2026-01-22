module.exports = {
    name: 'ready',
    once: true,
    async execute(client, bot) {
        bot.logger.info(`🚀 ${client.user.tag} is now online and ready!`);
        bot.logger.info(`📊 Monitoring ${client.guilds.cache.size} servers`);
        bot.logger.info(`👥 Protecting ${client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)} users`);

        // Set bot presence
        client.user.setPresence({
            activities: [{
                name: `${client.guilds.cache.size} servers | /help`,
                type: 3 // WATCHING
            }],
            status: 'online'
        });

        // Initialize security systems for all guilds
        for (const guild of client.guilds.cache.values()) {
            try {
                // Ensure guild config exists
                await bot.database.getGuildConfig(guild.id);
                
                // Initialize security modules for this guild
                await bot.antiRaid.initializeGuild(guild.id);
                await bot.antiSpam.initializeGuild(guild.id);
                await bot.userVerification.initializeGuild(guild.id);
                
                bot.logger.info(`🛡️  Security systems initialized for ${guild.name} (${guild.id})`);
            } catch (error) {
                bot.logger.error(`Failed to initialize security for guild ${guild.id}:`, error);
            }
        }

        // Cache invites for invite tracking
        if (bot.inviteTracker) {
            try {
                await bot.inviteTracker.cacheAllGuildInvites();
                bot.logger.info('📨 Invite cache initialized for all guilds');
            } catch (error) {
                bot.logger.error('Failed to cache invites:', error);
            }
        }

        // Start periodic tasks
        bot.logger.info('🔄 Starting periodic maintenance tasks...');
        startPeriodicTasks(bot);
        
        bot.logger.info('✅ Bot is fully operational!');
    }
};

function startPeriodicTasks(bot) {
    const cron = require('node-cron');

    // Clean up old logs every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
        try {
            bot.logger.info('🧹 Starting daily cleanup...');
            
            const retentionDays = bot.config.get('logging.retentionDays', 30);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            // Clean old message logs
            await bot.database.run(
                'DELETE FROM message_logs WHERE created_at < ?',
                [cutoffDate.toISOString()]
            );
            
            // Clean old resolved incidents
            await bot.database.run(
                'DELETE FROM security_incidents WHERE resolved = 1 AND resolved_at < ?',
                [cutoffDate.toISOString()]
            );
            
            // Clean expired verification queue entries
            await bot.database.run(
                'DELETE FROM verification_queue WHERE expires_at < ?',
                [new Date().toISOString()]
            );
            
            // Clean expired dashboard sessions
            await bot.database.run(
                'DELETE FROM dashboard_sessions WHERE expires_at < ?',
                [new Date().toISOString()]
            );
            
            bot.logger.info('✅ Daily cleanup completed');
        } catch (error) {
            bot.logger.error('❌ Daily cleanup failed:', error);
        }
    });

    // Update analytics every hour
    cron.schedule('0 * * * *', async () => {
        try {
            bot.logger.debug('📊 Updating analytics...');
            
            for (const guild of bot.client.guilds.cache.values()) {
                const now = new Date();
                const date = now.toISOString().split('T')[0];
                const hour = now.getHours();
                
                // Update member count metric
                await bot.database.run(`
                    INSERT OR REPLACE INTO analytics 
                    (guild_id, metric_type, metric_value, date, hour)
                    VALUES (?, 'member_count', ?, ?, ?)
                `, [guild.id, guild.memberCount, date, hour]);
                
                // Update online member count
                const onlineMembers = guild.members.cache.filter(
                    member => member.presence?.status !== 'offline'
                ).size;
                
                await bot.database.run(`
                    INSERT OR REPLACE INTO analytics 
                    (guild_id, metric_type, metric_value, date, hour)
                    VALUES (?, 'online_members', ?, ?, ?)
                `, [guild.id, onlineMembers, date, hour]);
            }
            
            bot.logger.debug('✅ Analytics updated');
        } catch (error) {
            bot.logger.error('❌ Analytics update failed:', error);
        }
    });

    // Auto-backup every 6 hours if enabled
    if (bot.config.get('backup.autoBackup', false)) {
        cron.schedule('0 */6 * * *', async () => {
            try {
                bot.logger.info('💾 Starting automatic backup...');
                
                for (const guild of bot.client.guilds.cache.values()) {
                    await bot.backupManager.createBackup(guild.id, 'auto');
                }
                
                bot.logger.info('✅ Automatic backup completed');
            } catch (error) {
                bot.logger.error('❌ Automatic backup failed:', error);
            }
        });
    }

    // Update presence every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        try {
            const guildCount = bot.client.guilds.cache.size;
            const userCount = bot.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
            
            const activities = [
                `${guildCount} servers | /help`,
                `${userCount} users | /security`,
                `Security Bot | /dashboard`,
                `Anti-Raid Protection | /config`
            ];
            
            const randomActivity = activities[Math.floor(Math.random() * activities.length)];
            
            bot.client.user.setPresence({
                activities: [{
                    name: randomActivity,
                    type: 3 // WATCHING
                }],
                status: 'online'
            });
        } catch (error) {
            bot.logger.error('❌ Presence update failed:', error);
        }
    });

    // Check for expired moderation actions every minute
    cron.schedule('* * * * *', async () => {
        try {
            const expiredActions = await bot.database.all(`
                SELECT * FROM mod_actions 
                WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?
            `, [new Date().toISOString()]);
            
            for (const action of expiredActions) {
                try {
                    const guild = bot.client.guilds.cache.get(action.guild_id);
                    if (!guild) continue;
                    
                    if (action.action_type === 'TIMEOUT') {
                        const member = await guild.members.fetch(action.target_user_id).catch(() => null);
                        if (member && member.isCommunicationDisabled()) {
                            await member.timeout(null, 'Timeout expired');
                            bot.logger.info(`⏰ Timeout expired for ${member.user.tag} in ${guild.name}`);
                        }
                    }
                    
                    // Mark action as inactive
                    await bot.database.run(
                        'UPDATE mod_actions SET active = 0 WHERE id = ?',
                        [action.id]
                    );
                } catch (error) {
                    bot.logger.error(`Failed to process expired action ${action.id}:`, error);
                }
            }
        } catch (error) {
            bot.logger.error('❌ Expired actions check failed:', error);
        }
    });
}