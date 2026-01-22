const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// DEPRECATED: Use /admin unlock instead
module.exports = {
    deprecated: true,
    newCommand: '/admin unlock',
    data: new SlashCommandBuilder()
        .setName('unlockdown')
        .setDescription('⚠️ MOVED → Use /admin unlock instead')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for ending lockdown')
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
            // Check if in lockdown
            const lockdown = await bot.lockdownManager.isLocked(interaction.guild.id);
            if (!lockdown) {
                return await interaction.editReply({
                    content: '❌ Server is not currently in lockdown.',
                    ephemeral: true
                });
            }

            const reason = interaction.options.getString('reason') || 'Lockdown ended by administrator';

            // Deactivate lockdown
            const result = await bot.lockdownManager.deactivate(interaction.guild, {
                deactivatedBy: interaction.user.id,
                deactivatedByTag: interaction.user.tag,
                reason
            });

            if (!result.success) {
                return await interaction.editReply({
                    content: `❌ Failed to end lockdown: ${result.error}`,
                    ephemeral: true
                });
            }

            // Build success embed
            const unlockEmbed = new EmbedBuilder()
                .setTitle('✅ LOCKDOWN ENDED')
                .setDescription('Server lockdown has been successfully lifted.')
                .addFields([
                    { name: 'Channels Restored', value: `${result.restored}/${result.restored + result.failed}`, inline: true },
                    { name: 'Deactivated By', value: interaction.user.toString(), inline: true },
                    { name: 'Reason', value: reason, inline: false }
                ])
                .setColor(0x00ff00)
                .setTimestamp();

            // Add restoration details
            const actions = [
                '🔓 Channel permissions restored',
                '⏱️ Slowmode restored to original',
                '✅ Normal operations resumed'
            ];
            
            unlockEmbed.addFields({ name: 'Actions Taken', value: actions.join('\n'), inline: false });

            if (result.failed > 0) {
                unlockEmbed.addFields({
                    name: '⚠️ Warnings',
                    value: `Failed to restore ${result.failed} channel(s). Some channels may need manual review.`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [unlockEmbed] });

            // Notify in system channel
            const systemChannel = interaction.guild.systemChannel || 
                                interaction.guild.channels.cache.find(c => c.name.includes('general'));
            
            if (systemChannel && systemChannel.permissionsFor(interaction.guild.members.me).has('SendMessages')) {
                const publicEmbed = new EmbedBuilder()
                    .setTitle('✅ LOCKDOWN ENDED')
                    .setDescription(`Server lockdown has been lifted. Normal operations have resumed.\n\n**Reason:** ${reason}`)
                    .setColor(0x00ff00)
                    .setFooter({ text: 'Thank you for your patience' })
                    .setTimestamp();
                
                try {
                    await systemChannel.send({ embeds: [publicEmbed] });
                } catch (error) {
                    bot.logger.warn('[Unlockdown] Failed to send public notification:', error);
                }
            }

            // Broadcast to dashboard
            if (bot.dashboard?.broadcastToGuild) {
                bot.dashboard.broadcastToGuild(interaction.guild.id, {
                    type: 'lockdown_deactivated',
                    data: {
                        deactivatedBy: interaction.user.tag,
                        channelsRestored: result.restored,
                        reason
                    }
                });
            }

            // Send real-time notification to dashboard
            if (bot.dashboard && bot.dashboard.wss) {
                bot.dashboard.broadcastToGuild(interaction.guild.id, {
                    type: 'action',
                    action: {
                        id: Date.now(),
                        type: 'unlockdown',
                        category: 'security',
                        target: { id: interaction.guild.id, tag: interaction.guild.name },
                        moderator: { id: interaction.user.id, tag: interaction.user.tag },
                        reason: reason,
                        details: `Lockdown ended - ${result.restored} channels restored`,
                        canUndo: false,
                        timestamp: Date.now()
                    }
                });
            }

        } catch (error) {
            bot.logger.error('[Unlockdown] Command execution failed:', error);
            
            return await interaction.editReply({
                content: '❌ An error occurred while ending lockdown. Please check bot permissions and try again.',
                ephemeral: true
            });
        }
    }
};
