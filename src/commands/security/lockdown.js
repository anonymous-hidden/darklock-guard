const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

// DEPRECATED: Use /admin lockdown instead
module.exports = {
    deprecated: true,
    newCommand: '/admin lockdown',
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('⚠️ MOVED → Use /admin lockdown instead')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Lockdown mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Full - Lock all channels', value: 'full' },
                    { name: 'Soft - Lock public channels only', value: 'soft' },
                    { name: 'Channels - Lock specific channels', value: 'channels' }
                ))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the lockdown')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel1')
                .setDescription('Channel to lock (for channels mode)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel2')
                .setDescription('Additional channel to lock')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel3')
                .setDescription('Additional channel to lock')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel4')
                .setDescription('Additional channel to lock')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel5')
                .setDescription('Additional channel to lock')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('timeout_new_accounts')
                .setDescription('Auto-timeout accounts less than 24h old')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('disable_tickets')
                .setDescription('Disable ticket creation during lockdown')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('slowmode')
                .setDescription('Slowmode seconds (default: 60)')
                .setMinValue(0)
                .setMaxValue(21600)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    async execute(interaction, bot) {
        if (!bot.lockdownManager) {
            return await interaction.reply({
                content: '❌ Lockdown system is not available.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if already in lockdown
            const existing = await bot.lockdownManager.isLocked(interaction.guild.id);
            if (existing) {
                const status = await bot.lockdownManager.getStatus(interaction.guild.id);
                
                const alreadyLockedEmbed = new EmbedBuilder()
                    .setTitle('🔒 Server Already in Lockdown')
                    .setDescription('Server is currently locked down.')
                    .addFields([
                        { name: 'Mode', value: status.mode.toUpperCase(), inline: true },
                        { name: 'Channels Affected', value: status.affectedChannels.toString(), inline: true },
                        { name: 'Reason', value: status.reason, inline: false },
                        { name: 'Activated By', value: status.activatedBy || 'Unknown', inline: true },
                        { name: 'Activated', value: `<t:${Math.floor(new Date(status.activatedAt).getTime() / 1000)}:R>`, inline: true }
                    ])
                    .setColor(0xffa500)
                    .setFooter({ text: 'Use /unlockdown to end lockdown' })
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [alreadyLockedEmbed] });
            }

            // Get parameters
            const mode = interaction.options.getString('mode');
            const reason = interaction.options.getString('reason') || 'Emergency lockdown activated';
            const timeoutNewAccounts = interaction.options.getBoolean('timeout_new_accounts') ?? false;
            const disableTickets = interaction.options.getBoolean('disable_tickets') ?? false;
            const slowmode = interaction.options.getInteger('slowmode') ?? 60;

            // Get channels for 'channels' mode
            let channelIds = [];
            if (mode === 'channels') {
                for (let i = 1; i <= 5; i++) {
                    const channel = interaction.options.getChannel(`channel${i}`);
                    if (channel) channelIds.push(channel.id);
                }

                if (channelIds.length === 0) {
                    return await interaction.editReply({
                        content: '❌ You must select at least one channel for channels mode.',
                        ephemeral: true
                    });
                }
            }

            // Activate lockdown
            const result = await bot.lockdownManager.activate(interaction.guild, {
                mode,
                reason,
                activatedBy: interaction.user.id,
                activatedByTag: interaction.user.tag,
                channelIds,
                settings: {
                    timeoutNewAccounts,
                    disableTickets,
                    slowmode,
                    newAccountHours: 24,
                    notifyJoins: true,
                    applySlowmode: true
                }
            });

            if (!result.success) {
                return await interaction.editReply({
                    content: `❌ Lockdown failed: ${result.error}`,
                    ephemeral: true
                });
            }

            // Build success embed
            const lockdownEmbed = new EmbedBuilder()
                .setTitle('🚨 LOCKDOWN ACTIVATED')
                .setDescription('Emergency lockdown has been activated successfully.')
                .addFields([
                    { name: 'Mode', value: mode.toUpperCase(), inline: true },
                    { name: 'Channels Locked', value: `${result.locked}/${result.locked + result.failed}`, inline: true },
                    { name: 'Activated By', value: interaction.user.toString(), inline: true },
                    { name: 'Reason', value: reason, inline: false }
                ])
                .setColor(0xff0000)
                .setTimestamp();

            // Add actions taken
            const actions = [];
            actions.push('🔒 Channel permissions locked');
            actions.push(`⏱️ Slowmode set to ${slowmode}s`);
            if (timeoutNewAccounts) actions.push('⏰ Auto-timeout new accounts');
            if (disableTickets) actions.push('🎫 Ticket creation disabled');
            
            lockdownEmbed.addFields({ name: 'Actions Taken', value: actions.join('\n'), inline: false });

            if (result.failed > 0) {
                lockdownEmbed.addFields({
                    name: '⚠️ Warnings',
                    value: `Failed to lock ${result.failed} channel(s). Check bot permissions.`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [lockdownEmbed] });

            // Notify in system channel
            const systemChannel = interaction.guild.systemChannel || 
                                interaction.guild.channels.cache.find(c => c.name.includes('general'));
            
            if (systemChannel && systemChannel.permissionsFor(interaction.guild.members.me).has('SendMessages')) {
                const publicEmbed = new EmbedBuilder()
                    .setTitle('🚨 SERVER LOCKDOWN')
                    .setDescription(`This server is temporarily under lockdown.\n\n**Reason:** ${reason}\n\n**Mode:** ${mode.toUpperCase()}`)
                    .setColor(0xff0000)
                    .setFooter({ text: 'Staff can use /unlockdown to restore normal operations' })
                    .setTimestamp();
                
                try {
                    await systemChannel.send({ embeds: [publicEmbed] });
                } catch (error) {
                    bot.logger.warn('[Lockdown] Failed to send public notification:', error);
                }
            }

            // Log security event
            await bot.logger.logSecurityEvent({
                eventType: 'lockdown_activated',
                guildId: interaction.guild.id,
                moderatorId: interaction.user.id,
                moderatorTag: interaction.user.tag,
                reason: reason,
                details: {
                    mode,
                    channelsLocked: result.locked,
                    channelsFailed: result.failed,
                    slowmode,
                    timeoutNewAccounts,
                    disableTickets
                }
            });

            // Send real-time notification to dashboard
            if (bot.dashboard && bot.dashboard.wss) {
                bot.dashboard.broadcastToGuild(interaction.guild.id, {
                    type: 'action',
                    action: {
                        id: Date.now(),
                        type: 'lockdown',
                        category: 'security',
                        target: { id: interaction.guild.id, tag: interaction.guild.name },
                        moderator: { id: interaction.user.id, tag: interaction.user.tag },
                        reason: reason,
                        details: `${mode.toUpperCase()} mode - ${result.locked} channels locked`,
                        canUndo: true,
                        timestamp: Date.now()
                    }
                });
            }

            // Broadcast to dashboard (legacy)
            if (bot.dashboard?.broadcastToGuild) {
                bot.dashboard.broadcastToGuild(interaction.guild.id, {
                    type: 'lockdown_activated',
                    data: {
                        mode,
                        reason,
                        activatedBy: interaction.user.tag,
                        channelsLocked: result.locked
                    }
                });
            }

        } catch (error) {
            bot.logger.error('[Lockdown] Command execution failed:', error);
            
            return await interaction.editReply({
                content: '❌ An error occurred while activating lockdown. Please check bot permissions and try again.',
                ephemeral: true
            });
        }
    }
};