const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a member')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to timeout')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration (e.g., 10m, 1h, 1d)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction, bot) {
        await interaction.deferReply();
        
        const target = interaction.options.getUser('target');
        const duration = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(target.id);

        // Check if user exists in guild
        if (!member) {
            return await interaction.editReply({
                content: '❌ User not found in this server.',
                ephemeral: true
            });
        }

        // Parse duration
        let timeoutDuration;
        try {
            timeoutDuration = ms(duration);
            if (!timeoutDuration || timeoutDuration > 2419200000) { // 28 days max
                throw new Error('Invalid duration');
            }
        } catch (error) {
            return await interaction.editReply({
                content: '❌ Invalid duration format. Use formats like: 10m, 1h, 1d (max 28 days)',
                ephemeral: true
            });
        }

        // Check if target is moderatable
        if (!member.moderatable) {
            return await interaction.editReply({
                content: '❌ Cannot timeout this user. They may have higher permissions.',
                ephemeral: true
            });
        }

        // Check role hierarchy
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
            return await interaction.editReply({
                content: '❌ You cannot timeout someone with equal or higher roles.',
                ephemeral: true
            });
        }

        try {
            // Timeout the member
            await member.timeout(timeoutDuration, reason);

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[TIMEOUT] ${target.tag} (${target.id}) by ${interaction.user.tag} for ${duration}`);
            }

            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'timeout',
                    guildId: interaction.guild.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    targetId: target.id,
                    targetTag: target.tag,
                    reason: reason,
                    details: { duration: duration, durationMs: timeoutDuration }
                });
            }

            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'timeout',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: target.id, name: target.tag, type: 'user' },
                    reason: reason,
                    changes: { duration: duration },
                    canReplay: true
                });
            }

            // Log to database with comprehensive action logging
            let actionId = null;
            
            if (bot && bot.database) {
                // Log to incidents (legacy)
                await bot.database.logIncident({
                    type: 'user_timeout',
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    guildId: interaction.guild.id,
                    reason: reason,
                    duration: duration,
                    timestamp: Date.now()
                });

                // Log to new action_logs system (with undo capability)
                const expiresAt = new Date(Date.now() + timeoutDuration).toISOString();
                const result = await bot.database.logAction({
                    guildId: interaction.guild.id,
                    actionType: 'timeout',
                    actionCategory: 'moderation',
                    targetUserId: target.id,
                    targetUsername: target.tag,
                    moderatorId: interaction.user.id,
                    moderatorUsername: interaction.user.tag,
                    reason: reason,
                    duration: duration,
                    details: {
                        durationMs: timeoutDuration,
                        formattedDuration: duration
                    },
                    canUndo: true,
                    expiresAt: expiresAt
                });
                actionId = result.id;

                // Send real-time notification to dashboard via WebSocket
                if (bot.dashboard && bot.dashboard.wss) {
                    bot.dashboard.broadcastToGuild(interaction.guild.id, {
                        type: 'action',
                        action: {
                            id: actionId,
                            type: 'timeout',
                            category: 'moderation',
                            target: { id: target.id, tag: target.tag, avatar: target.displayAvatarURL() },
                            moderator: { id: interaction.user.id, tag: interaction.user.tag },
                            reason: reason,
                            duration: duration,
                            canUndo: true,
                            timestamp: Date.now()
                        }
                    });
                }
                
                // Emit moderation action event (new event system)
                if (bot.eventEmitter) {
                    await bot.eventEmitter.emitModerationAction(
                        interaction.guild.id,
                        'timeout',
                        { id: target.id, tag: target.tag },
                        { id: interaction.user.id, tag: interaction.user.tag },
                        reason,
                        true
                    );
                }
            }

            // Success embed
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Member Timed Out')
                .setDescription(`**${target.tag}** has been timed out.`)
                .addFields(
                    { name: 'Duration', value: duration, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Moderator', value: interaction.user.tag, inline: true }
                )
                .setColor('#ffa502')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            // Log to channel if configured
            const logChannel = interaction.guild.channels.cache.find(
                c => c.name === 'mod-logs' || c.name === 'audit-logs'
            );

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🔇 Member Timed Out')
                    .addFields(
                        { name: 'User', value: `${target.tag} (${target.id})`, inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Duration', value: duration, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setColor('#ffa502')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error('Error timing out member:', error);
            await interaction.reply({
                content: '❌ An error occurred while timing out the member.',
                ephemeral: true
            });
        }
    },
};