const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(option =>
            option.setName('userid')
                .setDescription('The ID of the user to unban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the unban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction, bot) {
        await interaction.deferReply();
        
        const userId = interaction.options.getString('userid');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Validate user ID format
        if (!/^\d{17,19}$/.test(userId)) {
            return await interaction.editReply({
                content: '❌ Invalid user ID format. Please provide a valid Discord user ID.',
                ephemeral: true
            });
        }

        try {
            // Check if user is actually banned
            const bans = await interaction.guild.bans.fetch();
            const bannedUser = bans.get(userId);

            if (!bannedUser) {
                return await interaction.editReply({
                    content: '❌ This user is not banned from the server.',
                    ephemeral: true
                });
            }

            // Unban the user
            await interaction.guild.members.unban(userId, reason);

            // Log to database
            if (bot && bot.database) {
                await bot.database.logIncident({
                    type: 'user_unbanned',
                    userId: userId,
                    moderatorId: interaction.user.id,
                    guildId: interaction.guild.id,
                    reason: reason,
                    timestamp: Date.now()
                });
            }
            
            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[UNBAN] ${userId} by ${interaction.user.tag}`);
            }
            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'unban',
                    guildId: interaction.guild.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    targetId: userId,
                    targetTag: bannedUser?.tag || userId,
                    reason: reason
                });
            }
            // Success embed
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ User Unbanned')
                .setDescription(`**${bannedUser.user.tag}** has been unbanned from the server.`)
                .addFields(
                    { name: 'User ID', value: userId, inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setColor('#2ed573')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            // Log to channel if configured
            const logChannel = interaction.guild.channels.cache.find(
                c => c.name === 'mod-logs' || c.name === 'audit-logs'
            );

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ User Unbanned')
                    .addFields(
                        { name: 'User', value: `${bannedUser.user.tag} (${userId})`, inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setColor('#2ed573')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error('Error unbanning user:', error);
            
            if (error.code === 10026) {
                await interaction.editReply({
                    content: '❌ This user is not banned from the server.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: '❌ An error occurred while unbanning the user. Please check the user ID and try again.',
                    ephemeral: true
                });
            }
        }
    },
};