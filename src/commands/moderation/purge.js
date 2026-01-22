const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete multiple messages at once')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true))
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Only delete messages from this user')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the purge')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction, bot) {
        const amount = interaction.options.getInteger('amount');
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch messages
            const messages = await interaction.channel.messages.fetch({
                limit: target ? Math.min(amount * 2, 100) : amount
            });

            let messagesToDelete;
            if (target) {
                messagesToDelete = messages.filter(msg => msg.author.id === target.id).first(amount);
            } else {
                messagesToDelete = messages.first(amount);
            }

            // Filter out messages older than 14 days (Discord limitation)
            const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
            const validMessages = messagesToDelete.filter(msg => msg.createdTimestamp > twoWeeksAgo);

            if (validMessages.size === 0) {
                return await interaction.editReply({
                    content: '❌ No messages found to delete (messages must be less than 14 days old).'
                });
            }

            // Delete messages
            await interaction.channel.bulkDelete(validMessages, true);

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[PURGE] ${validMessages.size} messages by ${interaction.user.tag} in #${interaction.channel.name}`);
            }

            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'purge',
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason: reason,
                    details: { messagesDeleted: validMessages.size, channelName: interaction.channel.name, targetUserId: target?.id }
                });
            }

            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'purge',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: interaction.channel.id, name: interaction.channel.name, type: 'channel' },
                    reason: reason,
                    changes: { messageCount: validMessages.size, targetUserId: target?.id },
                    canReplay: false
                });
            }

            // Log to database
            if (bot && bot.database) {
                await bot.database.logIncident({
                    type: 'message_purge',
                    moderatorId: interaction.user.id,
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    reason: reason,
                    messageCount: validMessages.size,
                    targetUserId: target?.id,
                    timestamp: Date.now()
                });
            }

            // Success message
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Messages Purged')
                .setDescription(`Successfully deleted **${validMessages.size}** messages.`)
                .addFields(
                    { name: 'Channel', value: interaction.channel.toString(), inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setColor('#2ed573')
                .setTimestamp();

            if (target) {
                successEmbed.addFields({ name: 'Target User', value: target.tag, inline: true });
            }

            await interaction.editReply({ embeds: [successEmbed] });

            // Send confirmation message that will auto-delete
            const confirmMsg = await interaction.channel.send({
                content: `🗑️ **${validMessages.size}** messages were deleted by ${interaction.user.tag}${target ? ` from ${target.tag}` : ''}.`
            });

            // Auto-delete confirmation after 5 seconds
            setTimeout(() => {
                confirmMsg.delete().catch(() => {});
            }, 5000);

            // Log to channel if configured
            const logChannel = interaction.guild.channels.cache.find(
                c => c.name === 'mod-logs' || c.name === 'audit-logs'
            );

            if (logChannel && logChannel.id !== interaction.channel.id) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🗑️ Messages Purged')
                    .addFields(
                        { name: 'Channel', value: interaction.channel.toString(), inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Messages Deleted', value: `${validMessages.size}`, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setColor('#ff6b6b')
                    .setTimestamp();

                if (target) {
                    logEmbed.addFields({ name: 'Target User', value: `${target.tag} (${target.id})`, inline: true });
                }

                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error('Error purging messages:', error);
            await interaction.editReply({
                content: '❌ An error occurred while deleting messages. Make sure I have the necessary permissions and the messages are less than 14 days old.'
            });
        }
    },
};