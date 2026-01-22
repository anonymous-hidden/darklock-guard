/**
 * Button Interaction Handlers
 * Extracted from bot.js - handles general button interactions
 * Last updated: 2025-12-28 16:05 UTC - Added untimeout case
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');

/**
 * Handle general button interactions
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleButtonInteraction(interaction, bot) {
    const { customId } = interaction;

    try {
        // Early catch for verification buttons if event handler did not consume
        if (customId.startsWith('verify_user_')) {
            // Fallback parsing: verify_user_<guildId>_<userId>
            const parts = customId.split('_');
            if (parts.length >= 4) {
                const guildId = parts[2];
                const targetUserId = parts[3];
                if (interaction.user.id !== targetUserId) {
                    return interaction.reply({ content: 'This verification button is not for you.', ephemeral: true });
                }
                const pending = await bot.database.get(
                    `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                    [guildId, targetUserId]
                );
                if (!pending) {
                    return interaction.reply({ content: 'No active verification challenge found.', ephemeral: true });
                }
                const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
                if (isExpired) {
                    await bot.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    return interaction.reply({ content: 'Verification challenge expired. Ask staff to resend.', ephemeral: true });
                }
                const guild = bot.client.guilds.cache.get(guildId);
                if (!guild) return interaction.reply({ content: 'Guild not found for verification.', ephemeral: true });
                const member = await guild.members.fetch(targetUserId).catch(() => null);
                if (!member) return interaction.reply({ content: 'You are no longer in the server.', ephemeral: true });
                await bot.userVerification.markVerified(member, 'button');
                await bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                return interaction.reply({ content: '✅ You are now verified. Welcome!', ephemeral: true });
            }
        }
        switch (customId) {
            case 'refresh_status':
                // Refresh security status
                const statusCommand = bot.commands.get('status');
                if (statusCommand) {
                    await statusCommand.execute(interaction);
                }
                break;

            case 'setup_guide':
                const setupEmbed = new EmbedBuilder()
                    .setTitle('📋 DarkLock Setup Guide')
                    .setDescription('Follow these steps to secure your server:')
                    .addFields(
                        { name: '1. Quick Setup', value: 'Use `/setup quick` for recommended settings', inline: false },
                        { name: '2. Configure Logging', value: 'Use `/setup logs` to set up security logs', inline: false },
                        { name: '3. Customize Protection', value: 'Fine-tune anti-spam and anti-raid settings', inline: false },
                        { name: '4. Check Status', value: 'Use `/status` to monitor your security score', inline: false },
                        { name: '5. Dashboard Access', value: 'Visit the web dashboard for detailed analytics', inline: false }
                    )
                    .setColor('#00d4ff');

                await interaction.reply({ embeds: [setupEmbed], ephemeral: true });
                break;

            case 'security_guide':
                const securityEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Security Best Practices')
                    .setDescription('Improve your server security:')
                    .addFields(
                        { name: '✅ Enable 2FA', value: 'Require 2FA for moderators', inline: false },
                        { name: '✅ Set Verification Level', value: 'Use medium or high verification', inline: false },
                        { name: '✅ Configure Permissions', value: 'Review and limit role permissions', inline: false },
                        { name: '✅ Monitor Activity', value: 'Regular check security logs and dashboard', inline: false },
                        { name: '✅ Stay Updated', value: 'Keep DarkLock permissions up to date', inline: false }
                    )
                    .setColor('#2ed573');

                await interaction.reply({ embeds: [securityEmbed], ephemeral: true });
                break;

            case 'check_status':
                const statusCmd = bot.commands.get('status');
                if (statusCmd) {
                    await statusCmd.execute(interaction);
                }
                break;

            // Ticket system buttons
            case 'ticket_open':
            case 'ticket_create':
                if (bot.ticketSystem) {
                    await bot.ticketSystem.handleCreateButton(interaction);
                }
                break;
            
            case 'ticket_claim':
                if (bot.ticketSystem) {
                    await bot.ticketSystem.handleClaim(interaction);
                }
                break;
            
            case 'ticket_close':
                if (bot.ticketSystem) {
                    await bot.ticketSystem.handleClose(interaction);
                }
                break;

            // Security notification action buttons
            default:
                // Check if it's a spam action button
                if (customId.startsWith('spam_')) {
                    await handleSpamAction(interaction, bot);
                } else if (customId.startsWith('raid_')) {
                    await handleRaidAction(interaction, bot);
                } else if (customId.startsWith('nuke_')) {
                    await handleNukeAction(interaction, bot);
                } else if (customId.startsWith('link_')) {
                    await handleLinkAction(interaction, bot);
                } else if (customId.startsWith('verify_approve_') || customId.startsWith('verify_reject_') || customId.startsWith('verify_ban_')) {
                    await handleVerifyAction(interaction, bot);
                } else {
                    await interaction.reply({
                        content: '❌ Unknown button interaction.',
                        ephemeral: true
                    });
                }
        }
    } catch (error) {
        bot.logger.error('Error handling button interaction:', error);
        await interaction.reply({
            content: '❌ An error occurred while processing your request.',
            ephemeral: true
        });
    }
}

/**
 * Handle spam moderation action buttons
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleSpamAction(interaction, bot) {
    const { customId, member, guild } = interaction;
    const { PermissionsBitField } = require('discord.js');

    // Check if user has moderation permissions
    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: '❌ You need Moderate Members permission to use these actions.',
            ephemeral: true
        });
    }

    // Parse the action and user ID from customId
    // Format: spam_action_userId
    const parts = customId.split('_');
    const action = parts[1]; // untimeout, warn, kick, ban, whitelist
    const targetUserId = parts[parts.length - 1];

    // Debug logging
    bot.logger?.debug && bot.logger.debug(`[SPAM_ACTION] customId=${customId}, action=${action}, targetUserId=${targetUserId}`);

    await interaction.deferReply({ ephemeral: true });

    try {
        const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
        
        if (!targetMember) {
            return interaction.editReply({
                content: '❌ User not found. They may have left the server.'
            });
        }

        const targetUser = targetMember.user;

        switch (action) {
            case 'remove':
                // Remove timeout (from spam_remove_timeout_userId) - fallback case
                try {
                    const isTimedOutRemove = targetMember.communicationDisabledUntil && new Date(targetMember.communicationDisabledUntil) > new Date();
                    if (isTimedOutRemove) {
                        await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);
                        
                        // Log the action
                        await bot.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            guild.id,
                            'TIMEOUT_REMOVED',
                            targetUserId,
                            member.id,
                            'Manual review: timeout removed after spam detection'
                        ]);

                        await interaction.editReply({
                            content: `✅ Removed timeout from ${targetUser.tag}`
                        });
                    } else {
                        await interaction.editReply({
                            content: `ℹ️ ${targetUser.tag} is not currently timed out.`
                        });
                    }
                } catch (removeErr) {
                    bot.logger?.error && bot.logger.error('[SPAM_ACTION] Remove timeout failed:', removeErr);
                    await interaction.editReply({ content: `❌ Failed to remove timeout: ${removeErr.message}` });
                }
                break;

            case 'warn':
                // Add additional warning
                const userRecord = await bot.database.getUserRecord(guild.id, targetUserId);
                const newWarningCount = (userRecord?.warning_count || 0) + 1;
                
                await bot.database.createOrUpdateUserRecord(guild.id, targetUserId, {
                    warning_count: newWarningCount,
                    trust_score: Math.max(0, (userRecord?.trust_score || 50) - 15)
                });

                await bot.database.run(`
                    INSERT INTO mod_actions 
                    (guild_id, action_type, target_user_id, moderator_id, reason)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    guild.id,
                    'WARN',
                    targetUserId,
                    member.id,
                    'Additional warning after spam detection'
                ]);

                // Try to DM the user
                try {
                    await targetUser.send({
                        embeds: [{
                            title: '⚠️ Additional Warning',
                            description: `You received an additional warning in **${guild.name}** from a moderator.`,
                            fields: [
                                { name: 'Total Warnings', value: `${newWarningCount}`, inline: true },
                                { name: 'Moderator', value: member.user.tag, inline: true }
                            ],
                            color: 0xffa500,
                            timestamp: new Date().toISOString()
                        }]
                    });
                } catch (e) {
                    // User has DMs disabled
                }

                await interaction.editReply({
                    content: `✅ Added warning to ${targetUser.tag} (Total: ${newWarningCount})`
                });
                break;

            case 'kick':
                if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                    return interaction.editReply({
                        content: '❌ You need Kick Members permission to use this action.'
                    });
                }

                await targetMember.kick(`Kicked by ${member.user.tag} after spam detection`);

                // Log to mod_actions table
                await bot.database.run(`
                    INSERT INTO mod_actions 
                    (guild_id, action_type, target_user_id, moderator_id, reason)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    guild.id,
                    'KICK',
                    targetUserId,
                    member.id,
                    'Kicked after spam detection review'
                ]);

                // Emit to audit trail and dashboard console
                if (typeof bot.broadcastConsole === 'function') {
                    bot.broadcastConsole(guild.id, `[KICK] ${targetUser.tag} (${targetUserId}) by ${member.user.tag} (${member.id})`);
                }
                if (bot.forensicsManager) {
                    await bot.forensicsManager.logAuditEvent({
                        guildId: guild.id,
                        eventType: 'kick',
                        eventCategory: 'moderation',
                        executor: { id: member.id, tag: member.user.tag },
                        target: { id: targetUserId, name: targetUser.tag, type: 'user' },
                        reason: 'Kicked after spam detection review',
                        canReplay: true
                    });
                }

                await interaction.editReply({
                    content: `✅ Kicked ${targetUser.tag} from the server`
                });
                break;

            case 'ban':
                if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return interaction.editReply({
                        content: '❌ You need Ban Members permission to use this action.'
                    });
                }

                await guild.members.ban(targetUserId, { 
                    reason: `Banned by ${member.user.tag} after spam detection`,
                    deleteMessageSeconds: 86400 // Delete messages from last 24 hours
                });

                // Log to mod_actions table
                await bot.database.run(`
                    INSERT INTO mod_actions 
                    (guild_id, action_type, target_user_id, moderator_id, reason)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    guild.id,
                    'BAN',
                    targetUserId,
                    member.id,
                    'Banned after spam detection review'
                ]);

                // Emit to audit trail and dashboard console
                if (typeof bot.broadcastConsole === 'function') {
                    bot.broadcastConsole(guild.id, `[BAN] ${targetUser.tag} (${targetUserId}) by ${member.user.tag} (${member.id})`);
                }
                if (bot.forensicsManager) {
                    await bot.forensicsManager.logAuditEvent({
                        guildId: guild.id,
                        eventType: 'ban',
                        eventCategory: 'moderation',
                        executor: { id: member.id, tag: member.user.tag },
                        target: { id: targetUserId, name: targetUser.tag, type: 'user' },
                        reason: 'Banned after spam detection review',
                        canReplay: true
                    });
                }

                await interaction.editReply({
                    content: `✅ Banned ${targetUser.tag} from the server`
                });
                break;

            case 'whitelist':
                // Add user to spam whitelist (increase trust score significantly)
                const whitelistRecord = await bot.database.getUserRecord(guild.id, targetUserId);
                await bot.database.createOrUpdateUserRecord(guild.id, targetUserId, {
                    trust_score: 100,
                    flags: JSON.stringify({ spamWhitelisted: true })
                });

                // Remove timeout if any
                if (targetMember.communicationDisabledUntil) {
                    await targetMember.timeout(null, `Whitelisted by ${member.user.tag}`);
                }

                await interaction.editReply({
                    content: `✅ Whitelisted ${targetUser.tag}. Trust score set to maximum.`
                });
                break;

            case 'untimeout':
                // Remove timeout from user
                try {
                    // Check if user is timed out (communicationDisabledUntil is a Date or null)
                    const isTimedOut = targetMember.communicationDisabledUntil && new Date(targetMember.communicationDisabledUntil) > new Date();
                    
                    if (isTimedOut) {
                        // Use timeout with duration of null to remove timeout
                        await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);
                        
                        await bot.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason)
                            VALUES (?, ?, ?, ?, ?)
                        `, [guild.id, 'TIMEOUT_REMOVED', targetUserId, member.id, 'Manual untimeout after spam detection']);
                        
                        await interaction.editReply({ content: `✅ Removed timeout from ${targetUser.tag}` });
                    } else {
                        await interaction.editReply({ content: `ℹ️ ${targetUser.tag} is not currently timed out.` });
                    }
                } catch (untimeoutError) {
                    bot.logger?.error && bot.logger.error('[SPAM_ACTION] Untimeout failed:', untimeoutError);
                    await interaction.editReply({ content: `❌ Failed to remove timeout: ${untimeoutError.message}` });
                    return;
                }
                break;

            default:
                bot.logger?.warn && bot.logger.warn(`[SPAM_ACTION] Unknown action: ${action} from customId: ${customId}`);
                await interaction.editReply({
                    content: `❌ Unknown action: ${action}`
                });
                return; // Don't update the notification message for unknown actions
        }

        // Update the original message to show action was taken (only for successful actions)
        try {
            const originalEmbed = interaction.message.embeds[0];
            if (originalEmbed) {
                const updatedEmbed = new EmbedBuilder(originalEmbed.data)
                    .setColor(0x00ff00)
                    .addFields({
                        name: '✅ Action Taken',
                        value: `${member.user.tag} used: **${action.toUpperCase()}**`,
                        inline: false
                    });

                await interaction.message.edit({
                    embeds: [updatedEmbed],
                    components: [] // Remove buttons after action
                });
            }
        } catch (e) {
            // Failed to update original message
        }

    } catch (error) {
        bot.logger.error('Error handling spam action:', error);
        await interaction.editReply({
            content: `❌ Failed to execute action: ${error.message}`
        });
    }
}

/**
 * Handle raid moderation action buttons
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleRaidAction(interaction, bot) {
    const { customId, member, guild } = interaction;

    // Check if user has moderation permissions
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({
            content: '❌ You need Manage Server permission to use these actions.',
            ephemeral: true
        });
    }

    const parts = customId.split('_');
    const action = parts[1]; // endlockdown, extendlockdown, lockdown, masskick, massban, approve
    const targetGuildId = parts[2];

    if (targetGuildId !== guild.id) {
        return interaction.reply({
            content: '❌ This action is not for this server.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        switch (action) {
            case 'endlockdown':
                if (bot.antiRaid?.restoreLockdown) {
                    await bot.antiRaid.restoreLockdown(guild);
                    await interaction.editReply({ content: '✅ Lockdown has been lifted. Channels restored.' });
                } else {
                    await interaction.editReply({ content: '❌ Anti-raid system not available.' });
                }
                break;

            case 'extendlockdown':
                if (bot.antiRaid?.scheduleLockdownLift) {
                    // Extend by 10 minutes
                    const config = await bot.database.getGuildConfig(guild.id);
                    bot.antiRaid.scheduleLockdownLift(guild, config, 10 * 60 * 1000);
                    await interaction.editReply({ content: '✅ Lockdown extended by 10 minutes.' });
                } else {
                    await interaction.editReply({ content: '❌ Anti-raid system not available.' });
                }
                break;

            case 'lockdown':
                if (bot.antiRaid?.activateLockdown) {
                    const config = await bot.database.getGuildConfig(guild.id);
                    await bot.antiRaid.activateLockdown(guild, { patternType: 'MANUAL' }, config, false);
                    await interaction.editReply({ content: '✅ Manual lockdown activated.' });
                } else {
                    await interaction.editReply({ content: '❌ Anti-raid system not available.' });
                }
                break;

            case 'masskick':
                // Get flagged users from recent raid detection
                const recentJoins = bot.antiRaid?.joins60s?.get(guild.id) || [];
                const flagged = recentJoins.filter(j => j.accountAge < 24 * 60 * 60 * 1000);
                
                if (flagged.length === 0) {
                    return interaction.editReply({ content: 'ℹ️ No flagged users to kick.' });
                }

                let kickCount = 0;
                for (const join of flagged) {
                    try {
                        const targetMember = await guild.members.fetch(join.userId).catch(() => null);
                        if (targetMember) {
                            await targetMember.kick(`Raid protection: mass kick by ${member.user.tag}`);
                            kickCount++;
                        }
                    } catch (e) {
                        // Skip if can't kick
                    }
                }
                await interaction.editReply({ content: `✅ Kicked ${kickCount}/${flagged.length} flagged users.` });
                break;

            case 'massban':
                if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return interaction.editReply({ content: '❌ You need Ban Members permission.' });
                }

                const recentJoinsBan = bot.antiRaid?.joins60s?.get(guild.id) || [];
                const flaggedBan = recentJoinsBan.filter(j => j.accountAge < 24 * 60 * 60 * 1000);
                
                if (flaggedBan.length === 0) {
                    return interaction.editReply({ content: 'ℹ️ No flagged users to ban.' });
                }

                let banCount = 0;
                for (const join of flaggedBan) {
                    try {
                        await guild.members.ban(join.userId, { 
                            reason: `Raid protection: mass ban by ${member.user.tag}`,
                            deleteMessageSeconds: 86400
                        });
                        banCount++;
                    } catch (e) {
                        // Skip if can't ban
                    }
                }
                await interaction.editReply({ content: `✅ Banned ${banCount}/${flaggedBan.length} flagged users.` });
                break;

            case 'approve':
                // Mark as false alarm - clear raid tracking
                if (bot.antiRaid) {
                    bot.antiRaid.joins10s?.delete(guild.id);
                    bot.antiRaid.joins30s?.delete(guild.id);
                    bot.antiRaid.joins60s?.delete(guild.id);
                    bot.antiRaid.joins5m?.delete(guild.id);
                    await bot.antiRaid.restoreLockdown(guild);
                }
                await interaction.editReply({ content: '✅ Marked as false alarm. Lockdown lifted and tracking cleared.' });
                break;

            default:
                await interaction.editReply({ content: '❌ Unknown raid action.' });
        }

        // Update original message
        await updateNotificationMessage(interaction, member, action.toUpperCase());

    } catch (error) {
        bot.logger.error('Error handling raid action:', error);
        await interaction.editReply({ content: `❌ Failed: ${error.message}` });
    }
}

/**
 * Handle anti-nuke action buttons
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleNukeAction(interaction, bot) {
    const { customId, member, guild } = interaction;

    // Check if user has admin permissions
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
            content: '❌ You need Administrator permission to use these actions.',
            ephemeral: true
        });
    }

    const parts = customId.split('_');
    const action = parts[1]; // restore, ban, striproles, whitelist
    const targetUserId = parts[parts.length - 1];

    await interaction.deferReply({ ephemeral: true });

    try {
        const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
        const targetUser = targetMember?.user || await bot.client.users.fetch(targetUserId).catch(() => null);

        switch (action) {
            case 'restore':
                // Trigger manual restoration (if implemented in antiNuke)
                if (bot.antiNuke?.manualRestore) {
                    const result = await bot.antiNuke.manualRestore(guild, targetUserId);
                    await interaction.editReply({ 
                        content: `✅ Restoration attempted.\nSuccess: ${result?.success || 0}\nFailed: ${result?.failed || 0}` 
                    });
                } else {
                    await interaction.editReply({ content: 'ℹ️ Manual restoration not available. Check audit logs for deleted resources.' });
                }
                break;

            case 'ban':
                if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return interaction.editReply({ content: '❌ You need Ban Members permission.' });
                }

                await guild.members.ban(targetUserId, {
                    reason: `Anti-nuke action by ${member.user.tag}`,
                    deleteMessageSeconds: 0
                });

                await bot.database.run(`
                    INSERT INTO mod_actions (guild_id, action_type, target_user_id, moderator_id, reason)
                    VALUES (?, ?, ?, ?, ?)
                `, [guild.id, 'BAN', targetUserId, member.id, 'Anti-nuke: manual ban']);

                await interaction.editReply({ content: `✅ Banned ${targetUser?.tag || targetUserId}` });
                break;

            case 'striproles':
                if (!targetMember) {
                    return interaction.editReply({ content: '❌ User not in server.' });
                }

                const removable = targetMember.roles.cache.filter(r => r.id !== guild.id && r.editable);
                await targetMember.roles.remove(removable, `Anti-nuke: roles stripped by ${member.user.tag}`);
                await interaction.editReply({ content: `✅ Removed ${removable.size} roles from ${targetUser?.tag || targetUserId}` });
                break;

            case 'whitelist':
                // Add to anti-nuke whitelist
                if (bot.antiNuke) {
                    if (!bot.antiNuke.whitelistedUsers.has(guild.id)) {
                        bot.antiNuke.whitelistedUsers.set(guild.id, new Set());
                    }
                    bot.antiNuke.whitelistedUsers.get(guild.id).add(targetUserId);
                    
                    // Also save to database
                    const config = await bot.database.getGuildConfig(guild.id);
                    let whitelist = [];
                    try { whitelist = JSON.parse(config.antinuke_whitelist || '[]'); } catch (e) {}
                    if (!whitelist.includes(targetUserId)) {
                        whitelist.push(targetUserId);
                        await bot.database.run(
                            'UPDATE guild_configs SET antinuke_whitelist = ? WHERE guild_id = ?',
                            [JSON.stringify(whitelist), guild.id]
                        );
                    }
                }
                await interaction.editReply({ content: `✅ Added ${targetUser?.tag || targetUserId} to anti-nuke whitelist.` });
                break;

            default:
                await interaction.editReply({ content: '❌ Unknown nuke action.' });
        }

        await updateNotificationMessage(interaction, member, action.toUpperCase());

    } catch (error) {
        bot.logger.error('Error handling nuke action:', error);
        await interaction.editReply({ content: `❌ Failed: ${error.message}` });
    }
}

/**
 * Handle anti-link action buttons
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleLinkAction(interaction, bot) {
    const { customId, member, guild } = interaction;

    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: '❌ You need Moderate Members permission to use these actions.',
            ephemeral: true
        });
    }

    const parts = customId.split('_');
    const action = parts[1]; // kick, ban, whitelist, false

    await interaction.deferReply({ ephemeral: true });

    try {
        if (action === 'whitelist') {
            // Format: link_whitelist_guildId_domain
            const domain = decodeURIComponent(parts[3] || '');
            if (!domain) {
                return interaction.editReply({ content: '❌ No domain to whitelist.' });
            }

            const config = await bot.database.getGuildConfig(guild.id);
            let allowed = [];
            try { allowed = JSON.parse(config.antilinks_allowed_domains || '[]'); } catch (e) {}
            
            if (!allowed.includes(domain)) {
                allowed.push(domain);
                await bot.database.run(
                    'UPDATE guild_configs SET antilinks_allowed_domains = ? WHERE guild_id = ?',
                    [JSON.stringify(allowed), guild.id]
                );
            }
            
            await interaction.editReply({ content: `✅ Added \`${domain}\` to allowed domains.` });
        } else {
            const targetUserId = parts[parts.length - 1];
            const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
            const targetUser = targetMember?.user || await bot.client.users.fetch(targetUserId).catch(() => null);

            switch (action) {
                case 'kick':
                    if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                        return interaction.editReply({ content: '❌ You need Kick Members permission.' });
                    }
                    if (!targetMember) {
                        return interaction.editReply({ content: '❌ User not in server.' });
                    }
                    await targetMember.kick(`Link violation: kicked by ${member.user.tag}`);
                    await interaction.editReply({ content: `✅ Kicked ${targetUser?.tag || targetUserId}` });
                    break;

                case 'ban':
                    if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                        return interaction.editReply({ content: '❌ You need Ban Members permission.' });
                    }
                    await guild.members.ban(targetUserId, {
                        reason: `Link violation: banned by ${member.user.tag}`,
                        deleteMessageSeconds: 86400
                    });
                    await interaction.editReply({ content: `✅ Banned ${targetUser?.tag || targetUserId}` });
                    break;

                case 'false':
                    // Mark as false positive - just acknowledge
                    await interaction.editReply({ content: '✅ Marked as false positive. No action taken.' });
                    break;

                default:
                    await interaction.editReply({ content: '❌ Unknown link action.' });
            }
        }

        await updateNotificationMessage(interaction, member, action.toUpperCase());

    } catch (error) {
        bot.logger.error('Error handling link action:', error);
        await interaction.editReply({ content: `❌ Failed: ${error.message}` });
    }
}

/**
 * Handle verification action buttons
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleVerifyAction(interaction, bot) {
    const { customId, member, guild } = interaction;

    if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({
            content: '❌ You need Manage Roles permission to use these actions.',
            ephemeral: true
        });
    }

    const parts = customId.split('_');
    const action = parts[1]; // approve, reject, ban
    const targetGuildId = parts[2];
    const targetUserId = parts[3] || parts[2]; // For ban, userId is at position 2

    await interaction.deferReply({ ephemeral: true });

    try {
        const targetGuild = bot.client.guilds.cache.get(targetGuildId) || guild;
        const targetMember = await targetGuild.members.fetch(targetUserId).catch(() => null);
        const targetUser = targetMember?.user || await bot.client.users.fetch(targetUserId).catch(() => null);

        switch (action) {
            case 'approve':
                if (!targetMember) {
                    return interaction.editReply({ content: '❌ User not in server.' });
                }
                
                if (bot.userVerification?.markVerified) {
                    await bot.userVerification.markVerified(targetMember, 'manual_approve');
                }
                
                await interaction.editReply({ content: `✅ Verified ${targetUser?.tag || targetUserId}` });
                break;

            case 'reject':
                if (!targetMember) {
                    return interaction.editReply({ content: '❌ User not in server.' });
                }
                
                await targetMember.kick(`Verification rejected by ${member.user.tag}`);
                await interaction.editReply({ content: `✅ Rejected and kicked ${targetUser?.tag || targetUserId}` });
                break;

            case 'ban':
                if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return interaction.editReply({ content: '❌ You need Ban Members permission.' });
                }

                await targetGuild.members.ban(targetUserId, {
                    reason: `Verification ban by ${member.user.tag}`,
                    deleteMessageSeconds: 0
                });
                await interaction.editReply({ content: `✅ Banned ${targetUser?.tag || targetUserId}` });
                break;

            default:
                await interaction.editReply({ content: '❌ Unknown verify action.' });
        }

        await updateNotificationMessage(interaction, member, action.toUpperCase());

    } catch (error) {
        bot.logger.error('Error handling verify action:', error);
        await interaction.editReply({ content: `❌ Failed: ${error.message}` });
    }
}

/**
 * Helper to update notification message after action is taken
 */
async function updateNotificationMessage(interaction, member, actionTaken) {
    try {
        const originalEmbed = interaction.message?.embeds?.[0];
        if (!originalEmbed) return;

        const updatedEmbed = new EmbedBuilder(originalEmbed.data)
            .setColor(0x10b981) // Green
            .addFields({
                name: '✅ Action Taken',
                value: `**${member.user.tag}** used: **${actionTaken}**`,
                inline: false
            });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [] // Remove buttons after action
        });
    } catch (e) {
        // Failed to update original message - ignore
    }
}

module.exports = {
    handleButtonInteraction,
    handleSpamAction,
    handleRaidAction,
    handleNukeAction,
    handleLinkAction,
    handleVerifyAction,
    updateNotificationMessage
};