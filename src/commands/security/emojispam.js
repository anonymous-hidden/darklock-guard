const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// DEPRECATED: Use /automod emoji instead
module.exports = {
    deprecated: true,
    newCommand: '/automod emoji',
    data: new SlashCommandBuilder()
        .setName('emojispam')
        .setDescription('⚠️ MOVED → Use /automod emoji instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up emoji spam detection')
                .addIntegerOption(option =>
                    option
                        .setName('max_emojis')
                        .setDescription('Maximum emojis per message (default: 10)')
                        .setMinValue(1)
                        .setMaxValue(100)
                )
                .addIntegerOption(option =>
                    option
                        .setName('max_stickers')
                        .setDescription('Maximum stickers per message (default: 3)')
                        .setMinValue(1)
                        .setMaxValue(10)
                )
                .addStringOption(option =>
                    option
                        .setName('action')
                        .setDescription('Action to take on spam')
                        .addChoices(
                            { name: 'Delete message', value: 'delete' },
                            { name: 'Warn user', value: 'warn' },
                            { name: 'Delete and warn', value: 'delete_warn' },
                            { name: 'Timeout user', value: 'timeout' }
                        )
                )
                .addChannelOption(option =>
                    option
                        .setName('log_channel')
                        .setDescription('Channel for spam logs')
                        .addChannelTypes(ChannelType.GuildText)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription('Configure emoji spam settings')
                .addIntegerOption(option =>
                    option
                        .setName('max_percentage')
                        .setDescription('Maximum emoji percentage in message')
                        .setMinValue(10)
                        .setMaxValue(100)
                )
                .addIntegerOption(option =>
                    option
                        .setName('timeout_duration')
                        .setDescription('Timeout duration in seconds (default: 300)')
                        .setMinValue(60)
                        .setMaxValue(604800)
                )
                .addBooleanOption(option =>
                    option
                        .setName('ignore_nitro')
                        .setDescription('Ignore Nitro animated emojis')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('whitelist')
                .setDescription('Manage whitelisted roles')
                .addStringOption(option =>
                    option
                        .setName('action')
                        .setDescription('Whitelist action')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Add role', value: 'add' },
                            { name: 'Remove role', value: 'remove' },
                            { name: 'List roles', value: 'list' }
                        )
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to add/remove')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable emoji spam detection')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View emoji spam detection status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View spam detection statistics')
                .addIntegerOption(option =>
                    option
                        .setName('days')
                        .setDescription('Days of history (default: 7)')
                        .setMinValue(1)
                        .setMaxValue(30)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('incidents')
                .setDescription('View recent spam incidents')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('View incidents for specific user')
                )
        ),

    async execute(interaction) {
        const emojiSpam = interaction.client.emojiSpam;
        if (!emojiSpam) {
            return interaction.reply({ content: '❌ Emoji spam detection is not available.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                await this.handleSetup(interaction, emojiSpam);
                break;
            case 'config':
                await this.handleConfig(interaction, emojiSpam);
                break;
            case 'whitelist':
                await this.handleWhitelist(interaction, emojiSpam);
                break;
            case 'disable':
                await this.handleDisable(interaction, emojiSpam);
                break;
            case 'status':
                await this.handleStatus(interaction, emojiSpam);
                break;
            case 'stats':
                await this.handleStats(interaction, emojiSpam);
                break;
            case 'incidents':
                await this.handleIncidents(interaction, emojiSpam);
                break;
        }
    },

    async handleSetup(interaction, emojiSpam) {
        const maxEmojis = interaction.options.getInteger('max_emojis');
        const maxStickers = interaction.options.getInteger('max_stickers');
        const action = interaction.options.getString('action');
        const logChannel = interaction.options.getChannel('log_channel');

        await emojiSpam.setup(interaction.guildId, {
            maxEmojis: maxEmojis || 10,
            maxStickers: maxStickers || 3,
            action: action || 'delete',
            logChannelId: logChannel?.id
        });

        const embed = new EmbedBuilder()
            .setTitle('🎭 Emoji Spam Detection Enabled')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Max Emojis', value: `${maxEmojis || 10}`, inline: true },
                { name: 'Max Stickers', value: `${maxStickers || 3}`, inline: true },
                { name: 'Action', value: action || 'delete', inline: true }
            );

        if (logChannel) {
            embed.addFields({ name: 'Log Channel', value: `<#${logChannel.id}>`, inline: true });
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleConfig(interaction, emojiSpam) {
        const maxPercentage = interaction.options.getInteger('max_percentage');
        const timeoutDuration = interaction.options.getInteger('timeout_duration');
        const ignoreNitro = interaction.options.getBoolean('ignore_nitro');

        const updates = {};
        if (maxPercentage !== null) updates.max_emoji_percentage = maxPercentage;
        if (timeoutDuration !== null) updates.timeout_duration = timeoutDuration;
        if (ignoreNitro !== null) updates.ignore_nitro = ignoreNitro;

        if (Object.keys(updates).length === 0) {
            return interaction.reply({ content: '❌ Please provide at least one setting to update.', ephemeral: true });
        }

        await emojiSpam.updateConfig(interaction.guildId, updates);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Emoji Spam Config Updated')
            .setColor(0x00FF00)
            .setDescription('Settings have been updated.')
            .setTimestamp();

        const fields = [];
        if (maxPercentage !== null) fields.push({ name: 'Max Emoji %', value: `${maxPercentage}%`, inline: true });
        if (timeoutDuration !== null) fields.push({ name: 'Timeout Duration', value: `${timeoutDuration}s`, inline: true });
        if (ignoreNitro !== null) fields.push({ name: 'Ignore Nitro', value: ignoreNitro ? 'Yes' : 'No', inline: true });

        embed.addFields(fields);
        await interaction.reply({ embeds: [embed] });
    },

    async handleWhitelist(interaction, emojiSpam) {
        const action = interaction.options.getString('action');
        const role = interaction.options.getRole('role');

        if (action === 'list') {
            const config = await emojiSpam.getConfig(interaction.guildId);
            const roles = config?.whitelist_roles ? config.whitelist_roles.split(',') : [];

            if (roles.length === 0) {
                return interaction.reply({ content: '📋 No roles are whitelisted.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎭 Whitelisted Roles')
                .setColor(0x00BFFF)
                .setDescription(roles.map(r => `<@&${r}>`).join('\n'))
                .setFooter({ text: `${roles.length} role(s)` });

            return interaction.reply({ embeds: [embed] });
        }

        if (!role) {
            return interaction.reply({ content: '❌ Please specify a role.', ephemeral: true });
        }

        if (action === 'add') {
            await emojiSpam.addWhitelistRole(interaction.guildId, role.id);
            await interaction.reply({ content: `✅ Added <@&${role.id}> to whitelist.` });
        } else if (action === 'remove') {
            await emojiSpam.removeWhitelistRole(interaction.guildId, role.id);
            await interaction.reply({ content: `✅ Removed <@&${role.id}> from whitelist.` });
        }
    },

    async handleDisable(interaction, emojiSpam) {
        await emojiSpam.updateConfig(interaction.guildId, { enabled: 0 });
        await interaction.reply({ content: '✅ Emoji spam detection has been disabled.' });
    },

    async handleStatus(interaction, emojiSpam) {
        const config = await emojiSpam.getConfig(interaction.guildId);

        if (!config) {
            return interaction.reply({ 
                content: '❌ Emoji spam detection is not configured. Use `/emojispam setup` to enable.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎭 Emoji Spam Detection Status')
            .setColor(config.enabled ? 0x00FF00 : 0xFF0000)
            .addFields(
                { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Max Emojis', value: `${config.max_emojis_per_message}`, inline: true },
                { name: 'Max Stickers', value: `${config.max_stickers_per_message}`, inline: true },
                { name: 'Max Emoji %', value: `${config.max_emoji_percentage || 70}%`, inline: true },
                { name: 'Action', value: config.action_type, inline: true },
                { name: 'Timeout', value: `${config.timeout_duration}s`, inline: true },
                { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true },
                { name: 'Ignore Nitro', value: config.ignore_nitro ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp();

        if (config.whitelist_roles) {
            const roles = config.whitelist_roles.split(',');
            embed.addFields({ name: 'Whitelisted Roles', value: roles.map(r => `<@&${r}>`).join(', ') || 'None', inline: false });
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handleStats(interaction, emojiSpam) {
        const days = interaction.options.getInteger('days') || 7;
        const stats = await emojiSpam.getStats(interaction.guildId, days);

        const embed = new EmbedBuilder()
            .setTitle('📊 Emoji Spam Statistics')
            .setColor(0x00BFFF)
            .addFields(
                { name: 'Total Incidents', value: `${stats.total_incidents || 0}`, inline: true },
                { name: 'Unique Users', value: `${stats.unique_users || 0}`, inline: true },
                { name: 'Avg Emojis', value: `${Math.round(stats.avg_emoji_count || 0)}`, inline: true }
            )
            .setFooter({ text: `Last ${days} days` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async handleIncidents(interaction, emojiSpam) {
        const user = interaction.options.getUser('user');

        let incidents;
        let title;

        if (user) {
            incidents = await emojiSpam.getUserIncidents(interaction.guildId, user.id, 10);
            title = `🎭 Incidents for ${user.tag}`;
        } else {
            incidents = await emojiSpam.getRecentIncidents(interaction.guildId, 15);
            title = '🎭 Recent Emoji Spam Incidents';
        }

        if (incidents.length === 0) {
            return interaction.reply({ content: '✅ No incidents found.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0xFFCC00);

        const description = incidents.map((inc, i) => {
            const time = new Date(inc.created_at).toLocaleString();
            return `**${i + 1}.** <@${inc.user_id}> | 🎭 ${inc.emoji_count} emojis, ${inc.sticker_count} stickers | Action: ${inc.action_taken}\n*${time}*`;
        }).join('\n\n');

        embed.setDescription(description.slice(0, 4000));
        embed.setFooter({ text: `${incidents.length} incident(s)` });

        await interaction.reply({ embeds: [embed] });
    }
};
