const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('View moderation case history')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View cases for a specific user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to view cases for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('recent')
                .setDescription('View recent moderation cases')
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of cases to show (default 10)')
                        .setMinValue(1)
                        .setMaxValue(25)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('case')
                .setDescription('View a specific case by ID')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Case ID')
                        .setRequired(true))),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'user') {
            const user = interaction.options.getUser('user');

            try {
                const cases = await bot.database.all(`
                    SELECT * FROM moderation_cases
                    WHERE guild_id = ? AND user_id = ?
                    ORDER BY created_at DESC
                    LIMIT 25
                `, [interaction.guild.id, user.id]);

                if (cases.length === 0) {
                    return await interaction.reply({
                        content: `No moderation cases found for ${user.tag}`,
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📋 Moderation Cases for ${user.tag}`)
                    .setColor('#FF6B6B')
                    .setThumbnail(user.displayAvatarURL())
                    .setDescription(`Total cases: **${cases.length}**`)
                    .setTimestamp();

                for (const c of cases.slice(0, 10)) {
                    const moderator = await interaction.client.users.fetch(c.moderator_id).catch(() => null);
                    embed.addFields({
                        name: `Case #${c.id} - ${c.action.toUpperCase()}`,
                        value: `**Moderator:** ${moderator?.tag || 'Unknown'}\n**Reason:** ${c.reason}\n**Date:** ${new Date(c.created_at).toLocaleDateString()}`,
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve cases',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'recent') {
            const limit = interaction.options.getInteger('limit') || 10;

            try {
                const cases = await bot.database.all(`
                    SELECT * FROM moderation_cases
                    WHERE guild_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                `, [interaction.guild.id, limit]);

                if (cases.length === 0) {
                    return await interaction.reply({
                        content: 'No recent moderation cases found',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle('📋 Recent Moderation Cases')
                    .setColor('#FF6B6B')
                    .setDescription(`Showing last ${cases.length} cases`)
                    .setTimestamp();

                for (const c of cases) {
                    const user = await interaction.client.users.fetch(c.user_id).catch(() => null);
                    const moderator = await interaction.client.users.fetch(c.moderator_id).catch(() => null);
                    embed.addFields({
                        name: `Case #${c.id} - ${c.action.toUpperCase()}`,
                        value: `**User:** ${user?.tag || 'Unknown'}\n**Moderator:** ${moderator?.tag || 'Unknown'}\n**Reason:** ${c.reason}\n**Date:** ${new Date(c.created_at).toLocaleDateString()}`,
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve cases',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'case') {
            const caseId = interaction.options.getInteger('id');

            try {
                const c = await bot.database.get(`
                    SELECT * FROM moderation_cases
                    WHERE id = ? AND guild_id = ?
                `, [caseId, interaction.guild.id]);

                if (!c) {
                    return await interaction.reply({
                        content: '❌ Case not found',
                        ephemeral: true
                    });
                }

                const user = await interaction.client.users.fetch(c.user_id).catch(() => null);
                const moderator = await interaction.client.users.fetch(c.moderator_id).catch(() => null);

                const embed = new EmbedBuilder()
                    .setTitle(`📋 Case #${c.id}`)
                    .setColor('#FF6B6B')
                    .addFields(
                        { name: 'Action', value: c.action.toUpperCase(), inline: true },
                        { name: 'User', value: user?.tag || 'Unknown', inline: true },
                        { name: 'Moderator', value: moderator?.tag || 'Unknown', inline: true },
                        { name: 'Reason', value: c.reason || 'No reason provided', inline: false },
                        { name: 'Date', value: new Date(c.created_at).toLocaleString(), inline: false }
                    )
                    .setTimestamp();

                if (user) embed.setThumbnail(user.displayAvatarURL());

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve case',
                    ephemeral: true
                });
            }
        }
    }
};
