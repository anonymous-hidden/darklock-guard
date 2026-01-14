const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quarantine')
        .setDescription('Quarantine system management')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Quarantine a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to quarantine')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for quarantine')))
        .addSubcommand(sub => sub
            .setName('release')
            .setDescription('Release a user from quarantine')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to release')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('notes')
                .setDescription('Notes about the release')))
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Check quarantine status of a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to check')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all quarantined users'))
        .addSubcommand(sub => sub
            .setName('history')
            .setDescription('View quarantine history for a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to check history for')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Setup the quarantine system')
            .addChannelOption(opt => opt
                .setName('log_channel')
                .setDescription('Channel to log quarantine actions'))
            .addChannelOption(opt => opt
                .setName('review_channel')
                .setDescription('Channel where moderators review quarantined users')))
        .addSubcommand(sub => sub
            .setName('config')
            .setDescription('Configure quarantine settings')
            .addBooleanOption(opt => opt
                .setName('auto_alts')
                .setDescription('Auto-quarantine detected alt accounts'))
            .addBooleanOption(opt => opt
                .setName('auto_new')
                .setDescription('Auto-quarantine new accounts'))
            .addIntegerOption(opt => opt
                .setName('min_age')
                .setDescription('Minimum account age in days for new account filter')
                .setMinValue(1)
                .setMaxValue(365))
            .addBooleanOption(opt => opt
                .setName('dm_users')
                .setDescription('DM users when quarantined')))
        .addSubcommand(sub => sub
            .setName('sync')
            .setDescription('Sync quarantine role permissions to all channels')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const quarantine = interaction.client.quarantineSystem;

        if (!quarantine) {
            return interaction.reply({ content: '❌ Quarantine system is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'add':
                return this.handleAdd(interaction, quarantine);
            case 'release':
                return this.handleRelease(interaction, quarantine);
            case 'check':
                return this.handleCheck(interaction, quarantine);
            case 'list':
                return this.handleList(interaction, quarantine);
            case 'history':
                return this.handleHistory(interaction, quarantine);
            case 'setup':
                return this.handleSetup(interaction, quarantine);
            case 'config':
                return this.handleConfig(interaction, quarantine);
            case 'sync':
                return this.handleSync(interaction, quarantine);
        }
    },

    async handleAdd(interaction, quarantine) {
        const config = await quarantine.getConfig(interaction.guildId);
        if (!config?.enabled) {
            return interaction.reply({ content: '❌ Quarantine system is not setup. Use `/quarantine setup` first.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You cannot quarantine yourself.', ephemeral: true });
        }

        if (user.bot) {
            return interaction.reply({ content: '❌ You cannot quarantine bots.', ephemeral: true });
        }

        await interaction.deferReply();

        const result = await quarantine.quarantineUser(interaction.guildId, user.id, {
            moderatorId: interaction.user.id,
            reason
        });

        if (!result.success) {
            return interaction.editReply({ content: `❌ ${result.error}` });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔒 User Quarantined')
            .setColor(0xFF6600)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Reason', value: reason || 'No reason provided', inline: false }
            )
            .setTimestamp();

        if (result.previousRoles?.length > 0) {
            embed.addFields({ name: 'Roles Removed', value: `${result.previousRoles.length} role(s) stored for restoration`, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleRelease(interaction, quarantine) {
        const user = interaction.options.getUser('user');
        const notes = interaction.options.getString('notes');

        await interaction.deferReply();

        const result = await quarantine.releaseUser(interaction.guildId, user.id, {
            moderatorId: interaction.user.id,
            notes
        });

        if (!result.success) {
            return interaction.editReply({ content: `❌ ${result.error}` });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔓 User Released')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true }
            )
            .setTimestamp();

        if (notes) {
            embed.addFields({ name: 'Notes', value: notes, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleCheck(interaction, quarantine) {
        const user = interaction.options.getUser('user');

        await interaction.deferReply();

        const status = await quarantine.getQuarantineStatus(interaction.guildId, user.id);

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Quarantine Status: ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp();

        if (!status) {
            embed
                .setColor(0x00FF00)
                .setDescription('✅ User has never been quarantined.');
        } else if (status.status === 'quarantined') {
            embed
                .setColor(0xFF6600)
                .setDescription('🔒 User is currently quarantined.')
                .addFields(
                    { name: 'Quarantined At', value: `<t:${Math.floor(new Date(status.created_at).getTime() / 1000)}:F>`, inline: true },
                    { name: 'Reason', value: status.reason || status.auto_reason || 'No reason', inline: false }
                );

            if (status.quarantined_by) {
                embed.addFields({ name: 'Quarantined By', value: `<@${status.quarantined_by}>`, inline: true });
            }
        } else {
            embed
                .setColor(0x0099FF)
                .setDescription('ℹ️ User was previously quarantined but has been released.')
                .addFields(
                    { name: 'Last Quarantine', value: `<t:${Math.floor(new Date(status.created_at).getTime() / 1000)}:R>`, inline: true },
                    { name: 'Released', value: `<t:${Math.floor(new Date(status.released_at).getTime() / 1000)}:R>`, inline: true }
                );
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleList(interaction, quarantine) {
        await interaction.deferReply();

        const users = await quarantine.getQuarantinedUsers(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle('🔒 Quarantined Users')
            .setColor(0xFF6600)
            .setTimestamp();

        if (users.length === 0) {
            embed.setDescription('No users are currently quarantined.');
        } else {
            const list = await Promise.all(users.slice(0, 20).map(async (entry, i) => {
                const user = await interaction.client.users.fetch(entry.user_id).catch(() => null);
                const name = user ? user.tag : `Unknown (${entry.user_id})`;
                const time = `<t:${Math.floor(new Date(entry.created_at).getTime() / 1000)}:R>`;
                return `**${i + 1}.** ${name}\n↳ ${entry.reason || entry.auto_reason || 'No reason'} • ${time}`;
            }));

            embed.setDescription(list.join('\n\n'));
            embed.setFooter({ text: `Total: ${users.length} quarantined user(s)` });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleHistory(interaction, quarantine) {
        const user = interaction.options.getUser('user');

        await interaction.deferReply();

        const history = await quarantine.getUserHistory(interaction.guildId, user.id);

        const embed = new EmbedBuilder()
            .setTitle(`📋 Quarantine History: ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .setColor(0x5865F2)
            .setTimestamp();

        if (history.length === 0) {
            embed.setDescription('No quarantine history for this user.');
        } else {
            const list = history.slice(0, 10).map((entry, i) => {
                const status = entry.status === 'quarantined' ? '🔒' : '🔓';
                const time = `<t:${Math.floor(new Date(entry.created_at).getTime() / 1000)}:R>`;
                let line = `${status} **#${entry.id}** - ${time}\n↳ ${entry.reason || entry.auto_reason || 'No reason'}`;
                
                if (entry.status === 'released') {
                    line += `\n↳ Released by <@${entry.reviewed_by}>`;
                }
                
                return line;
            }).join('\n\n');

            embed.setDescription(list);
            embed.setFooter({ text: `Total: ${history.length} quarantine record(s)` });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSetup(interaction, quarantine) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can setup the quarantine system.', ephemeral: true });
        }

        const logChannel = interaction.options.getChannel('log_channel');
        const reviewChannel = interaction.options.getChannel('review_channel');

        await interaction.deferReply();

        // Create or get quarantine role
        const role = await quarantine.createOrGetQuarantineRole(interaction.guild);

        await quarantine.setup(interaction.guildId, {
            roleId: role.id,
            logChannelId: logChannel?.id,
            reviewChannelId: reviewChannel?.id
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Quarantine System Setup')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Quarantine Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Log Channel', value: logChannel ? `<#${logChannel.id}>` : 'Not set', inline: true },
                { name: 'Review Channel', value: reviewChannel ? `<#${reviewChannel.id}>` : 'Not set', inline: true }
            )
            .setDescription('The quarantine role has been created and permissions have been set on all channels.\n\nUse `/quarantine config` to customize auto-quarantine settings.')
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },

    async handleConfig(interaction, quarantine) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can modify settings.', ephemeral: true });
        }

        const autoAlts = interaction.options.getBoolean('auto_alts');
        const autoNew = interaction.options.getBoolean('auto_new');
        const minAge = interaction.options.getInteger('min_age');
        const dmUsers = interaction.options.getBoolean('dm_users');

        await interaction.deferReply();

        const settings = {};
        if (autoAlts !== null) settings.auto_quarantine_alts = autoAlts;
        if (autoNew !== null) settings.auto_quarantine_new_accounts = autoNew;
        if (minAge !== null) settings.new_account_days = minAge;
        if (dmUsers !== null) settings.dm_on_quarantine = dmUsers;

        if (Object.keys(settings).length === 0) {
            // Show current config
            const config = await quarantine.getConfig(interaction.guildId);
            
            const embed = new EmbedBuilder()
                .setTitle('⚙️ Quarantine Configuration')
                .setColor(0x5865F2)
                .setTimestamp();

            if (!config) {
                embed.setDescription('Quarantine system is not setup. Use `/quarantine setup` first.');
            } else {
                embed.addFields(
                    { name: 'Enabled', value: config.enabled ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Auto-Quarantine Alts', value: config.auto_quarantine_alts ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Auto-Quarantine New', value: config.auto_quarantine_new_accounts ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Min Account Age', value: `${config.new_account_days} days`, inline: true },
                    { name: 'DM Users', value: config.dm_on_quarantine ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Quarantine Role', value: config.quarantine_role_id ? `<@&${config.quarantine_role_id}>` : 'Not set', inline: true }
                );
            }

            return interaction.editReply({ embeds: [embed] });
        }

        await quarantine.updateConfig(interaction.guildId, settings);

        const embed = new EmbedBuilder()
            .setTitle('✅ Configuration Updated')
            .setColor(0x00FF00)
            .setTimestamp();

        const changes = [];
        if (autoAlts !== null) changes.push(`Auto-quarantine alts: ${autoAlts ? '✅' : '❌'}`);
        if (autoNew !== null) changes.push(`Auto-quarantine new accounts: ${autoNew ? '✅' : '❌'}`);
        if (minAge !== null) changes.push(`Minimum account age: ${minAge} days`);
        if (dmUsers !== null) changes.push(`DM users: ${dmUsers ? '✅' : '❌'}`);

        embed.setDescription(changes.join('\n'));

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSync(interaction, quarantine) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can sync permissions.', ephemeral: true });
        }

        const config = await quarantine.getConfig(interaction.guildId);
        if (!config?.quarantine_role_id) {
            return interaction.reply({ content: '❌ Quarantine system is not setup.', ephemeral: true });
        }

        await interaction.deferReply();

        const role = await interaction.guild.roles.fetch(config.quarantine_role_id).catch(() => null);
        if (!role) {
            return interaction.editReply({ content: '❌ Quarantine role not found.' });
        }

        await quarantine.applyQuarantineOverwrites(interaction.guild, role);

        const embed = new EmbedBuilder()
            .setTitle('✅ Permissions Synced')
            .setColor(0x00FF00)
            .setDescription('Quarantine role permissions have been updated on all channels.')
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};
