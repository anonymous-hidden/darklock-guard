const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('security')
        .setDescription('View security logs and threat statistics')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('logs')
                .setDescription('View recent security events')
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of events to show')
                        .setMinValue(5)
                        .setMaxValue(50)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View security statistics')
                .addStringOption(option =>
                    option.setName('period')
                        .setDescription('Time period')
                        .addChoices(
                            { name: 'Last 24 Hours', value: '24h' },
                            { name: 'Last 7 Days', value: '7d' },
                            { name: 'Last 30 Days', value: '30d' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('suspicious')
                .setDescription('View suspicious users'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('threats')
                .setDescription('View detected threats')),

    async execute(interaction) {
        const bot = interaction.client.bot;
        
        if (!bot.securityManager) {
            return await interaction.reply({
                content: '❌ Security system is not available.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'logs':
                await this.showSecurityLogs(interaction, bot);
                break;
            
            case 'stats':
                await this.showSecurityStats(interaction, bot);
                break;
            
            case 'suspicious':
                await this.showSuspiciousUsers(interaction, bot);
                break;
            
            case 'threats':
                await this.showThreats(interaction, bot);
                break;
        }
    },

    async showSecurityLogs(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const limit = interaction.options.getInteger('limit') || 10;
        const guildId = interaction.guild.id;

        try {
            const logs = await bot.database.all(`
                SELECT * FROM security_logs 
                WHERE guild_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [guildId, limit]);

            if (logs.length === 0) {
                return await interaction.editReply({
                    content: '✅ No security events recorded yet. Your server is protected!'
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Recent Security Events')
                .setDescription(`Showing last ${logs.length} security events`)
                .setColor(0xff0000)
                .setTimestamp();

            for (const log of logs.slice(0, 10)) {
                const timestamp = new Date(log.timestamp).toLocaleString();
                const emoji = this.getEventEmoji(log.event_type);
                
                embed.addFields({
                    name: `${emoji} ${log.event_type}`,
                    value: `**User:** <@${log.user_id}>\n**Time:** ${timestamp}\n**Action:** ${log.action_taken || 'None'}`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing security logs:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve security logs.' });
        }
    },

    async showSecurityStats(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const period = interaction.options.getString('period') || '7d';
        const guildId = interaction.guild.id;
        const hours = period === '24h' ? 24 : period === '7d' ? 168 : 720;

        try {
            const stats = await bot.database.all(`
                SELECT 
                    event_type,
                    COUNT(*) as count,
                    COUNT(CASE WHEN action_taken IS NOT NULL THEN 1 END) as actions_taken
                FROM security_logs 
                WHERE guild_id = ? AND timestamp > datetime('now', '-${hours} hours')
                GROUP BY event_type
                ORDER BY count DESC
            `, [guildId]);

            const totalEvents = await bot.database.get(`
                SELECT COUNT(*) as total FROM security_logs 
                WHERE guild_id = ? AND timestamp > datetime('now', '-${hours} hours')
            `, [guildId]);

            const embed = new EmbedBuilder()
                .setTitle('📊 Security Statistics')
                .setDescription(`Security events in the last ${period}`)
                .addFields([
                    { name: 'Total Events', value: (totalEvents.total || 0).toString(), inline: true },
                    { name: 'Event Types', value: stats.length.toString(), inline: true }
                ])
                .setColor(0xff6600)
                .setTimestamp();

            if (stats.length > 0) {
                const eventList = stats.map(s => 
                    `${this.getEventEmoji(s.event_type)} **${s.event_type}**: ${s.count} events (${s.actions_taken} actions)`
                ).join('\n');
                embed.addFields({ name: '🔍 Event Breakdown', value: eventList, inline: false });
            } else {
                embed.addFields({ name: '✅ Status', value: 'No security events in this period!', inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing security stats:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve security statistics.' });
        }
    },

    async showSuspiciousUsers(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;

        try {
            const suspiciousUsers = await bot.database.all(`
                SELECT 
                    user_id,
                    COUNT(*) as event_count,
                    MAX(timestamp) as last_event
                FROM security_logs 
                WHERE guild_id = ? AND timestamp > datetime('now', '-7 days')
                GROUP BY user_id 
                HAVING event_count > 2
                ORDER BY event_count DESC 
                LIMIT 10
            `, [guildId]);

            if (suspiciousUsers.length === 0) {
                return await interaction.editReply({
                    content: '✅ No suspicious users detected in the last 7 days!'
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('⚠️ Suspicious Users')
                .setDescription('Users with multiple security events in the last 7 days')
                .setColor(0xff9900)
                .setTimestamp();

            for (const user of suspiciousUsers) {
                const lastEvent = new Date(user.last_event).toLocaleString();
                embed.addFields({
                    name: `<@${user.user_id}>`,
                    value: `**Events:** ${user.event_count}\n**Last Event:** ${lastEvent}`,
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing suspicious users:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve suspicious users.' });
        }
    },

    async showThreats(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;

        try {
            const threats = await bot.database.all(`
                SELECT * FROM security_logs 
                WHERE guild_id = ? 
                AND severity IN ('high', 'critical')
                AND timestamp > datetime('now', '-7 days')
                ORDER BY timestamp DESC 
                LIMIT 15
            `, [guildId]);

            if (threats.length === 0) {
                return await interaction.editReply({
                    content: '✅ No high-severity threats detected in the last 7 days!'
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🚨 Detected Threats')
                .setDescription(`High-severity security events in the last 7 days`)
                .setColor(0xff0000)
                .setTimestamp();

            for (const threat of threats.slice(0, 10)) {
                const timestamp = new Date(threat.timestamp).toLocaleString();
                const severityEmoji = threat.severity === 'critical' ? '🔴' : '🟠';
                
                embed.addFields({
                    name: `${severityEmoji} ${threat.event_type}`,
                    value: `**User:** <@${threat.user_id}>\n**Time:** ${timestamp}\n**Severity:** ${threat.severity}\n**Action:** ${threat.action_taken || 'Logged'}`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing threats:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve threat information.' });
        }
    },

    getEventEmoji(eventType) {
        const emojiMap = {
            'spam_detected': '🚫',
            'raid_detected': '⚡',
            'phishing_detected': '🎣',
            'suspicious_user': '⚠️',
            'mass_mention': '📢',
            'server_lockdown': '🔒',
            'user_timeout': '⏱️',
            'message_deleted': '🗑️',
            'link_blocked': '🔗'
        };
        return emojiMap[eventType] || '🛡️';
    }
};
