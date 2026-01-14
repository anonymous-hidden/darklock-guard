const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordfilter')
        .setDescription('Manage auto-mod word filters for your server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new word filter')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Unique name for this filter')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('pattern')
                        .setDescription('Word or regex pattern to filter')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action to take when triggered')
                        .setRequired(true)
                        .addChoices(
                            { name: '🗑️ Delete message', value: 'delete' },
                            { name: '⚠️ Delete + Warn user', value: 'warn' },
                            { name: '🔇 Delete + Timeout', value: 'timeout' },
                            { name: '👢 Delete + Kick', value: 'kick' },
                            { name: '🔨 Delete + Ban', value: 'ban' },
                            { name: '📝 Log only (no delete)', value: 'log_only' }
                        )
                )
                .addBooleanOption(opt =>
                    opt.setName('regex')
                        .setDescription('Is this a regex pattern? (default: false)')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt.setName('case_sensitive')
                        .setDescription('Case sensitive matching? (default: false)')
                        .setRequired(false)
                )
                .addIntegerOption(opt =>
                    opt.setName('timeout_duration')
                        .setDescription('Timeout duration in minutes (for timeout action)')
                        .setMinValue(1)
                        .setMaxValue(40320)
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('warn_message')
                        .setDescription('Custom warning message sent to user')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a word filter')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Name of the filter to remove')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all word filters in this server')
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable a filter')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Name of the filter')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable the filter')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('exempt')
                .setDescription('Add role/channel exemptions to a filter')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Name of the filter')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to exempt from this filter')
                        .setRequired(false)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to exempt from this filter')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('presets')
                .setDescription('View and apply preset filter packs')
        )
        .addSubcommand(sub =>
            sub.setName('apply-preset')
                .setDescription('Apply a preset filter pack')
                .addStringOption(opt =>
                    opt.setName('preset')
                        .setDescription('Preset to apply')
                        .setRequired(true)
                        .addChoices(
                            { name: '🤬 Basic Profanity', value: 'profanity_basic' },
                            { name: '🚫 Slurs & Hate Speech', value: 'slurs' },
                            { name: '📧 Spam Patterns', value: 'spam_patterns' },
                            { name: '🔗 Invite Links', value: 'invite_links' },
                            { name: '👻 Zalgo Text', value: 'zalgo_text' },
                            { name: '📢 Mass Mentions', value: 'mass_mentions' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action for all filters in this preset')
                        .setRequired(true)
                        .addChoices(
                            { name: '🗑️ Delete message', value: 'delete' },
                            { name: '⚠️ Delete + Warn', value: 'warn' },
                            { name: '🔇 Delete + Timeout', value: 'timeout' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('Test if a message would trigger any filters')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Message to test')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View filter violation statistics')
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        
        if (focusedOption.name === 'name') {
            try {
                const filters = await interaction.client.wordFilter.listFilters(interaction.guild.id);
                const choices = filters
                    .filter(f => f.filter_name.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .map(f => ({ name: `${f.filter_name} (${f.action})`, value: f.filter_name }))
                    .slice(0, 25);
                
                await interaction.respond(choices);
            } catch (error) {
                await interaction.respond([]);
            }
        }
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        // Ensure word filter system exists
        if (!interaction.client.wordFilter) {
            return interaction.reply({
                content: '❌ Word filter system is not initialized.',
                ephemeral: true
            });
        }

        switch (sub) {
            case 'add':
                await this.handleAdd(interaction);
                break;
            case 'remove':
                await this.handleRemove(interaction);
                break;
            case 'list':
                await this.handleList(interaction);
                break;
            case 'toggle':
                await this.handleToggle(interaction);
                break;
            case 'exempt':
                await this.handleExempt(interaction);
                break;
            case 'presets':
                await this.handlePresets(interaction);
                break;
            case 'apply-preset':
                await this.handleApplyPreset(interaction);
                break;
            case 'test':
                await this.handleTest(interaction);
                break;
            case 'stats':
                await this.handleStats(interaction);
                break;
        }
    },

    async handleAdd(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const pattern = interaction.options.getString('pattern');
        const action = interaction.options.getString('action');
        const isRegex = interaction.options.getBoolean('regex') || false;
        const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;
        const timeoutDuration = interaction.options.getInteger('timeout_duration');
        const warnMessage = interaction.options.getString('warn_message');

        // Validate name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            return interaction.editReply({
                content: '❌ Filter name can only contain letters, numbers, underscores, and hyphens.'
            });
        }

        try {
            await interaction.client.wordFilter.addFilter(interaction.guild.id, {
                name,
                pattern,
                isRegex,
                caseSensitive,
                action,
                actionDuration: timeoutDuration ? timeoutDuration * 60000 : null,
                warnMessage,
                createdBy: interaction.user.id
            });

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Word Filter Added')
                .addFields(
                    { name: 'Name', value: name, inline: true },
                    { name: 'Pattern', value: `\`${pattern}\``, inline: true },
                    { name: 'Type', value: isRegex ? 'Regex' : 'Word', inline: true },
                    { name: 'Action', value: action, inline: true },
                    { name: 'Case Sensitive', value: caseSensitive ? 'Yes' : 'No', inline: true }
                )
                .setTimestamp();

            if (timeoutDuration) {
                embed.addFields({ name: 'Timeout Duration', value: `${timeoutDuration} minutes`, inline: true });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            if (error.message.includes('UNIQUE constraint')) {
                await interaction.editReply({
                    content: `❌ A filter named **${name}** already exists.`
                });
            } else if (error.message.includes('Invalid regex')) {
                await interaction.editReply({
                    content: `❌ ${error.message}`
                });
            } else {
                await interaction.editReply({
                    content: `❌ Failed to add filter: ${error.message}`
                });
            }
        }
    },

    async handleRemove(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');

        const removed = await interaction.client.wordFilter.removeFilter(interaction.guild.id, name);

        if (removed) {
            await interaction.editReply({
                content: `✅ Filter **${name}** has been removed.`
            });
        } else {
            await interaction.editReply({
                content: `❌ Filter **${name}** not found.`
            });
        }
    },

    async handleList(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const filters = await interaction.client.wordFilter.listFilters(interaction.guild.id);

        if (!filters || filters.length === 0) {
            return interaction.editReply({
                content: '📋 No word filters configured for this server.\n\nUse `/wordfilter add` or `/wordfilter apply-preset` to get started!'
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Word Filters')
            .setDescription(`Found **${filters.length}** filter(s) in this server`)
            .setTimestamp();

        // Group by enabled status
        const enabled = filters.filter(f => f.enabled);
        const disabled = filters.filter(f => !f.enabled);

        if (enabled.length > 0) {
            const enabledList = enabled.slice(0, 15).map(f => {
                const type = f.is_regex ? '`[regex]`' : '`[word]`';
                return `• **${f.filter_name}** ${type} → ${f.action}`;
            }).join('\n');
            
            embed.addFields({
                name: `✅ Active Filters (${enabled.length})`,
                value: enabledList + (enabled.length > 15 ? `\n...and ${enabled.length - 15} more` : ''),
                inline: false
            });
        }

        if (disabled.length > 0) {
            const disabledList = disabled.slice(0, 10).map(f => {
                return `• ~~${f.filter_name}~~`;
            }).join('\n');
            
            embed.addFields({
                name: `❌ Disabled Filters (${disabled.length})`,
                value: disabledList + (disabled.length > 10 ? `\n...and ${disabled.length - 10} more` : ''),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    async handleToggle(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const enabled = interaction.options.getBoolean('enabled');

        const updated = await interaction.client.wordFilter.updateFilter(
            interaction.guild.id,
            name,
            { enabled }
        );

        if (updated) {
            await interaction.editReply({
                content: `✅ Filter **${name}** is now **${enabled ? 'enabled' : 'disabled'}**.`
            });
        } else {
            await interaction.editReply({
                content: `❌ Filter **${name}** not found.`
            });
        }
    },

    async handleExempt(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel');

        if (!role && !channel) {
            return interaction.editReply({
                content: '❌ Please specify a role or channel to exempt.'
            });
        }

        // Get current filter
        const filters = await interaction.client.wordFilter.listFilters(interaction.guild.id);
        const filter = filters.find(f => f.filter_name === name);

        if (!filter) {
            return interaction.editReply({
                content: `❌ Filter **${name}** not found.`
            });
        }

        const exemptRoles = filter.exempt_roles ? JSON.parse(filter.exempt_roles) : [];
        const exemptChannels = filter.exempt_channels ? JSON.parse(filter.exempt_channels) : [];

        const changes = [];

        if (role) {
            if (exemptRoles.includes(role.id)) {
                exemptRoles.splice(exemptRoles.indexOf(role.id), 1);
                changes.push(`Removed role **${role.name}** from exemptions`);
            } else {
                exemptRoles.push(role.id);
                changes.push(`Added role **${role.name}** to exemptions`);
            }
        }

        if (channel) {
            if (exemptChannels.includes(channel.id)) {
                exemptChannels.splice(exemptChannels.indexOf(channel.id), 1);
                changes.push(`Removed channel **#${channel.name}** from exemptions`);
            } else {
                exemptChannels.push(channel.id);
                changes.push(`Added channel **#${channel.name}** to exemptions`);
            }
        }

        await interaction.client.wordFilter.updateFilter(interaction.guild.id, name, {
            exemptRoles,
            exemptChannels
        });

        await interaction.editReply({
            content: `✅ Updated exemptions for **${name}**:\n${changes.join('\n')}`
        });
    },

    async handlePresets(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const presets = await interaction.client.wordFilter.getPresets();

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📦 Available Filter Presets')
            .setDescription('Use `/wordfilter apply-preset` to add these to your server')
            .setTimestamp();

        const categories = {};
        for (const preset of presets) {
            if (!categories[preset.category]) {
                categories[preset.category] = [];
            }
            categories[preset.category].push(preset);
        }

        for (const [category, categoryPresets] of Object.entries(categories)) {
            const presetList = categoryPresets.map(p => {
                const patterns = JSON.parse(p.patterns);
                return `• **${p.name}** - ${p.description} (${patterns.length} patterns)`;
            }).join('\n');

            embed.addFields({
                name: category.replace('_', ' ').toUpperCase(),
                value: presetList,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    async handleApplyPreset(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const presetName = interaction.options.getString('preset');
        const action = interaction.options.getString('action');

        try {
            const added = await interaction.client.wordFilter.applyPreset(
                interaction.guild.id,
                presetName,
                action,
                interaction.user.id
            );

            await interaction.editReply({
                content: `✅ Applied preset **${presetName}** - added **${added}** filter(s) with action: **${action}**`
            });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Failed to apply preset: ${error.message}`
            });
        }
    },

    async handleTest(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const testMessage = interaction.options.getString('message');
        const filters = await interaction.client.wordFilter.getFilters(interaction.guild.id);

        if (!filters || filters.length === 0) {
            return interaction.editReply({
                content: '📋 No active filters to test against.'
            });
        }

        const matches = [];

        for (const filter of filters) {
            if (!filter.compiledPattern) continue;

            const match = testMessage.match(filter.compiledPattern);
            if (match) {
                matches.push({
                    filter: filter.filter_name,
                    action: filter.action,
                    matched: match.slice(0, 3).join(', ')
                });
            }
        }

        if (matches.length === 0) {
            await interaction.editReply({
                content: `✅ This message would **NOT** trigger any filters.\n\n> ${testMessage}`
            });
        } else {
            const embed = new EmbedBuilder()
                .setColor(0xFF6B6B)
                .setTitle('⚠️ Filter Matches Found')
                .setDescription(`This message would trigger **${matches.length}** filter(s):\n\n> ${testMessage}`)
                .setTimestamp();

            for (const match of matches.slice(0, 10)) {
                embed.addFields({
                    name: match.filter,
                    value: `Action: **${match.action}**\nMatched: \`${match.matched}\``,
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleStats(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const stats = await interaction.client.wordFilter.getViolationStats(interaction.guild.id, 7);
        const filters = await interaction.client.wordFilter.listFilters(interaction.guild.id);

        if (!stats || stats.length === 0) {
            return interaction.editReply({
                content: '📊 No filter violations recorded in the last 7 days.'
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Word Filter Statistics (Last 7 Days)')
            .setTimestamp();

        let totalViolations = 0;
        let totalUsers = 0;

        const statsList = stats.map(s => {
            const filter = filters.find(f => f.id === s.filter_id);
            totalViolations += s.violations;
            totalUsers += s.unique_users;
            return `• **${filter?.filter_name || 'Unknown'}**: ${s.violations} violations (${s.unique_users} users)`;
        }).join('\n');

        embed.setDescription(`**Total Violations:** ${totalViolations}\n**Unique Users:** ${totalUsers}\n\n${statsList}`);

        await interaction.editReply({ embeds: [embed] });
    }
};
