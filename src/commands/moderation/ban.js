const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the ban')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('delete-days')
                .setDescription('Days of messages to delete (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction, bot) {
        // Always defer first to prevent reply errors
        await interaction.deferReply();
        
        const guildId = interaction.guild.id;
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || bot.languageSystem?.t(guildId, 'moderation.noReason') || 'No reason provided';
        const deleteMessageDays = interaction.options.getInteger('delete-days') || 0;
        const member = interaction.guild.members.cache.get(target.id);

        // Check if target is bannable
        if (member && !member.bannable) {
            const msg = bot.languageSystem?.t(guildId, 'errors.cannotBan') || '❌ Cannot ban this user. They may have higher permissions.';
            return await interaction.editReply({
                content: msg,
                ephemeral: true
            });
        }

        // Check role hierarchy if member exists
        if (member && member.roles.highest.position >= interaction.member.roles.highest.position) {
            const msg = bot.languageSystem?.t(guildId, 'errors.roleHierarchy') || '❌ You cannot ban someone with equal or higher roles.';
            return await interaction.editReply({
                content: msg,
                ephemeral: true
            });
        }

        try {
            // Send DM to user before ban
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🔨 You have been banned')
                    .setDescription(`You were banned from **${interaction.guild.name}**`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Moderator', value: interaction.user.username, inline: true }
                    )
                    .setColor('#ff4757')
                    .setTimestamp();

                if (member) await member.send({ embeds: [dmEmbed] });
            } catch (error) {
                // DM failed, continue with ban
            }

            // Ban the user
            await interaction.guild.members.ban(target, {
                reason: reason,
                deleteMessageDays: deleteMessageDays
            });

            // Broadcast to dashboard console
            if (typeof bot?.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[BAN] ${target.username} (${target.id}) by ${interaction.user.username}`);
            }

            // Log to bot_logs for dashboard Logs & Audit Trail page
            if (bot?.logger) {
                await bot.logger.logSecurityEvent({
                    eventType: 'ban',
                    guildId: interaction.guild.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.username,
                    targetId: target.id,
                    targetTag: target.username,
                    reason: reason,
                    details: { deleteMessageDays: deleteMessageDays }
                });
            }

            // Log to forensics audit trail
            if (bot?.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'ban',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.username },
                    target: { id: target.id, name: target.username, type: 'user' },
                    reason: reason,
                    canReplay: true
                });
            }

            // Log to database with comprehensive action logging
            let actionId = null;
            
            if (bot && bot.database) {
                // Log to incidents (legacy)
                await bot.database.logIncident({
                    type: 'user_banned',
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    guildId: interaction.guild.id,
                    reason: reason,
                    timestamp: Date.now(),
                    deleteMessageDays: deleteMessageDays
                });

                // Log to new action_logs system (can undo via unban)
                const result = await bot.database.logAction({
                    guildId: interaction.guild.id,
                    actionType: 'ban',
                    actionCategory: 'moderation',
                    targetUserId: target.id,
                    targetUsername: target.username,
                    moderatorId: interaction.user.id,
                    moderatorUsername: interaction.user.username,
                    reason: reason,
                    details: { deleteMessageDays },
                    canUndo: true // Can be undone via unban
                });
                actionId = result.id;

                // Send real-time notification to dashboard
                if (bot.dashboard && bot.dashboard.wss) {
                    bot.dashboard.broadcastToGuild(interaction.guild.id, {
                        type: 'action',
                        action: {
                            id: actionId,
                            type: 'ban',
                            category: 'moderation',
                            target: { id: target.id, tag: target.username, avatar: target.displayAvatarURL() },
                            moderator: { id: interaction.user.id, tag: interaction.user.username },
                            reason: reason,
                            canUndo: true,
                            timestamp: Date.now()
                        }
                    });
                }
                
                // Emit moderation action event (new event system)
                if (bot.eventEmitter) {
                    await bot.eventEmitter.emitModerationAction(
                        interaction.guild.id,
                        'ban',
                        { id: target.id, tag: target.username },
                        { id: interaction.user.id, tag: interaction.user.username },
                        reason,
                        true
                    );
                }
            }

            // Success embed with translations
            const t = (key, vars) => bot.languageSystem?.t(guildId, key, vars) || key;
            const successEmbed = new EmbedBuilder()
                .setTitle(t('moderation.ban.title') || '✅ Member Banned')
                .setDescription(t('moderation.ban.success', { user: target.username }) || `**${target.username}** has been banned from the server.`)
                .addFields(
                    { name: t('common.reason') || 'Reason', value: reason, inline: false },
                    { name: t('common.moderator') || 'Moderator', value: interaction.user.username, inline: true },
                    { name: t('moderation.ban.messageDeletion') || 'Message Deletion', value: `${deleteMessageDays} ${t('common.days') || 'days'}`, inline: true }
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
                    .setTitle('🔨 Member Banned')
                    .addFields(
                        { name: 'User', value: `${target.username} (${target.id})`, inline: true },
                        { name: 'Moderator', value: interaction.user.username, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Messages Deleted', value: `${deleteMessageDays} days`, inline: true }
                    )
                    .setColor('#ff4757')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error('Error banning member:', error);
            await interaction.editReply({
                content: '❌ An error occurred while banning the member.',
                ephemeral: true
            });
        }
    },
};