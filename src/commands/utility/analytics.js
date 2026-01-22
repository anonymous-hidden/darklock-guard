const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('analytics')
        .setDescription('View detailed server analytics and statistics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('overview')
                .setDescription('View general analytics overview'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('messages')
                .setDescription('View message activity statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('members')
                .setDescription('View member activity statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('commands')
                .setDescription('View command usage statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('export')
                .setDescription('Export analytics data')
                .addStringOption(option =>
                    option.setName('format')
                        .setDescription('Export format')
                        .setRequired(true)
                        .addChoices(
                            { name: 'JSON', value: 'json' },
                            { name: 'CSV', value: 'csv' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('report')
                .setDescription('Generate a detailed analytics report')
                .addStringOption(option =>
                    option.setName('period')
                        .setDescription('Time period for the report')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Last 24 Hours', value: '24h' },
                            { name: 'Last 7 Days', value: '7d' },
                            { name: 'Last 30 Days', value: '30d' }
                        ))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        
        if (!bot.analyticsManager) {
            return await interaction.reply({
                content: '❌ Analytics system is not available.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'overview':
                await this.showOverview(interaction, bot);
                break;
            
            case 'messages':
                await this.showMessageStats(interaction, bot);
                break;
            
            case 'members':
                await this.showMemberStats(interaction, bot);
                break;
            
            case 'commands':
                await this.showCommandStats(interaction, bot);
                break;
            
            case 'export':
                await this.exportData(interaction, bot);
                break;
            
            case 'report':
                await this.generateReport(interaction, bot);
                break;
        }
    },

    async showOverview(interaction, bot) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;

            // Pull data using the AnalyticsManager helpers
            const [messageByHour, commandStats, memberByDay] = await Promise.all([
                bot.analyticsManager.getMessageAnalytics(guildId, '7d'),
                bot.analyticsManager.getCommandAnalytics(guildId, '7d'),
                bot.analyticsManager.getMemberAnalytics(guildId, '7d')
            ]);

            const totalMessages = messageByHour.reduce((sum, h) => sum + (h.messages || 0), 0);
            const avgPerDay = totalMessages / 7;
            const activeUsers = Math.max(0, ...messageByHour.map(h => h.users || 0));
            const commandsUsed = commandStats.reduce((sum, c) => sum + (c.uses || 0), 0);
            const joins = memberByDay.reduce((s, d) => s + (d.joins || 0), 0);
            const leaves = memberByDay.reduce((s, d) => s + (d.leaves || 0), 0);

            // Top channels by message count (from message_analytics)
            const topChannels = await bot.database.all(`
                SELECT channel_id, SUM(message_count) as message_count
                FROM message_analytics
                WHERE guild_id = ? AND created_at > datetime('now', '-168 hours')
                GROUP BY channel_id
                ORDER BY message_count DESC
                LIMIT 5
            `, [guildId]);

            const embed = new EmbedBuilder()
                .setTitle('📊 Analytics Overview')
                .setDescription('Comprehensive server statistics for the last 7 days')
                .addFields([
                    { name: '📨 Total Messages', value: totalMessages.toLocaleString(), inline: true },
                    { name: '📈 Avg Messages/Day', value: Math.round(avgPerDay).toString(), inline: true },
                    { name: '👥 Active Users (peak hour)', value: activeUsers.toString(), inline: true },
                    { name: '🎯 Commands Used', value: commandsUsed.toLocaleString(), inline: true },
                    { name: '➕ New Members', value: joins.toString(), inline: true },
                    { name: '➖ Left Members', value: leaves.toString(), inline: true }
                ])
                .setColor(0x00aa00)
                .setTimestamp();

            if (topChannels?.length) {
                const channelList = topChannels.map((ch, i) => `${i + 1}. <#${ch.channel_id}> - ${ch.message_count} messages`).join('\n');
                embed.addFields({ name: '🏆 Most Active Channels', value: channelList, inline: false });
            }

            if (commandStats?.length) {
                const topCmds = commandStats.slice(0, 5).map((cmd, i) => `${i + 1}. \`${cmd.command}\` - ${cmd.uses} uses`).join('\n');
                embed.addFields({ name: '⚡ Most Used Commands', value: topCmds, inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing analytics overview:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve analytics data.' });
        }
    },

    async showMessageStats(interaction, bot) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            // Aggregate from schema (message_count, character_count, hour_of_day, created_at)
            const totals = await bot.database.get(`
                SELECT 
                    SUM(message_count) as total_messages,
                    COUNT(DISTINCT user_id) as unique_users,
                    SUM(character_count) as total_characters
                FROM message_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-168 hours')
            `, [guildId]);

            const hourlyData = await bot.database.all(`
                SELECT hour_of_day as hour, SUM(message_count) as count
                FROM message_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-168 hours')
                GROUP BY hour_of_day 
                ORDER BY hour
            `, [guildId]);

            const embed = new EmbedBuilder()
                .setTitle('📨 Message Statistics')
                .setDescription('Detailed message activity for the last 7 days')
                .addFields([
                    { name: 'Total Messages', value: (totals.total_messages || 0).toLocaleString(), inline: true },
                    { name: 'Unique Users', value: (totals.unique_users || 0).toString(), inline: true },
                    { name: 'Avg Message Length', value: (totals.total_messages ? Math.round((totals.total_characters || 0) / totals.total_messages) : 0) + ' chars', inline: true }
                ])
                .setColor(0x3498db)
                .setTimestamp();

            if (hourlyData.length > 0) {
                const hourlyChart = hourlyData.map(h => `${h.hour}:00 - ${h.count} msgs`).join('\n');
                embed.addFields({ name: '📊 Hourly Distribution', value: '```\n' + hourlyChart + '\n```', inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing message stats:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve message statistics.' });
        }
    },

    async showMemberStats(interaction, bot) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            const joins = await bot.database.get(`
                SELECT COUNT(*) as count FROM join_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-7 days')
            `, [guildId]);

            const leaves = await bot.database.get(`
                SELECT COUNT(*) as count FROM leave_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-7 days')
            `, [guildId]);

            const activeUsers = await bot.database.get(`
                SELECT COUNT(DISTINCT user_id) as count FROM message_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-24 hours')
            `, [guildId]);

            const embed = new EmbedBuilder()
                .setTitle('👥 Member Statistics')
                .setDescription('Member activity for the last 7 days')
                .addFields([
                    { name: '➕ New Members', value: (joins.count || 0).toString(), inline: true },
                    { name: '➖ Members Left', value: (leaves.count || 0).toString(), inline: true },
                    { name: '📊 Net Growth', value: ((joins.count || 0) - (leaves.count || 0)).toString(), inline: true },
                    { name: '🔥 Active Today', value: (activeUsers.count || 0).toString(), inline: true },
                    { name: '📈 Current Total', value: interaction.guild.memberCount.toString(), inline: true }
                ])
                .setColor(0xe74c3c)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing member stats:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve member statistics.' });
        }
    },

    async showCommandStats(interaction, bot) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            const topCommands = await bot.database.all(`
                SELECT command_name, COUNT(*) as usage_count 
                FROM command_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-168 hours')
                GROUP BY command_name 
                ORDER BY usage_count DESC 
                LIMIT 10
            `, [guildId]);

            const totalCommands = await bot.database.get(`
                SELECT COUNT(*) as total FROM command_analytics 
                WHERE guild_id = ? AND created_at > datetime('now', '-168 hours')
            `, [guildId]);

            const embed = new EmbedBuilder()
                .setTitle('⚡ Command Usage Statistics')
                .setDescription('Command activity for the last 7 days')
                .addFields([
                    { name: 'Total Commands', value: (totalCommands.total || 0).toLocaleString(), inline: true },
                    { name: 'Unique Commands', value: topCommands.length.toString(), inline: true }
                ])
                .setColor(0x9b59b6);

            if (topCommands.length > 0) {
                const commandList = topCommands.map((cmd, i) => 
                    `${i + 1}. \`${cmd.command_name}\` - ${cmd.usage_count} uses`
                ).join('\n');
                embed.addFields({ name: '🏆 Top Commands', value: commandList, inline: false });
            } else {
                embed.addFields({ name: '📋 Commands', value: 'No command data available yet.', inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error showing command stats:', error);
            await interaction.editReply({ content: '❌ Failed to retrieve command statistics.' });
        }
    },

    async exportData(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const format = interaction.options.getString('format');

        try {
            // Pass timeframe explicitly and honor requested format
            const data = await bot.analyticsManager.exportData(interaction.guild.id, '30d', format);
            
            const Buffer = require('buffer').Buffer;
            const filename = `analytics_${interaction.guild.id}_${Date.now()}.${format}`;
            const attachment = {
                attachment: Buffer.from(data, 'utf8'),
                name: filename
            };

            await interaction.editReply({
                content: `✅ Analytics data exported successfully!`,
                files: [attachment]
            });
        } catch (error) {
            bot.logger.error('Error exporting analytics:', error);
            await interaction.editReply({ content: '❌ Failed to export analytics data.' });
        }
    },

    async generateReport(interaction, bot) {
        await interaction.deferReply();

        const period = interaction.options.getString('period');

        try {
            const [messageByHour, commandStats, memberByDay] = await Promise.all([
                bot.analyticsManager.getMessageAnalytics(interaction.guild.id, period),
                bot.analyticsManager.getCommandAnalytics(interaction.guild.id, period),
                bot.analyticsManager.getMemberAnalytics(interaction.guild.id, period)
            ]);

            const totalMessages = messageByHour.reduce((sum, h) => sum + (h.messages || 0), 0);
            const avgPerDay = period === '24h' ? totalMessages : Math.round(totalMessages / (period === '7d' ? 7 : 30));
            const activeUsers = Math.max(0, ...messageByHour.map(h => h.users || 0));
            const totalCommands = commandStats.reduce((sum, c) => sum + (c.uses || 0), 0);
            const uniqueCommands = commandStats.length;
            const joins = memberByDay.reduce((s, d) => s + (d.joins || 0), 0);
            const leaves = memberByDay.reduce((s, d) => s + (d.leaves || 0), 0);

            const embed = new EmbedBuilder()
                .setTitle(`📋 Analytics Report - ${period}`)
                .setDescription(`Comprehensive analytics report for ${interaction.guild.name}`)
                .addFields([
                    { name: '📊 Messages', value: `Total: ${totalMessages}\nAvg/Day: ${avgPerDay}`, inline: true },
                    { name: '👥 Members', value: `Joins: ${joins}\nLeaves: ${leaves}\nActive (peak hr): ${activeUsers}`, inline: true },
                    { name: '⚡ Commands', value: `Total: ${totalCommands}\nUnique: ${uniqueCommands}`, inline: true }
                ])
                .setColor(0x00aa00)
                .setTimestamp()
                .setFooter({ text: `Generated for ${interaction.guild.name}` });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            bot.logger.error('Error generating report:', error);
            await interaction.editReply({ content: '❌ Failed to generate analytics report.' });
        }
    }
};
