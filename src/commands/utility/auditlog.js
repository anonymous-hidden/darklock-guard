const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('auditlog')
        .setDescription('View and search the moderation audit log')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
        .addSubcommand(sub => sub
            .setName('recent')
            .setDescription('View recent audit log entries')
            .addIntegerOption(opt => opt
                .setName('count')
                .setDescription('Number of entries to show (max 25)')
                .setMinValue(1)
                .setMaxValue(25)))
        .addSubcommand(sub => sub
            .setName('search')
            .setDescription('Search the audit log')
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Action type to filter by')
                .addChoices(
                    { name: 'Warning', value: 'WARN' },
                    { name: 'Mute', value: 'MUTE' },
                    { name: 'Kick', value: 'KICK' },
                    { name: 'Ban', value: 'BAN' },
                    { name: 'Unban', value: 'UNBAN' },
                    { name: 'Timeout', value: 'TIMEOUT' },
                    { name: 'Strike Added', value: 'STRIKE_ADD' },
                    { name: 'Message Delete', value: 'MESSAGE_DELETE' },
                    { name: 'Spam Detected', value: 'SPAM_DETECT' },
                    { name: 'Raid Detected', value: 'RAID_DETECT' }
                ))
            .addUserOption(opt => opt
                .setName('moderator')
                .setDescription('Filter by moderator'))
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('Filter by target user'))
            .addStringOption(opt => opt
                .setName('keyword')
                .setDescription('Search in reason/details')))
        .addSubcommand(sub => sub
            .setName('user')
            .setDescription('View history for a specific user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to view history for')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('View audit log statistics')
            .addIntegerOption(opt => opt
                .setName('days')
                .setDescription('Days to analyze (default 30)')
                .setMinValue(1)
                .setMaxValue(365)))
        .addSubcommand(sub => sub
            .setName('entry')
            .setDescription('View details of a specific entry')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('Entry ID')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Setup audit log viewer')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel to log moderation actions'))
            .addIntegerOption(opt => opt
                .setName('retention')
                .setDescription('Days to keep entries (default 90)')
                .setMinValue(7)
                .setMaxValue(365)))
        .addSubcommand(sub => sub
            .setName('tracking')
            .setDescription('Toggle tracking categories')
            .addStringOption(opt => opt
                .setName('category')
                .setDescription('Category to toggle')
                .setRequired(true)
                .addChoices(
                    { name: 'Messages', value: 'messages' },
                    { name: 'Moderation', value: 'moderation' },
                    { name: 'Members', value: 'members' },
                    { name: 'Channels', value: 'channels' },
                    { name: 'Roles', value: 'roles' },
                    { name: 'Bans', value: 'bans' }
                ))
            .addBooleanOption(opt => opt
                .setName('enabled')
                .setDescription('Enable or disable tracking')
                .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const auditLog = interaction.client.auditLogViewer;

        if (!auditLog) {
            return interaction.reply({ content: '❌ Audit Log Viewer is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'recent':
                return this.handleRecent(interaction, auditLog);
            case 'search':
                return this.handleSearch(interaction, auditLog);
            case 'user':
                return this.handleUser(interaction, auditLog);
            case 'stats':
                return this.handleStats(interaction, auditLog);
            case 'entry':
                return this.handleEntry(interaction, auditLog);
            case 'setup':
                return this.handleSetup(interaction, auditLog);
            case 'tracking':
                return this.handleTracking(interaction, auditLog);
        }
    },

    async handleRecent(interaction, auditLog) {
        const count = interaction.options.getInteger('count') || 10;

        await interaction.deferReply();

        const entries = await auditLog.getRecent(interaction.guildId, count);

        if (entries.length === 0) {
            return interaction.editReply({ content: '📋 No audit log entries found.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Recent Audit Log Entries')
            .setColor(0x5865F2)
            .setTimestamp();

        const formatted = entries.map(entry => {
            const f = auditLog.formatEntry(entry);
            const mod = f.moderator ? `<@${f.moderator}>` : 'System';
            const target = f.target ? `<@${f.target}>` : 'N/A';
            return `**#${f.id}** | ${f.action} | ${mod} → ${target}\n↳ ${f.reason || 'No reason'} • <t:${Math.floor(new Date(f.timestamp).getTime() / 1000)}:R>`;
        }).join('\n\n');

        embed.setDescription(formatted.substring(0, 4000));
        embed.setFooter({ text: `Showing ${entries.length} entries` });

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSearch(interaction, auditLog) {
        const actionType = interaction.options.getString('type');
        const moderator = interaction.options.getUser('moderator');
        const target = interaction.options.getUser('target');
        const keyword = interaction.options.getString('keyword');

        await interaction.deferReply();

        const filters = {
            actionType,
            moderatorId: moderator?.id,
            targetId: target?.id,
            keyword,
            limit: 20
        };

        const entries = await auditLog.search(interaction.guildId, filters);

        if (entries.length === 0) {
            return interaction.editReply({ content: '🔍 No entries found matching your criteria.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔍 Audit Log Search Results')
            .setColor(0x5865F2)
            .setTimestamp();

        const formatted = entries.map(entry => {
            const f = auditLog.formatEntry(entry);
            const mod = f.moderator ? `<@${f.moderator}>` : 'System';
            const target = f.target ? `<@${f.target}>` : 'N/A';
            return `**#${f.id}** | ${f.action} | ${mod} → ${target}\n↳ ${f.reason || 'No reason'}`;
        }).join('\n\n');

        embed.setDescription(formatted.substring(0, 4000));

        // Add filters info
        const filterList = [];
        if (actionType) filterList.push(`Type: ${actionType}`);
        if (moderator) filterList.push(`Mod: ${moderator.tag}`);
        if (target) filterList.push(`Target: ${target.tag}`);
        if (keyword) filterList.push(`Keyword: ${keyword}`);

        if (filterList.length > 0) {
            embed.addFields({ name: 'Filters', value: filterList.join(' • '), inline: false });
        }

        embed.setFooter({ text: `Found ${entries.length} entries` });

        return interaction.editReply({ embeds: [embed] });
    },

    async handleUser(interaction, auditLog) {
        const user = interaction.options.getUser('user');

        await interaction.deferReply();

        const entries = await auditLog.getUserHistory(interaction.guildId, user.id, 25);

        const embed = new EmbedBuilder()
            .setTitle(`📋 Audit History: ${user.tag}`)
            .setColor(0x5865F2)
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp();

        if (entries.length === 0) {
            embed.setDescription('No audit log entries found for this user.');
        } else {
            // Separate as moderator and as target
            const asModerator = entries.filter(e => e.moderator_id === user.id);
            const asTarget = entries.filter(e => e.target_id === user.id);

            if (asModerator.length > 0) {
                const modActions = asModerator.slice(0, 10).map(e => {
                    const f = auditLog.formatEntry(e);
                    return `**#${f.id}** ${f.action} → <@${f.target}>`;
                }).join('\n');
                embed.addFields({ name: `📤 Actions Taken (${asModerator.length})`, value: modActions.substring(0, 1000), inline: false });
            }

            if (asTarget.length > 0) {
                const targetActions = asTarget.slice(0, 10).map(e => {
                    const f = auditLog.formatEntry(e);
                    const mod = f.moderator ? `<@${f.moderator}>` : 'System';
                    return `**#${f.id}** ${f.action} by ${mod}`;
                }).join('\n');
                embed.addFields({ name: `📥 Actions Received (${asTarget.length})`, value: targetActions.substring(0, 1000), inline: false });
            }
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleStats(interaction, auditLog) {
        const days = interaction.options.getInteger('days') || 30;

        await interaction.deferReply();

        const stats = await auditLog.getStats(interaction.guildId, days);

        const embed = new EmbedBuilder()
            .setTitle(`📊 Audit Log Statistics (${days} days)`)
            .setColor(0x5865F2)
            .addFields(
                { name: 'Total Actions', value: `${stats.totalActions}`, inline: true }
            )
            .setTimestamp();

        // Top actions by type
        if (stats.byType.length > 0) {
            const typeList = stats.byType.slice(0, 10).map(t => 
                `${auditLog.getActionName(t.action_type)}: **${t.count}**`
            ).join('\n');
            embed.addFields({ name: 'By Type', value: typeList, inline: true });
        }

        // Top moderators
        if (stats.topModerators.length > 0) {
            const modList = await Promise.all(stats.topModerators.slice(0, 5).map(async m => {
                const user = await interaction.client.users.fetch(m.moderator_id).catch(() => null);
                const name = user ? user.tag : `Unknown (${m.moderator_id})`;
                return `${name}: **${m.count}**`;
            }));
            embed.addFields({ name: 'Top Moderators', value: modList.join('\n'), inline: true });
        }

        // Top targets
        if (stats.topTargets.length > 0) {
            const targetList = await Promise.all(stats.topTargets.slice(0, 5).map(async t => {
                const user = await interaction.client.users.fetch(t.target_id).catch(() => null);
                const name = user ? user.tag : `Unknown (${t.target_id})`;
                return `${name}: **${t.count}**`;
            }));
            embed.addFields({ name: 'Top Targets', value: targetList.join('\n'), inline: true });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleEntry(interaction, auditLog) {
        const id = interaction.options.getInteger('id');

        await interaction.deferReply();

        const entry = await auditLog.getEntry(interaction.guildId, id);

        if (!entry) {
            return interaction.editReply({ content: '❌ Entry not found.' });
        }

        const f = auditLog.formatEntry(entry);

        const embed = new EmbedBuilder()
            .setTitle(`📋 Audit Log Entry #${f.id}`)
            .setColor(f.color)
            .addFields(
                { name: 'Action', value: f.action, inline: true },
                { name: 'Moderator', value: f.moderator ? `<@${f.moderator}>` : 'System', inline: true },
                { name: 'Target', value: f.target ? `<@${f.target}>` : 'N/A', inline: true },
                { name: 'Reason', value: f.reason || 'No reason provided', inline: false }
            )
            .setTimestamp(new Date(f.timestamp));

        if (f.channel) {
            embed.addFields({ name: 'Channel', value: `<#${f.channel}>`, inline: true });
        }

        if (f.details) {
            const detailsStr = JSON.stringify(f.details, null, 2).substring(0, 1000);
            embed.addFields({ name: 'Details', value: `\`\`\`json\n${detailsStr}\n\`\`\``, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSetup(interaction, auditLog) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can setup the audit log.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const retention = interaction.options.getInteger('retention') || 90;

        await interaction.deferReply();

        await auditLog.setup(interaction.guildId, {
            logChannelId: channel?.id,
            retentionDays: retention
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Audit Log Viewer Setup')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Log Channel', value: channel ? `<#${channel.id}>` : 'Not set', inline: true },
                { name: 'Retention', value: `${retention} days`, inline: true }
            )
            .setDescription('Audit log viewer is now active. Use `/auditlog tracking` to configure what actions to track.')
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },

    async handleTracking(interaction, auditLog) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can modify tracking settings.', ephemeral: true });
        }

        const category = interaction.options.getString('category');
        const enabled = interaction.options.getBoolean('enabled');

        await interaction.deferReply();

        const settings = { [category]: enabled };
        await auditLog.updateTracking(interaction.guildId, settings);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Tracking Updated')
            .setColor(enabled ? 0x00FF00 : 0xFF6600)
            .setDescription(`**${category.charAt(0).toUpperCase() + category.slice(1)}** tracking is now ${enabled ? '✅ Enabled' : '❌ Disabled'}`)
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};
