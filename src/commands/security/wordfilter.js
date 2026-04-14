const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordfilter')
        .setDescription('Quick word filter controls (full configuration in dashboard)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(sub =>
            sub.setName('enable')
                .setDescription('Enable the word filter system')
        )
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable the word filter system')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Show all filtered words and current settings')
        )
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('Test if a message would be filtered')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Message to test')
                        .setRequired(true)
                )
        ),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();

        if (!bot || !bot.wordFilter) {
            return interaction.reply({
                content: '❌ Word filter system is not initialized.',
                ephemeral: true
            });
        }

        switch (sub) {
            case 'enable': return this.handleToggle(interaction, bot, true);
            case 'disable': return this.handleToggle(interaction, bot, false);
            case 'list': return this.handleList(interaction, bot);
            case 'test': return this.handleTest(interaction, bot);
            default:
                return interaction.reply({
                    content: '❌ Unknown subcommand. Use dashboard for word management.',
                    ephemeral: true
                });
        }
    },

    async handleList(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const config = await bot.database.get(
                `SELECT 
                    word_filter_enabled, 
                    banned_words, 
                    banned_phrases, 
                    word_filter_action, 
                    word_filter_mode,
                    word_filter_whitelist_channels,
                    word_filter_whitelist_roles
                FROM guild_configs WHERE guild_id = ?`,
                [interaction.guild.id]
            );

            if (!config) {
                return interaction.editReply({
                    content: '❌ Guild configuration not found. Run `/setup` first.'
                });
            }

            const words = config.banned_words ? config.banned_words.split(',').filter(w => w.trim()) : [];
            const phrases = config.banned_phrases ? config.banned_phrases.split('\n').filter(p => p.trim()) : [];
            const totalFilters = words.length + phrases.length;

            if (totalFilters === 0) {
                return interaction.editReply({
                    content: '📋 No words or phrases configured.\n\nUse the dashboard to configure word filters!'
                });
            }

            const embed = new EmbedBuilder()
                .setColor(config.word_filter_enabled ? 0x00FF00 : 0xFF6B6B)
                .setTitle('📋 Word Filter Configuration')
                .setDescription(`Status: **${config.word_filter_enabled ? '✅ Enabled' : '❌ Disabled'}**\n\n*Use the dashboard to modify filters*`)
                .addFields(
                    { name: '🎯 Action', value: config.word_filter_action || 'delete', inline: true },
                    { name: '🔍 Mode', value: config.word_filter_mode || 'contains', inline: true },
                    { name: '📊 Total Filters', value: `${totalFilters}`, inline: true }
                )
                .setTimestamp();

            if (words.length > 0) {
                const wordList = words.slice(0, 30).join(', ');
                embed.addFields({ 
                    name: `🔤 Filtered Words (${words.length})`, 
                    value: wordList + (words.length > 30 ? `...and ${words.length - 30} more` : ''),
                    inline: false 
                });
            }

            if (phrases.length > 0) {
                const phraseList = phrases.slice(0, 15).map(p => `• ${p}`).join('\n');
                embed.addFields({ 
                    name: `💬 Filtered Phrases (${phrases.length})`, 
                    value: phraseList + (phrases.length > 15 ? `\n...and ${phrases.length - 15} more` : ''),
                    inline: false 
                });
            }

            const whitelistChannels = config.word_filter_whitelist_channels?.split(',').filter(c => c) || [];
            const whitelistRoles = config.word_filter_whitelist_roles?.split(',').filter(r => r) || [];

            if (whitelistChannels.length > 0 || whitelistRoles.length > 0) {
                const exemptions = [];
                if (whitelistChannels.length > 0) exemptions.push(`${whitelistChannels.length} channel(s)`);
                if (whitelistRoles.length > 0) exemptions.push(`${whitelistRoles.length} role(s)`);
                embed.addFields({ name: '✨ Exemptions', value: exemptions.join(', '), inline: false });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            await interaction.editReply({
                content: `❌ Failed to retrieve filter list: ${error.message}`
            });
        }
    },

    async handleTest(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const testMessage = interaction.options.getString('message');

        try {
            const result = await bot.wordFilter.testMessage(
                interaction.guild.id,
                testMessage
            );

            if (!result.wouldBlock) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Message Would Pass')
                    .setDescription(`This message would **NOT** be filtered.`)
                    .addFields({ name: 'Test Message', value: `> ${testMessage}`, inline: false })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFF6B6B)
                    .setTitle('⚠️ Message Would Be Blocked')
                    .setDescription(`This message would trigger the word filter.`)
                    .addFields(
                        { name: 'Test Message', value: `> ${testMessage}`, inline: false },
                        { name: 'Action', value: result.action || 'delete', inline: true },
                        { name: 'Mode', value: result.mode || 'contains', inline: true },
                        { name: 'Matches', value: result.matches.slice(0, 10).map(m => `• ${m.term} (${m.type})`).join('\n') || 'See description', inline: false }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            await interaction.editReply({
                content: `❌ Test failed: ${error.message}`
            });
        }
    },

    async handleToggle(interaction, bot, enabled) {
        await interaction.deferReply({ ephemeral: true });

        try {
            await bot.database.run(
                `UPDATE guild_configs SET word_filter_enabled = ? WHERE guild_id = ?`,
                [enabled ? 1 : 0, interaction.guild.id]
            );

            // Clear cache
            if (bot.wordFilter.configCache) {
                bot.wordFilter.configCache.delete(interaction.guild.id);
                bot.wordFilter.cacheExpiry.delete(interaction.guild.id);
            }

            await interaction.editReply({
                content: `✅ Word filter system is now **${enabled ? 'enabled' : 'disabled'}**.`
            });

        } catch (error) {
            await interaction.editReply({
                content: `❌ Failed to toggle filter: ${error.message}`
            });
        }
    }
};
