const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverbackup')
        .setDescription('Server backup and restore management')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Create a full server backup (roles, channels, settings, emojis) - Anti-Nuke compatible')
            .addStringOption(opt => opt
                .setName('description')
                .setDescription('Description for this backup'))
            .addBooleanOption(opt => opt
                .setName('include_bans')
                .setDescription('Include ban list in backup (default: yes)')))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all backups for this server'))
        .addSubcommand(sub => sub
            .setName('info')
            .setDescription('View details of a specific backup')
            .addStringOption(opt => opt
                .setName('backup_id')
                .setDescription('Backup ID to view')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('restore')
            .setDescription('Restore from a backup')
            .addStringOption(opt => opt
                .setName('backup_id')
                .setDescription('Backup ID to restore')
                .setRequired(true))
            .addBooleanOption(opt => opt
                .setName('restore_roles')
                .setDescription('Restore roles'))
            .addBooleanOption(opt => opt
                .setName('restore_channels')
                .setDescription('Restore channels'))
            .addBooleanOption(opt => opt
                .setName('restore_settings')
                .setDescription('Restore server settings')))
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete a backup')
            .addStringOption(opt => opt
                .setName('backup_id')
                .setDescription('Backup ID to delete')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure automatic backups')
            .addBooleanOption(opt => opt
                .setName('auto_backup')
                .setDescription('Enable automatic backups'))
            .addIntegerOption(opt => opt
                .setName('interval')
                .setDescription('Hours between auto backups')
                .setMinValue(1)
                .setMaxValue(168))
            .addIntegerOption(opt => opt
                .setName('max_backups')
                .setDescription('Maximum number of backups to keep')
                .setMinValue(1)
                .setMaxValue(20)))
        .addSubcommand(sub => sub
            .setName('verify')
            .setDescription('Verify backup integrity using SHA-256 checksum')
            .addStringOption(opt => opt
                .setName('backup_id')
                .setDescription('Backup ID to verify')
                .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const backup = interaction.client.serverBackup;

        if (!backup) {
            return interaction.reply({ content: '❌ Backup system is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'create':
                return this.handleCreate(interaction, backup);
            case 'list':
                return this.handleList(interaction, backup);
            case 'info':
                return this.handleInfo(interaction, backup);
            case 'restore':
                return this.handleRestore(interaction, backup);
            case 'delete':
                return this.handleDelete(interaction, backup);
            case 'setup':
                return this.handleSetup(interaction, backup);
            case 'verify':
                return this.handleVerify(interaction, backup);
        }
    },

    async handleCreate(interaction, backup) {
        const description = interaction.options.getString('description');
        const includeBans = interaction.options.getBoolean('include_bans') ?? true; // Default to true for full backup

        await interaction.deferReply();

        // Check for duplicate backup
        const duplicateCheck = await backup.checkDuplicateBackup(interaction.guildId);
        if (duplicateCheck.isDuplicate) {
            return interaction.editReply({ 
                content: `⚠️ ${duplicateCheck.message}. Use \`/serverbackup list\` to see existing backups.\n\nIf you want to create another backup anyway, wait a few minutes.` 
            });
        }

        // Create FULL backup with all components (anti-nuke compatible)
        const result = await backup.createBackup(interaction.guildId, {
            createdBy: interaction.user.id,
            description,
            includeBans,
            includeRoles: true,      // Always include roles
            includeChannels: true,   // Always include channels  
            includeSettings: true,   // Always include settings
            includeEmojis: true,     // Always include emojis
            type: 'manual'
        });

        if (!result.success) {
            return interaction.editReply({ content: `❌ ${result.error}` });
        }

        // Also refresh anti-nuke live snapshots for consistency
        const antiNuke = interaction.client.antiNuke;
        if (antiNuke) {
            try {
                await antiNuke.snapshotChannels(interaction.guild);
                await antiNuke.snapshotRoles(interaction.guild);
                interaction.client.bot?.logger?.info(`[Backup] Refreshed anti-nuke snapshots for ${interaction.guild.name}`);
            } catch (e) {
                // Non-critical, continue
            }
        }

        // Count what was backed up
        const backupData = await backup.getBackupData(result.backupId);
        const roleCount = backupData?.data?.roles?.length || 0;
        const channelCount = (backupData?.data?.channels?.categories?.length || 0) + 
                            (backupData?.data?.channels?.channels?.length || 0);
        const banCount = backupData?.data?.bans?.length || 0;
        const emojiCount = backupData?.data?.emojis?.length || 0;

        const embed = new EmbedBuilder()
            .setTitle('✅ Full Server Backup Created')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Backup ID', value: `\`${result.backupId}\``, inline: true },
                { name: 'Size', value: `${(result.size / 1024).toFixed(2)} KB`, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: '📋 Roles', value: `${roleCount} roles`, inline: true },
                { name: '📁 Channels', value: `${channelCount} channels`, inline: true },
                { name: '🚫 Bans', value: includeBans ? `${banCount} bans` : 'Not included', inline: true },
                { name: '😀 Emojis', value: `${emojiCount} emojis`, inline: true },
                { name: '⚙️ Settings', value: 'Included', inline: true },
                { name: '🛡️ Anti-Nuke', value: 'Compatible ✅', inline: true }
            )
            .setTimestamp();

        if (result.checksum) {
            embed.addFields({ 
                name: '🔐 Integrity Hash (SHA-256)', 
                value: `\`${result.checksum.substring(0, 16)}...${result.checksum.substring(result.checksum.length - 16)}\`\nBackup verified & tamper-protected.`, 
                inline: false 
            });
        }

        if (description) {
            embed.setDescription(`📝 ${description}`);
        }

        embed.setFooter({ text: 'This backup can be used by Anti-Nuke for automatic restoration' });

        return interaction.editReply({ embeds: [embed] });
    },

    async handleList(interaction, backup) {
        await interaction.deferReply();

        const backups = await backup.listBackups(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle('📦 Server Backups')
            .setColor(0x5865F2)
            .setTimestamp();

        if (backups.length === 0) {
            embed.setDescription('No backups found. Create one with `/serverbackup create`');
        } else {
            const list = backups.slice(0, 10).map((b, i) => {
                const date = new Date(b.created_at);
                const size = b.size_bytes ? `${(b.size_bytes / 1024).toFixed(1)}KB` : 'Unknown';
                return `**${i + 1}.** \`${b.id.substring(0, 20)}...\`\n↳ ${b.backup_type} • ${size} • <t:${Math.floor(date.getTime() / 1000)}:R>`;
            }).join('\n\n');

            embed.setDescription(list);
            embed.setFooter({ text: `Total: ${backups.length} backup(s)` });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleInfo(interaction, backup) {
        const backupId = interaction.options.getString('backup_id');

        await interaction.deferReply();

        const info = await backup.getBackupInfo(backupId, interaction.guildId);
        const result = await backup.getBackupDataWithVerification(backupId, true);

        if (!info || !result) {
            return interaction.editReply({ content: '❌ Backup not found.' });
        }

        const { data, integrity } = result;

        const embed = new EmbedBuilder()
            .setTitle(`📦 Backup Details`)
            .setColor(integrity.valid ? 0x5865F2 : (integrity.legacy ? 0xFFAA00 : 0xFF0000))
            .addFields(
                { name: 'Backup ID', value: `\`${info.id}\``, inline: false },
                { name: 'Type', value: info.backup_type, inline: true },
                { name: 'Created By', value: info.created_by ? `<@${info.created_by}>` : 'System', inline: true },
                { name: 'Size', value: `${(info.size_bytes / 1024).toFixed(2)} KB`, inline: true },
                { name: 'Created At', value: `<t:${Math.floor(new Date(info.created_at).getTime() / 1000)}:F>`, inline: false },
                { 
                    name: '🔐 Integrity', 
                    value: integrity.valid ? '✅ Verified' : (integrity.legacy ? '⚠️ Legacy (No Hash)' : '❌ Failed'), 
                    inline: true 
                }
            )
            .setTimestamp();

        if (info.checksum) {
            embed.addFields({ name: 'Checksum', value: `\`${info.checksum.substring(0, 32)}...\``, inline: true });
        }

        if (info.description) {
            embed.setDescription(info.description);
        }

        // Add backup contents summary
        const contents = [];
        if (data.data.roles) contents.push(`**Roles:** ${data.data.roles.length}`);
        if (data.data.channels?.channels) contents.push(`**Channels:** ${data.data.channels.channels.length}`);
        if (data.data.channels?.categories) contents.push(`**Categories:** ${data.data.channels.categories.length}`);
        if (data.data.emojis) contents.push(`**Emojis:** ${data.data.emojis.length}`);
        if (data.data.bans) contents.push(`**Bans:** ${data.data.bans.length}`);

        if (contents.length > 0) {
            embed.addFields({ name: 'Contents', value: contents.join('\n'), inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleRestore(interaction, backup) {
        const backupId = interaction.options.getString('backup_id');
        const restoreRoles = interaction.options.getBoolean('restore_roles') ?? true;
        const restoreChannels = interaction.options.getBoolean('restore_channels') ?? true;
        const restoreSettings = interaction.options.getBoolean('restore_settings') ?? false;

        // Verify backup exists
        const info = await backup.getBackupInfo(backupId, interaction.guildId);
        if (!info) {
            return interaction.reply({ content: '❌ Backup not found.', ephemeral: true });
        }

        // Confirmation embed
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Restore')
            .setColor(0xFFCC00)
            .setDescription('Are you sure you want to restore this backup?\n\n**This may create duplicate roles and channels if they already exist.**')
            .addFields(
                { name: 'Backup', value: backupId, inline: false },
                { name: 'Restore Roles', value: restoreRoles ? '✅' : '❌', inline: true },
                { name: 'Restore Channels', value: restoreChannels ? '✅' : '❌', inline: true },
                { name: 'Restore Settings', value: restoreSettings ? '✅' : '❌', inline: true }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`backup_confirm_${backupId}_${restoreRoles ? 1 : 0}_${restoreChannels ? 1 : 0}_${restoreSettings ? 1 : 0}`)
                .setLabel('Confirm Restore')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId('backup_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        // Wait for confirmation
        const filter = i => i.user.id === interaction.user.id;
        
        try {
            const confirmation = await response.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === 'backup_cancel') {
                await confirmation.update({ content: '❌ Restore cancelled.', embeds: [], components: [] });
                return;
            }

            if (confirmation.customId.startsWith('backup_confirm_')) {
                await confirmation.update({ content: '🔄 Restoring backup... This may take a moment.', embeds: [], components: [] });

                const result = await backup.restoreBackup(interaction.guildId, backupId, {
                    restoreRoles,
                    restoreChannels,
                    restoreSettings
                });

                if (!result.success) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ Restore Failed')
                        .setColor(0xFF0000)
                        .setDescription(result.error)
                        .setTimestamp();
                    
                    if (result.results?.logs?.length > 0) {
                        const logPreview = result.results.logs.slice(-5).join('\n');
                        errorEmbed.addFields({ name: 'Recent Logs', value: `\`\`\`\n${logPreview}\n\`\`\``, inline: false });
                    }
                    
                    await interaction.editReply({ embeds: [errorEmbed] });
                    return;
                }

                const r = result.results;
                const resultEmbed = new EmbedBuilder()
                    .setTitle('✅ Restore Complete')
                    .setColor(0x00FF00)
                    .addFields(
                        { 
                            name: '👥 Roles', 
                            value: `✅ Created: ${r.roles.created}\n⏭️ Skipped: ${r.roles.skipped}\n❌ Failed: ${r.roles.failed}`, 
                            inline: true 
                        },
                        { 
                            name: '📁 Channels', 
                            value: `✅ Created: ${r.channels.created}\n⏭️ Skipped: ${r.channels.skipped}\n❌ Failed: ${r.channels.failed}`, 
                            inline: true 
                        },
                        { 
                            name: '⚙️ Settings', 
                            value: r.settings.restored ? '✅ Restored' : `❌ ${r.settings.error || 'Skipped'}`, 
                            inline: true 
                        }
                    )
                    .setTimestamp();

                // Add error details if any
                if (r.roles.errors.length > 0 || r.channels.errors.length > 0) {
                    const errors = [...r.roles.errors.slice(0, 3), ...r.channels.errors.slice(0, 3)];
                    if (errors.length > 0) {
                        resultEmbed.addFields({ 
                            name: '⚠️ Errors', 
                            value: errors.join('\n').substring(0, 1000), 
                            inline: false 
                        });
                    }
                }

                await interaction.editReply({ embeds: [resultEmbed] });
            }
        } catch (error) {
            await interaction.editReply({ content: '❌ Confirmation timed out.', embeds: [], components: [] });
        }
    },

    async handleDelete(interaction, backup) {
        const backupId = interaction.options.getString('backup_id');

        await interaction.deferReply();

        const deleted = await backup.deleteBackup(backupId, interaction.guildId);

        if (deleted) {
            return interaction.editReply({ content: `✅ Backup \`${backupId}\` deleted.` });
        } else {
            return interaction.editReply({ content: '❌ Backup not found or already deleted.' });
        }
    },

    async handleSetup(interaction, backup) {
        const autoBackup = interaction.options.getBoolean('auto_backup');
        const interval = interaction.options.getInteger('interval');
        const maxBackups = interaction.options.getInteger('max_backups');

        await interaction.deferReply();

        if (autoBackup === null && interval === null && maxBackups === null) {
            // Show current config
            const config = await backup.getConfig(interaction.guildId);

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Backup Configuration')
                .setColor(0x5865F2)
                .setTimestamp();

            if (!config) {
                embed.setDescription('No backup configuration set. Use options to configure.');
            } else {
                embed.addFields(
                    { name: 'Auto Backup', value: config.auto_backup_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Interval', value: `${config.auto_backup_interval_hours} hours`, inline: true },
                    { name: 'Max Backups', value: `${config.max_backups}`, inline: true }
                );

                if (config.last_auto_backup) {
                    embed.addFields({ 
                        name: 'Last Auto Backup', 
                        value: `<t:${Math.floor(new Date(config.last_auto_backup).getTime() / 1000)}:R>`, 
                        inline: false 
                    });
                }
            }

            return interaction.editReply({ embeds: [embed] });
        }

        const settings = {};
        if (autoBackup !== null) settings.autoEnabled = autoBackup;
        if (interval !== null) settings.interval = interval;
        if (maxBackups !== null) settings.maxBackups = maxBackups;

        await backup.setup(interaction.guildId, settings);

        const embed = new EmbedBuilder()
            .setTitle('✅ Configuration Updated')
            .setColor(0x00FF00)
            .setTimestamp();

        const changes = [];
        if (autoBackup !== null) changes.push(`Auto backup: ${autoBackup ? '✅ Enabled' : '❌ Disabled'}`);
        if (interval !== null) changes.push(`Interval: ${interval} hours`);
        if (maxBackups !== null) changes.push(`Max backups: ${maxBackups}`);

        embed.setDescription(changes.join('\n'));

        return interaction.editReply({ embeds: [embed] });
    },

    async handleVerify(interaction, backup) {
        const backupId = interaction.options.getString('backup_id');

        await interaction.deferReply();

        // Use the new integrity-verified method
        const result = await backup.getBackupDataWithVerification(backupId, true);

        if (!result) {
            return interaction.editReply({ content: '❌ Backup not found or failed to load.' });
        }

        const { data, integrity } = result;

        const embed = new EmbedBuilder()
            .setTitle(`🔐 Backup Integrity Check`)
            .setColor(integrity.valid ? 0x00FF00 : (integrity.legacy ? 0xFFAA00 : 0xFF0000))
            .addFields(
                { name: 'Backup ID', value: `\`${backupId}\``, inline: false },
                { 
                    name: 'Status', 
                    value: integrity.valid ? '✅ Integrity Verified' : 
                           (integrity.legacy ? '⚠️ Legacy Backup (No Hash)' : '❌ Integrity Failed'),
                    inline: true 
                },
                { name: 'Reason', value: integrity.reason, inline: true }
            )
            .setTimestamp();

        if (integrity.storedHash) {
            embed.addFields({ 
                name: 'Stored Hash (DB)', 
                value: `\`${integrity.storedHash.substring(0, 32)}...\``, 
                inline: false 
            });
        }

        if (integrity.computedHash) {
            embed.addFields({ 
                name: 'Computed Hash', 
                value: `\`${integrity.computedHash.substring(0, 32)}...\``, 
                inline: false 
            });
        }

        if (integrity.embeddedHash) {
            embed.addFields({ 
                name: 'Embedded Hash (File)', 
                value: `\`${integrity.embeddedHash.substring(0, 32)}...\``, 
                inline: false 
            });
        }

        // Add backup info
        if (data) {
            const ageHours = (Date.now() - new Date(data.createdAt).getTime()) / (1000 * 60 * 60);
            embed.addFields(
                { name: 'Backup Age', value: `${Math.round(ageHours)} hours`, inline: true },
                { name: 'Server', value: data.guildName || 'Unknown', inline: true }
            );
        }

        if (!integrity.valid && !integrity.legacy) {
            embed.addFields({
                name: '⚠️ Warning',
                value: 'This backup may have been corrupted or tampered with.\n**Do NOT use for restoration without manual review.**',
                inline: false
            });
        }

        return interaction.editReply({ embeds: [embed] });
    }
};
