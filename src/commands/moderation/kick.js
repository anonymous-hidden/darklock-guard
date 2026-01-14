const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the kick')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction, bot) {
        await interaction.deferReply();
        
        const guildId = interaction.guild.id;
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || bot.languageSystem?.t(guildId, 'moderation.noReason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(target.id);

        // Check if user exists in guild
        if (!member) {
            const msg = bot.languageSystem?.t(guildId, 'errors.userNotFound') || '❌ User not found in this server.';
            return await interaction.editReply({
                content: msg,
                ephemeral: true
            });
        }

        // Check if target is kickable
        if (!member.kickable) {
            const msg = bot.languageSystem?.t(guildId, 'errors.cannotKick') || '❌ Cannot kick this user. They may have higher permissions.';
            return await interaction.editReply({
                content: msg,
                ephemeral: true
            });
        }

        // Check role hierarchy
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
            const msg = bot.languageSystem?.t(guildId, 'errors.roleHierarchy') || '❌ You cannot kick someone with equal or higher roles.';
            return await interaction.editReply({
                content: msg,
                ephemeral: true
            });
        }

        try {
            // Send DM to user before kick
            let dmSent = false;
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🦵 You have been kicked')
                    .setDescription(`You were kicked from **${interaction.guild.name}**`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Moderator', value: interaction.user.tag, inline: true }
                    )
                    .setColor('#ff6b6b')
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] });
                dmSent = true;
            } catch (dmError) {
                // DM failed (user has DMs disabled or bot blocked) - continue with kick
                bot.logger?.warn(`Could not DM user ${target.tag} before kick:`, dmError.message);
            }

            // Kick the member
            await member.kick(reason);
            bot.logger?.info(`✅ Successfully kicked ${target.tag} from ${interaction.guild.name}`);

            // Broadcast to dashboard console
            if (typeof bot.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[KICK] ${target.tag} (${target.id}) by ${interaction.user.tag}`);
            }
            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'kick',
                    guildId: interaction.guild.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    targetId: target.id,
                    targetTag: target.tag,
                    reason: reason
                });
            }            // Log to forensics audit trail
            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'kick',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: target.id, name: target.tag, type: 'user' },
                    reason: reason,
                    canReplay: true
                });
            }

            // Log to database with comprehensive action logging
            let actionId = null;
            
            if (bot && bot.database) {
                try {
                    // Log to incidents (legacy)
                    await bot.database.logIncident({
                        type: 'user_kicked',
                        userId: target.id,
                        moderatorId: interaction.user.id,
                        guildId: interaction.guild.id,
                        reason: reason,
                        timestamp: Date.now()
                    });

                    // Log to new action_logs system (cannot undo kick)
                    const result = await bot.database.logAction({
                        guildId: interaction.guild.id,
                        actionType: 'kick',
                        actionCategory: 'moderation',
                        targetUserId: target.id,
                        targetUsername: target.tag,
                        moderatorId: interaction.user.id,
                        moderatorUsername: interaction.user.tag,
                        reason: reason,
                        canUndo: false // Kicks cannot be undone
                    });
                    actionId = result?.id;
                } catch (dbError) {
                    bot.logger?.error('Failed to log kick to database:', dbError);
                    // Don't fail the entire command if logging fails
                }

                // Send real-time notification to dashboard
                if (bot.dashboard && bot.dashboard.broadcastToGuild) {
                    try {
                        bot.dashboard.broadcastToGuild(interaction.guild.id, {
                            type: 'action',
                            action: {
                                id: actionId,
                                type: 'kick',
                                category: 'moderation',
                                target: { id: target.id, tag: target.tag, avatar: target.displayAvatarURL() },
                                moderator: { id: interaction.user.id, tag: interaction.user.tag },
                                reason: reason,
                                canUndo: false,
                                timestamp: Date.now()
                            }
                        });
                    } catch (wsError) {
                        bot.logger?.warn('Failed to broadcast kick to dashboard:', wsError.message);
                    }
                }
                
                // Emit moderation action event (new event system)
                if (bot.eventEmitter) {
                    try {
                        await bot.eventEmitter.emitModerationAction(
                            interaction.guild.id,
                            'kick',
                            { id: target.id, tag: target.tag },
                            { id: interaction.user.id, tag: interaction.user.tag },
                            reason,
                            false
                        );
                    } catch (eventError) {
                        bot.logger?.warn('Failed to emit kick event:', eventError.message);
                    }
                }
            }

            // Success embed with translations
            const t = (key, vars) => bot.languageSystem?.t(guildId, key, vars) || key;
            const successEmbed = new EmbedBuilder()
                .setTitle(t('moderation.kick.title') || '✅ Member Kicked')
                .setDescription(t('moderation.kick.success', { user: target.tag }) || `**${target.tag}** has been kicked from the server.`)
                .addFields(
                    { name: t('common.reason') || 'Reason', value: reason, inline: false },
                    { name: t('common.moderator') || 'Moderator', value: interaction.user.tag, inline: true },
                    { name: t('moderation.kick.dmNotification') || 'DM Notification', value: dmSent ? '✅ Sent' : '❌ Failed (DMs disabled)', inline: true }
                )
                .setColor('#2ed573')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            // Log to channel if configured
            const logChannel = interaction.guild.channels.cache.find(
                c => c.name === 'mod-logs' || c.name === 'audit-logs'
            );

            if (logChannel) {
                try {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🦵 Member Kicked')
                        .addFields(
                            { name: 'User', value: `${target.tag} (${target.id})`, inline: true },
                            { name: 'Moderator', value: interaction.user.tag, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setColor('#ff6b6b')
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                } catch (logError) {
                    bot.logger?.warn('Failed to send log to mod channel:', logError.message);
                }
            }

        } catch (error) {
            bot.logger?.error('Error kicking member:', error);
            
            // Provide detailed error message
            let errorMessage = '❌ An error occurred while kicking the member.';
            
            if (error.code === 50013) {
                errorMessage = '❌ Missing permissions to kick this member.';
            } else if (error.message.includes('Unknown Member')) {
                errorMessage = '❌ Member has already left the server.';
            } else if (error.message.includes('Missing Permissions')) {
                errorMessage = '❌ I don\'t have permission to kick members.';
            }
            
            try {
                await interaction.editReply({
                    content: `${errorMessage}\n\n*Error: ${error.message}*`,
                    ephemeral: true
                });
            } catch (replyError) {
                // If we can't edit the reply, try to send a followup
                try {
                    await interaction.followUp({
                        content: errorMessage,
                        ephemeral: true
                    });
                } catch (followupError) {
                    bot.logger?.error('Failed to send error message to user:', followupError);
                }
            }
        }
    },
};