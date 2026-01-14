const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set slowmode delay for a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Slowmode delay in seconds (0 to disable, max 21600)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to apply slowmode to (defaults to current channel)')
                .setRequired(false)),

    async execute(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        
        const seconds = interaction.options.getInteger('seconds');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        try {
            await channel.setRateLimitPerUser(seconds);

            const duration = seconds === 0 ? 'disabled' : (
                seconds >= 3600 
                    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
                    : seconds >= 60 
                    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
                    : `${seconds}s`
            );

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[SLOWMODE] #${channel.name} set to ${duration} by ${interaction.user.tag}`);
            }

            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'slowmode',
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    details: { seconds: seconds, duration: duration, channelName: channel.name }
                });
            }

            if (seconds === 0) {
                await interaction.editReply({
                    content: `✅ Slowmode disabled in ${channel}`,
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: `✅ Slowmode set to **${duration}** in ${channel}`,
                    ephemeral: true
                });
            }
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to set slowmode. Check bot permissions.',
                ephemeral: true
            });
        }
    }
};
