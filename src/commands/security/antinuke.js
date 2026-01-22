const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Advanced anti-nuke protection settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable anti-nuke protection'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable anti-nuke protection'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show current anti-nuke status and statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('quarantine')
                .setDescription('Control quarantine mode (emergency permission lockdown)')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Enable or disable quarantine mode')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Enable', value: 'enable' },
                            { name: 'Disable', value: 'disable' },
                            { name: 'Status', value: 'status' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('whitelist')
                .setDescription('Add a user to the anti-nuke whitelist')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to whitelist')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unwhitelist')
                .setDescription('Remove a user from the anti-nuke whitelist')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove from whitelist')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restore')
                .setDescription('Restore deleted channels/roles from snapshot')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Type of resource to restore')
                        .setRequired(true)
                        .addChoices(
                            { name: 'All from backup', value: 'backup' },
                            { name: 'Refresh snapshots', value: 'refresh' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('settings')
                .setDescription('Configure anti-nuke thresholds')
                .addIntegerOption(option =>
                    option.setName('role_delete_limit')
                        .setDescription('Max role deletions before action (default: 2)')
                        .setMinValue(1)
                        .setMaxValue(10))
                .addIntegerOption(option =>
                    option.setName('channel_delete_limit')
                        .setDescription('Max channel deletions before action (default: 2)')
                        .setMinValue(1)
                        .setMaxValue(10))
                .addIntegerOption(option =>
                    option.setName('ban_limit')
                        .setDescription('Max bans before action (default: 3)')
                        .setMinValue(1)
                        .setMaxValue(20)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('incidents')
                .setDescription('View recent anti-nuke incidents and response details')
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of incidents to show (default: 5)')
                        .setMinValue(1)
                        .setMaxValue(20))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'enable') {
            try {
                await bot.database.run(`
                    UPDATE guild_configs SET antinuke_enabled = 1 WHERE guild_id = ?
                `, [interaction.guild.id]);

                // Initialize snapshots immediately
                if (bot.antiNuke && bot.antiNuke.initializeGuild) {
                    await bot.antiNuke.initializeGuild(interaction.guild);
                }

                // Send event to dashboard for real-time sync
                if (typeof bot.emitSettingChange === 'function') {
                    await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'antinuke_enabled', 1, null, 'security');
                }

                const channelCount = bot.antiNuke?.channelSnapshots?.get(interaction.guild.id)?.size || 0;
                const roleCount = bot.antiNuke?.roleSnapshots?.get(interaction.guild.id)?.size || 0;

                await interaction.reply({
                    content: `🛡️ Anti-nuke protection **ENABLED**\n\n` +
                        `**Live Snapshots Created:**\n` +
                        `📁 ${channelCount} channels\n` +
                        `🎭 ${roleCount} roles\n\n` +
                        `The bot will now monitor for:\n` +
                        `• Mass channel/role deletions (limit: 2 in 8s)\n` +
                        `• Mass channel/role creations (limit: 4 in 10s)\n` +
                        `• Mass member bans/kicks (limit: 3 in 10s)\n` +
                        `• Dangerous permission grants\n` +
                        `• Bot flood attacks\n` +
                        `• Webhook spam\n\n` +
                        `**Response:** Quarantine → Ban attacker → Restore damage`,
                    ephemeral: false
                });
            } catch (error) {
                bot.logger?.error('Error enabling anti-nuke:', error);
                await interaction.reply({
                    content: '❌ Failed to enable anti-nuke protection',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'disable') {
            try {
                await bot.database.run(`
                    UPDATE guild_configs SET antinuke_enabled = 0 WHERE guild_id = ?
                `, [interaction.guild.id]);

                if (typeof bot.emitSettingChange === 'function') {
                    await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'antinuke_enabled', 0, null, 'security');
                }

                await interaction.reply({
                    content: '⚠️ Anti-nuke protection **DISABLED**\n\nYour server is no longer protected against nuke attacks.',
                    ephemeral: false
                });
            } catch (error) {
                bot.logger?.error('Error disabling anti-nuke:', error);
                await interaction.reply({
                    content: '❌ Failed to disable anti-nuke protection',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'status') {
            try {
                const config = await bot.database.getGuildConfig(interaction.guild.id);
                const enabled = config?.antinuke_enabled;
                const isQuarantined = bot.antiNuke?.isInQuarantine?.(interaction.guild.id);
                const isInRepair = bot.antiNuke?.isInRepairMode?.(interaction.guild.id);
                const channelCount = bot.antiNuke?.channelSnapshots?.get(interaction.guild.id)?.size || 0;
                const roleCount = bot.antiNuke?.roleSnapshots?.get(interaction.guild.id)?.size || 0;
                const blockedCount = bot.antiNuke?.blockedUsers?.get(interaction.guild.id)?.size || 0;
                const activeIncidents = bot.antiNuke?.activeIncidents?.size || 0;

                // Get recent incident count
                let recentIncidentCount = 0;
                try {
                    const result = await bot.database.get(`
                        SELECT COUNT(*) as count FROM antinuke_incidents 
                        WHERE guild_id = ? AND detected_at > datetime('now', '-7 days')
                    `, [interaction.guild.id]);
                    recentIncidentCount = result?.count || 0;
                } catch (e) {}

                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Anti-Nuke Status v2.1')
                    .setColor(enabled ? (isQuarantined ? '#FF0000' : '#00FF00') : '#FF6B6B')
                    .addFields(
                        { name: 'Protection', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: 'Quarantine Mode', value: isQuarantined ? '🔒 ACTIVE' : '🔓 Inactive', inline: true },
                        { name: 'Repair Mode', value: isInRepair ? '🔧 Active' : '⚪ Idle', inline: true },
                        { name: 'Channel Snapshots', value: `${channelCount}`, inline: true },
                        { name: 'Role Snapshots', value: `${roleCount}`, inline: true },
                        { name: 'Blocked Users', value: `${blockedCount}`, inline: true },
                        { name: 'Detection Limits', value: 
                            `Channel: ${config?.antinuke_channel_limit || 2}/8s\n` +
                            `Role: ${config?.antinuke_role_limit || 2}/8s\n` +
                            `Ban: ${config?.antinuke_ban_limit || 3}/10s`, inline: true },
                        { name: 'Safety Features', value:
                            `✅ Repair Lock\n` +
                            `✅ Backup Validation\n` +
                            `✅ Diff-based Restore\n` +
                            `✅ Incident Tracking`, inline: true },
                        { name: 'Recent Incidents', value: 
                            `Active: ${activeIncidents}\n` +
                            `Last 7 days: ${recentIncidentCount}`, inline: true }
                    )
                    .setFooter({ text: 'Use /antinuke incidents to view incident details' })
                    .setTimestamp();

                if (isQuarantined) {
                    embed.addFields({
                        name: '⚠️ Quarantine Active',
                        value: 'Dangerous permissions have been stripped from all roles.\nUse `/antinuke quarantine disable` when safe.',
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed], ephemeral: false });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to fetch status',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'quarantine') {
            const action = interaction.options.getString('action');

            if (action === 'enable') {
                if (!bot.antiNuke) {
                    return interaction.reply({ content: '❌ Anti-nuke system not available', ephemeral: true });
                }

                await interaction.deferReply();

                try {
                    const result = await bot.antiNuke.activateQuarantine(interaction.guild, interaction.user.id);

                    if (result.success) {
                        await interaction.editReply({
                            content: `🔒 **QUARANTINE MODE ACTIVATED**\n\n` +
                                `${result.rolesModified} roles had dangerous permissions removed:\n` +
                                `• Administrator\n• Manage Guild\n• Manage Channels\n• Manage Roles\n• Ban/Kick Members\n• Manage Webhooks\n\n` +
                                `⚠️ Use \`/antinuke quarantine disable\` to restore permissions when safe.`
                        });
                    } else {
                        await interaction.editReply({
                            content: `❌ Failed to activate quarantine: ${result.error || result.message}`
                        });
                    }
                } catch (error) {
                    await interaction.editReply({ content: `❌ Error: ${error.message}` });
                }
            } else if (action === 'disable') {
                if (!bot.antiNuke) {
                    return interaction.reply({ content: '❌ Anti-nuke system not available', ephemeral: true });
                }

                await interaction.deferReply();

                try {
                    const result = await bot.antiNuke.deactivateQuarantine(interaction.guild, interaction.user.id);

                    if (result.success) {
                        await interaction.editReply({
                            content: `🔓 **QUARANTINE MODE DEACTIVATED**\n\n` +
                                `${result.rolesRestored} roles had permissions restored.\n` +
                                `All blocked users have been unblocked.`
                        });
                    } else {
                        await interaction.editReply({
                            content: `❌ Failed to deactivate quarantine: ${result.error}`
                        });
                    }
                } catch (error) {
                    await interaction.editReply({ content: `❌ Error: ${error.message}` });
                }
            } else if (action === 'status') {
                const isQuarantined = bot.antiNuke?.isInQuarantine?.(interaction.guild.id);
                const quarantineData = bot.antiNuke?.quarantineMode?.get(interaction.guild.id);

                if (isQuarantined && quarantineData) {
                    const triggeredAt = new Date(quarantineData.triggeredAt).toLocaleString();
                    await interaction.reply({
                        content: `🔒 **Quarantine Status: ACTIVE**\n\n` +
                            `Triggered by: <@${quarantineData.triggeredBy}>\n` +
                            `Activated at: ${triggeredAt}\n\n` +
                            `Use \`/antinuke quarantine disable\` to restore permissions.`,
                        ephemeral: false
                    });
                } else {
                    await interaction.reply({
                        content: `🔓 **Quarantine Status: Inactive**\n\nServer is operating normally.`,
                        ephemeral: false
                    });
                }
            }
        } else if (subcommand === 'whitelist') {
            const user = interaction.options.getUser('user');

            try {
                await bot.database.run(`
                    INSERT OR IGNORE INTO antinuke_whitelist (guild_id, user_id)
                    VALUES (?, ?)
                `, [interaction.guild.id, user.id]);

                // Also update in-memory whitelist
                if (bot.antiNuke && bot.antiNuke.whitelistUser) {
                    await bot.antiNuke.whitelistUser(interaction.guild.id, user.id);
                }

                await interaction.reply({
                    content: `✅ ${user} added to anti-nuke whitelist\n\nThis user will not trigger anti-nuke protection.`,
                    ephemeral: false
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to whitelist user',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'unwhitelist') {
            const user = interaction.options.getUser('user');

            try {
                await bot.database.run(`
                    DELETE FROM antinuke_whitelist
                    WHERE guild_id = ? AND user_id = ?
                `, [interaction.guild.id, user.id]);

                // Also update in-memory whitelist
                if (bot.antiNuke && bot.antiNuke.unwhitelistUser) {
                    await bot.antiNuke.unwhitelistUser(interaction.guild.id, user.id);
                }

                await interaction.reply({
                    content: `✅ ${user} removed from anti-nuke whitelist`,
                    ephemeral: false
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to remove user from whitelist',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'restore') {
            const type = interaction.options.getString('type');

            if (type === 'refresh') {
                if (!bot.antiNuke) {
                    return interaction.reply({ content: '❌ Anti-nuke system not available', ephemeral: true });
                }

                await interaction.deferReply();

                try {
                    await bot.antiNuke.initializeGuild(interaction.guild);

                    const channelCount = bot.antiNuke.channelSnapshots?.get(interaction.guild.id)?.size || 0;
                    const roleCount = bot.antiNuke.roleSnapshots?.get(interaction.guild.id)?.size || 0;

                    await interaction.editReply({
                        content: `✅ **Snapshots Refreshed**\n\n` +
                            `📁 ${channelCount} channels snapshotted\n` +
                            `🎭 ${roleCount} roles snapshotted\n\n` +
                            `These snapshots will be used for restoration if an attack occurs.`
                    });
                } catch (error) {
                    await interaction.editReply({ content: `❌ Error: ${error.message}` });
                }
            } else if (type === 'backup') {
                if (!bot.serverBackup) {
                    return interaction.reply({ content: '❌ Server backup system not available', ephemeral: true });
                }

                await interaction.deferReply();

                try {
                    const backups = await bot.serverBackup.listBackups(interaction.guild.id);

                    if (!backups || backups.length === 0) {
                        return interaction.editReply({
                            content: '❌ No backups found for this server.\n\nUse `/backup create` to create a server backup.'
                        });
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('📦 Available Server Backups')
                        .setColor('#FF6B6B')
                        .setDescription('Use `/backup restore <id>` to restore from a backup.\n\n**Available Backups:**')
                        .setTimestamp();

                    backups.slice(0, 10).forEach((backup, index) => {
                        const date = new Date(backup.created_at || backup.createdAt).toLocaleString();
                        embed.addFields({
                            name: `${index + 1}. ${backup.id}`,
                            value: `Created: ${date}\nChannels: ${backup.channelCount || '?'} | Roles: ${backup.roleCount || '?'}`,
                            inline: false
                        });
                    });

                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    await interaction.editReply({ content: `❌ Error: ${error.message}` });
                }
            }
        } else if (subcommand === 'settings') {
            const roleLimit = interaction.options.getInteger('role_delete_limit');
            const channelLimit = interaction.options.getInteger('channel_delete_limit');
            const banLimit = interaction.options.getInteger('ban_limit');

            try {
                const updates = [];
                const eventPromises = [];
                
                if (roleLimit) {
                    updates.push(`antinuke_role_limit = ${roleLimit}`);
                    if (typeof bot.emitSettingChange === 'function') {
                        eventPromises.push(bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'antinuke_role_limit', roleLimit, null, 'security'));
                    }
                }
                if (channelLimit) {
                    updates.push(`antinuke_channel_limit = ${channelLimit}`);
                    if (typeof bot.emitSettingChange === 'function') {
                        eventPromises.push(bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'antinuke_channel_limit', channelLimit, null, 'security'));
                    }
                }
                if (banLimit) {
                    updates.push(`antinuke_ban_limit = ${banLimit}`);
                    if (typeof bot.emitSettingChange === 'function') {
                        eventPromises.push(bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'antinuke_ban_limit', banLimit, null, 'security'));
                    }
                }

                if (updates.length > 0) {
                    await bot.database.run(`
                        UPDATE guild_configs SET ${updates.join(', ')} WHERE guild_id = ?
                    `, [interaction.guild.id]);
                    
                    // Send all events in parallel
                    await Promise.allSettled(eventPromises);
                }

                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Anti-Nuke Settings Updated')
                    .setColor('#FF6B6B')
                    .setDescription('Detection thresholds have been updated. Lower values = faster detection.')
                    .setTimestamp();

                if (roleLimit) embed.addFields({ name: 'Role Delete Limit', value: `${roleLimit} in 8 seconds`, inline: true });
                if (channelLimit) embed.addFields({ name: 'Channel Delete Limit', value: `${channelLimit} in 8 seconds`, inline: true });
                if (banLimit) embed.addFields({ name: 'Ban Limit', value: `${banLimit} in 10 seconds`, inline: true });

                await interaction.reply({ embeds: [embed], ephemeral: false });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to update settings',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'incidents') {
            const count = interaction.options.getInteger('count') || 5;

            try {
                const incidents = await bot.database.all(`
                    SELECT * FROM antinuke_incidents 
                    WHERE guild_id = ? 
                    ORDER BY detected_at DESC 
                    LIMIT ?
                `, [interaction.guild.id, count]);

                if (!incidents || incidents.length === 0) {
                    return interaction.reply({
                        content: '📋 No anti-nuke incidents recorded for this server.',
                        ephemeral: false
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🚨 Recent Anti-Nuke Incidents')
                    .setColor('#FF0000')
                    .setDescription(`Last ${incidents.length} incident(s) detected in this server`)
                    .setTimestamp();

                for (const incident of incidents) {
                    const detectedAt = new Date(incident.detected_at).toLocaleString();
                    const responseTime = incident.response_time_ms ? `${incident.response_time_ms}ms` : 'N/A';
                    const itemsRestored = JSON.parse(incident.items_restored || '[]');
                    const itemsSkipped = JSON.parse(incident.items_skipped || '[]');
                    const warnings = JSON.parse(incident.warnings || '[]');
                    
                    let fieldValue = `**Attacker:** <@${incident.attacker_id}>\n` +
                        `**Type:** ${incident.violation_type} (×${incident.violation_count})\n` +
                        `**Response Time:** ${responseTime}\n` +
                        `**Source:** ${incident.restore_source || 'N/A'}`;
                    
                    if (incident.backup_age_hours) {
                        fieldValue += `\n**Backup Age:** ${Math.round(incident.backup_age_hours)}h`;
                    }
                    
                    fieldValue += `\n**Restored:** ${itemsRestored.length} | **Skipped:** ${itemsSkipped.length}`;
                    
                    if (warnings.length > 0) {
                        fieldValue += `\n⚠️ ${warnings.length} warning(s)`;
                    }

                    embed.addFields({
                        name: `📅 ${detectedAt} - ${incident.incident_id}`,
                        value: fieldValue,
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed], ephemeral: false });
            } catch (error) {
                bot.logger?.error('Error fetching incidents:', error);
                await interaction.reply({
                    content: '❌ Failed to fetch incidents',
                    ephemeral: true
                });
            }
        }
    }
};
