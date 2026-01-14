const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a channel to prevent members from sending messages')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to lock (defaults to current channel)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for locking the channel')
                .setRequired(false)),

    async execute(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false
            });

            await interaction.editReply({
                content: `🔒 Locked ${channel}\n**Reason:** ${reason}`,
                ephemeral: true
            });

            // Send a message in the locked channel
            await channel.send({
                content: `🔒 **Channel Locked**\nThis channel has been locked by ${interaction.user}\n**Reason:** ${reason}`
            });

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[LOCK] #${channel.name} by ${interaction.user.tag}`);
            }
            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'channel_lock',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: channel.id, name: channel.name, type: 'channel' },
                    reason: reason,
                    canReplay: true
                });
            }
            
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'channel_locked',
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason: reason
                });
            }

            // Send real-time notification to dashboard
            if (bot?.dashboard && bot.dashboard.wss) {
                bot.dashboard.broadcastToGuild(interaction.guild.id, {
                    type: 'action',
                    action: {
                        id: Date.now(),
                        type: 'lock',
                        category: 'moderation',
                        target: { id: channel.id, tag: `#${channel.name}` },
                        moderator: { id: interaction.user.id, tag: interaction.user.tag },
                        reason: reason,
                        canUndo: true,
                        timestamp: Date.now()
                    }
                });
            }
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to lock channel. Check bot permissions.',
                ephemeral: true
            });
        }
    }
};
