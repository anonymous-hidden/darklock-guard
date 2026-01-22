const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock a channel to allow members to send messages')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to unlock (defaults to current channel)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unlocking the channel')
                .setRequired(false)),

    async execute(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null,
                AddReactions: null
            });

            await interaction.editReply({
                content: `🔓 Unlocked ${channel}\n**Reason:** ${reason}`,
                ephemeral: true
            });

            await channel.send({
                content: `🔓 **Channel Unlocked**\nThis channel has been unlocked by ${interaction.user}\n**Reason:** ${reason}`
            });

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[UNLOCK] #${channel.name} by ${interaction.user.tag}`);
            }
            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'channel_unlock',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: channel.id, name: channel.name, type: 'channel' },
                    reason: reason,
                    canReplay: true
                });
            }
            
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'channel_unlocked',
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
                        type: 'unlock',
                        category: 'moderation',
                        target: { id: channel.id, tag: `#${channel.name}` },
                        moderator: { id: interaction.user.id, tag: interaction.user.tag },
                        reason: reason,
                        canUndo: false,
                        timestamp: Date.now()
                    }
                });
            }
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to unlock channel. Check bot permissions.',
                ephemeral: true
            });
        }
    }
};
