const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicemonitor')
        .setDescription('Configure voice channel monitoring')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up voice monitoring')
                .addChannelOption(option =>
                    option
                        .setName('log_channel')
                        .setDescription('Channel for voice activity logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option
                        .setName('alert_channel')
                        .setDescription('Channel for suspicious activity alerts')
                        .addChannelTypes(ChannelType.GuildText)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription('Configure monitoring options')
                .addBooleanOption(option =>
                    option
                        .setName('track_joins')
                        .setDescription('Track voice channel joins')
                )
                .addBooleanOption(option =>
                    option
                        .setName('track_leaves')
                        .setDescription('Track voice channel leaves')
                )
                .addBooleanOption(option =>
                    option
                        .setName('track_moves')
                        .setDescription('Track voice channel moves')
                )
                .addBooleanOption(option =>
                    option
                        .setName('track_mute_deaf')
                        .setDescription('Track mute/deaf changes')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('detection')
                .setDescription('Configure detection settings')
                .addBooleanOption(option =>
                    option
                        .setName('detect_hopping')
                        .setDescription('Detect channel hopping')
                )
                .addIntegerOption(option =>
                    option
                        .setName('hopping_threshold')
                        .setDescription('Number of moves to trigger hopping alert')
                        .setMinValue(3)
                        .setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option
                        .setName('hopping_timeframe')
                        .setDescription('Timeframe in seconds')
                        .setMinValue(30)
                        .setMaxValue(300)
                )
                .addBooleanOption(option =>
                    option
                        .setName('detect_mass_move')
                        .setDescription('Detect mass member moves')
                )
                .addIntegerOption(option =>
                    option
                        .setName('mass_move_threshold')
                        .setDescription('Number of members for mass move')
                        .setMinValue(3)
                        .setMaxValue(50)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable voice monitoring')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View voice monitoring status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View voice activity statistics')
                .addIntegerOption(option =>
                    option
                        .setName('days')
                        .setDescription('Days of history (default: 7)')
                        .setMinValue(1)
                        .setMaxValue(30)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('userstats')
                .setDescription('View user voice statistics')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to check')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('activity')
                .setDescription('View recent voice activity')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View top voice users')
        ),

    async execute(interaction) {
        const voiceMonitor = interaction.client.voiceMonitor;
        if (!voiceMonitor) {
            return interaction.reply({ content: '❌ Voice monitoring is not available.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                await this.handleSetup(interaction, voiceMonitor);
                break;
            case 'config':
                await this.handleConfig(interaction, voiceMonitor);
                break;
            case 'detection':
                await this.handleDetection(interaction, voiceMonitor);
                break;
            case 'disable':
                await this.handleDisable(interaction, voiceMonitor);
                break;
            case 'status':
                await this.handleStatus(interaction, voiceMonitor);
                break;
            case 'stats':
                await this.handleStats(interaction, voiceMonitor);
                break;
            case 'userstats':
                await this.handleUserStats(interaction, voiceMonitor);
                break;
            case 'activity':
                await this.handleActivity(interaction, voiceMonitor);
                break;
            case 'leaderboard':
                await this.handleLeaderboard(interaction, voiceMonitor);
                break;
        }
    },

    async handleSetup(interaction, voiceMonitor) {
        const logChannel = interaction.options.getChannel('log_channel');
        const alertChannel = interaction.options.getChannel('alert_channel');

        await voiceMonitor.setup(interaction.guildId, {
            logChannelId: logChannel.id,
            alertChannelId: alertChannel?.id
        });

        const embed = new EmbedBuilder()
            .setTitle('🎤 Voice Monitoring Enabled')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Log Channel', value: `<#${logChannel.id}>`, inline: true }
            );

        if (alertChannel) {
            embed.addFields({ name: 'Alert Channel', value: `<#${alertChannel.id}>`, inline: true });
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleConfig(interaction, voiceMonitor) {
        const trackJoins = interaction.options.getBoolean('track_joins');
        const trackLeaves = interaction.options.getBoolean('track_leaves');
        const trackMoves = interaction.options.getBoolean('track_moves');
        const trackMuteDeaf = interaction.options.getBoolean('track_mute_deaf');

        const updates = {};
        if (trackJoins !== null) updates.track_joins = trackJoins;
        if (trackLeaves !== null) updates.track_leaves = trackLeaves;
        if (trackMoves !== null) updates.track_moves = trackMoves;
        if (trackMuteDeaf !== null) updates.track_mute_deaf = trackMuteDeaf;

        if (Object.keys(updates).length === 0) {
            return interaction.reply({ content: '❌ Please provide at least one option.', ephemeral: true });
        }

        await voiceMonitor.updateConfig(interaction.guildId, updates);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Voice Monitoring Config Updated')
            .setColor(0x00FF00);

        const fields = [];
        if (trackJoins !== null) fields.push({ name: 'Track Joins', value: trackJoins ? '✅' : '❌', inline: true });
        if (trackLeaves !== null) fields.push({ name: 'Track Leaves', value: trackLeaves ? '✅' : '❌', inline: true });
        if (trackMoves !== null) fields.push({ name: 'Track Moves', value: trackMoves ? '✅' : '❌', inline: true });
        if (trackMuteDeaf !== null) fields.push({ name: 'Track Mute/Deaf', value: trackMuteDeaf ? '✅' : '❌', inline: true });

        embed.addFields(fields);
        await interaction.reply({ embeds: [embed] });
    },

    async handleDetection(interaction, voiceMonitor) {
        const detectHopping = interaction.options.getBoolean('detect_hopping');
        const hoppingThreshold = interaction.options.getInteger('hopping_threshold');
        const hoppingTimeframe = interaction.options.getInteger('hopping_timeframe');
        const detectMassMove = interaction.options.getBoolean('detect_mass_move');
        const massMoveThreshold = interaction.options.getInteger('mass_move_threshold');

        const updates = {};
        if (detectHopping !== null) updates.detect_hopping = detectHopping;
        if (hoppingThreshold !== null) updates.hopping_threshold = hoppingThreshold;
        if (hoppingTimeframe !== null) updates.hopping_timeframe = hoppingTimeframe;
        if (detectMassMove !== null) updates.detect_mass_move = detectMassMove;
        if (massMoveThreshold !== null) updates.mass_move_threshold = massMoveThreshold;

        if (Object.keys(updates).length === 0) {
            return interaction.reply({ content: '❌ Please provide at least one option.', ephemeral: true });
        }

        await voiceMonitor.updateConfig(interaction.guildId, updates);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Detection Settings Updated')
            .setColor(0x00FF00);

        const fields = [];
        if (detectHopping !== null) fields.push({ name: 'Detect Hopping', value: detectHopping ? '✅' : '❌', inline: true });
        if (hoppingThreshold !== null) fields.push({ name: 'Hopping Threshold', value: `${hoppingThreshold} moves`, inline: true });
        if (hoppingTimeframe !== null) fields.push({ name: 'Hopping Timeframe', value: `${hoppingTimeframe}s`, inline: true });
        if (detectMassMove !== null) fields.push({ name: 'Detect Mass Move', value: detectMassMove ? '✅' : '❌', inline: true });
        if (massMoveThreshold !== null) fields.push({ name: 'Mass Move Threshold', value: `${massMoveThreshold} members`, inline: true });

        embed.addFields(fields);
        await interaction.reply({ embeds: [embed] });
    },

    async handleDisable(interaction, voiceMonitor) {
        await voiceMonitor.updateConfig(interaction.guildId, { enabled: 0 });
        await interaction.reply({ content: '✅ Voice monitoring has been disabled.' });
    },

    async handleStatus(interaction, voiceMonitor) {
        const config = await voiceMonitor.getConfig(interaction.guildId);

        if (!config) {
            return interaction.reply({ 
                content: '❌ Voice monitoring is not configured. Use `/voicemonitor setup` to enable.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎤 Voice Monitoring Status')
            .setColor(config.enabled ? 0x00FF00 : 0xFF0000)
            .addFields(
                { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true },
                { name: 'Alert Channel', value: config.alert_channel_id ? `<#${config.alert_channel_id}>` : 'Not set', inline: true },
                { name: 'Track Joins', value: config.track_joins ? '✅' : '❌', inline: true },
                { name: 'Track Leaves', value: config.track_leaves ? '✅' : '❌', inline: true },
                { name: 'Track Moves', value: config.track_moves ? '✅' : '❌', inline: true },
                { name: 'Track Mute/Deaf', value: config.track_mute_deaf ? '✅' : '❌', inline: true },
                { name: 'Detect Hopping', value: config.detect_hopping ? '✅' : '❌', inline: true },
                { name: 'Hopping Threshold', value: `${config.hopping_threshold} in ${config.hopping_timeframe}s`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async handleStats(interaction, voiceMonitor) {
        const days = interaction.options.getInteger('days') || 7;
        const stats = await voiceMonitor.getGuildStats(interaction.guildId, days);

        const embed = new EmbedBuilder()
            .setTitle('📊 Voice Activity Statistics')
            .setColor(0x00BFFF)
            .addFields(
                { name: 'Unique Users', value: `${stats.unique_users || 0}`, inline: true },
                { name: 'Total Events', value: `${stats.total_events || 0}`, inline: true },
                { name: 'Joins', value: `${stats.joins || 0}`, inline: true },
                { name: 'Leaves', value: `${stats.leaves || 0}`, inline: true },
                { name: 'Moves', value: `${stats.moves || 0}`, inline: true }
            )
            .setFooter({ text: `Last ${days} days` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async handleUserStats(interaction, voiceMonitor) {
        const user = interaction.options.getUser('user');
        const stats = await voiceMonitor.getUserStats(interaction.guildId, user.id);

        const embed = new EmbedBuilder()
            .setTitle(`🎤 Voice Stats for ${user.tag}`)
            .setColor(0x00BFFF)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Total Sessions', value: `${stats.total_sessions || 0}`, inline: true },
                { name: 'Total Time', value: this.formatDuration(stats.total_duration || 0), inline: true },
                { name: 'Average Session', value: this.formatDuration(Math.round(stats.avg_duration || 0)), inline: true },
                { name: 'Longest Session', value: this.formatDuration(stats.longest_session || 0), inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async handleActivity(interaction, voiceMonitor) {
        const activity = await voiceMonitor.getRecentActivity(interaction.guildId, 15);

        if (activity.length === 0) {
            return interaction.reply({ content: '📋 No recent voice activity.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎤 Recent Voice Activity')
            .setColor(0x00BFFF);

        const icons = { join: '🟢', leave: '🔴', move: '🔄' };
        const description = activity.map(a => {
            const time = new Date(a.created_at).toLocaleTimeString();
            const icon = icons[a.event_type] || '🎤';
            return `${icon} <@${a.user_id}> - ${a.event_type} *${time}*`;
        }).join('\n');

        embed.setDescription(description.slice(0, 4000));
        embed.setFooter({ text: `${activity.length} events` });

        await interaction.reply({ embeds: [embed] });
    },

    async handleLeaderboard(interaction, voiceMonitor) {
        const topUsers = await voiceMonitor.getTopVoiceUsers(interaction.guildId, 10);

        if (topUsers.length === 0) {
            return interaction.reply({ content: '📋 No voice data available.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 Voice Activity Leaderboard')
            .setColor(0xFFD700);

        const description = topUsers.map((u, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            return `${medal} <@${u.user_id}> - ${this.formatDuration(u.total_time)} (${u.session_count} sessions)`;
        }).join('\n');

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
    },

    formatDuration(seconds) {
        if (!seconds) return '0s';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }
};
