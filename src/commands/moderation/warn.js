const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('skip_escalation')
                .setDescription('Skip automatic escalation based on warning history')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction, bot) {
        await interaction.deferReply();
        
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const skipEscalation = interaction.options.getBoolean('skip_escalation') ?? false;
        const member = interaction.guild.members.cache.get(target.id);

        // Check if user exists in guild
        if (!member) {
            return await interaction.editReply({
                content: '❌ User not found in this server.',
                ephemeral: true
            });
        }

        // Use SecurityMiddleware if available
        if (bot.securityMiddleware) {
            const hierarchyCheck = await bot.securityMiddleware.checkHierarchy({
                ...interaction,
                options: { getUser: () => target }
            });
            if (!hierarchyCheck.passed) {
                return await interaction.editReply({
                    content: hierarchyCheck.error,
                    ephemeral: true
                });
            }
        } else {
            // Fallback hierarchy check
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return await interaction.editReply({
                    content: '❌ You cannot warn someone with equal or higher roles.',
                    ephemeral: true
                });
            }
        }

        try {
            // Use ModerationQueue if available for escalation handling
            if (bot.moderationQueue && !skipEscalation) {
                const result = await bot.moderationQueue.enqueue({
                    guildId: interaction.guild.id,
                    targetId: target.id,
                    moderatorId: interaction.user.id,
                    actionType: 'warn',
                    reason: reason
                });

                if (!result.queued) {
                    if (result.reason === 'duplicate') {
                        return await interaction.editReply({
                            content: '⚠️ This action was already processed recently. Please wait before trying again.',
                            ephemeral: true
                        });
                    }
                    if (result.reason === 'rate_limited') {
                        return await interaction.editReply({
                            content: '⏰ Moderation actions are being rate limited. Please wait a moment.',
                            ephemeral: true
                        });
                    }
                }

                // If escalated, notify
                if (result.escalated) {
                    await interaction.followUp({
                        content: `🔄 Due to prior offenses, this warning has been **escalated to a timeout**.`,
                        ephemeral: true
                    });
                }
            }

            // Log to database and get warning count
            let warningCount = 1;
            let actionId = null;
            
            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[WARN] ${target.username} (${target.id}) by ${interaction.user.username} - ${reason}`);
            }
            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'warn',
                    guildId: interaction.guild.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.username,
                    targetId: target.id,
                    targetTag: target.username,
                    reason: reason
                });
            }            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'warn',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.username },
                    target: { id: target.id, name: target.username, type: 'user' },
                    reason: reason,
                    canReplay: false
                });
            }
            
            if (bot && bot.database) {
                // Log to incidents (legacy)
                await bot.database.logIncident({
                    type: 'user_warned',
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    guildId: interaction.guild.id,
                    reason: reason,
                    timestamp: Date.now()
                });

                // Get user's total warnings
                const warnings = await bot.database.getUserWarnings(target.id, interaction.guild.id);
                warningCount = warnings.length;

                // Log to new action_logs system
                const result = await bot.database.logAction({
                    guildId: interaction.guild.id,
                    actionType: 'warn',
                    actionCategory: 'moderation',
                    targetUserId: target.id,
                    targetUsername: target.username,
                    moderatorId: interaction.user.id,
                    moderatorUsername: interaction.user.username,
                    reason: reason,
                    details: { warningCount },
                    canUndo: false // Warnings cannot be undone (but can be cleared)
                });
                actionId = result.id;

                // Send real-time notification to dashboard
                if (bot.dashboard && bot.dashboard.wss) {
                    bot.dashboard.broadcastToGuild(interaction.guild.id, {
                        type: 'action',
                        action: {
                            id: actionId,
                            type: 'warn',
                            category: 'moderation',
                            target: { id: target.id, tag: target.username, avatar: target.displayAvatarURL() },
                            moderator: { id: interaction.user.id, tag: interaction.user.username },
                            reason: reason,
                            warningCount: warningCount,
                            canUndo: false,
                            timestamp: Date.now()
                        }
                    });
                }
                
                // Emit moderation action event (new event system)
                if (bot.eventEmitter) {
                    await bot.eventEmitter.emitModerationAction(
                        interaction.guild.id,
                        'warn',
                        { id: target.id, tag: target.username },
                        { id: interaction.user.id, tag: interaction.user.username },
                        reason,
                        false
                    );
                }
            }

            // Send DM to user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('⚠️ You have received a warning')
                    .setDescription(`You were warned in **${interaction.guild.name}**`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Moderator', value: interaction.user.username, inline: true },
                        { name: 'Total Warnings', value: `${warningCount}`, inline: true }
                    )
                    .setColor('#ffa502')
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] });
            } catch (error) {
                // DM failed, continue
            }

            // Success embed
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Member Warned')
                .setDescription(`**${target.username}** has been warned.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Moderator', value: interaction.user.username, inline: true },
                    { name: 'Total Warnings', value: `${warningCount}`, inline: true }
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
                    .setTitle('⚠️ Member Warned')
                    .addFields(
                        { name: 'User', value: `${target.username} (${target.id})`, inline: true },
                        { name: 'Moderator', value: interaction.user.username, inline: true },
                        { name: 'Total Warnings', value: `${warningCount}`, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setColor('#ffa502')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }

            // Auto-moderation based on warning count
            if (warningCount >= 5) {
                try {
                    await member.timeout(24 * 60 * 60 * 1000, `Automatic timeout - ${warningCount} warnings`);
                    await interaction.followUp({
                        content: `🔄 **${target.username}** has been automatically timed out for 24 hours due to reaching ${warningCount} warnings.`,
                        ephemeral: false
                    });
                } catch (error) {
                    console.error('Auto-timeout failed:', error);
                }
            } else if (warningCount >= 3) {
                await interaction.followUp({
                    content: `⚠️ **${target.username}** now has ${warningCount} warnings. Consider escalating moderation actions.`,
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error warning member:', error);
            await interaction.editReply({
                content: '❌ An error occurred while warning the member.',
                ephemeral: true
            });
        }
    },
};