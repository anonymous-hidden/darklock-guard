const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// DEPRECATED: Use /automod raid instead
module.exports = {
    deprecated: true,
    newCommand: '/automod raid',
    data: new SlashCommandBuilder()
        .setName('anti-raid')
        .setDescription('⚠️ MOVED → Use /automod raid instead')
        .addSubcommand(sub => sub.setName('on').setDescription('Enable Anti-Raid Protection'))
        .addSubcommand(sub => sub.setName('off').setDescription('Disable Anti-Raid Protection'))
        .addSubcommand(sub => sub
            .setName('settings')
            .setDescription('Configure raid thresholds and auto-lift duration')
            .addIntegerOption(opt => opt.setName('threshold').setDescription('Base join threshold in 60s (default 10)').setMinValue(1).setMaxValue(200))
            .addIntegerOption(opt => opt.setName('lockdown_duration_ms').setDescription('Lockdown auto-lift duration ms (default 600000)').setMinValue(10_000).setMaxValue(86_400_000))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need Manage Server or Administrator to use this command.', ephemeral: true });
        }

        try {
            if (sub === 'settings') {
                const updates = [];
                const values = [];

                const threshold = interaction.options.getInteger('threshold');
                if (threshold !== null) {
                    updates.push('raid_threshold = ?');
                    values.push(threshold);
                }

                const duration = interaction.options.getInteger('lockdown_duration_ms');
                if (duration !== null) {
                    updates.push('raid_lockdown_duration_ms = ?');
                    values.push(duration);
                }

                if (updates.length === 0) {
                    return interaction.reply({ content: 'No settings provided. Specify at least one option.', ephemeral: true });
                }

                values.push(guildId);
                await bot.database.run(`
                    UPDATE guild_configs
                    SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                    WHERE guild_id = ?
                `, values);

                const embed = new EmbedBuilder()
                    .setColor('#22c55e')
                    .setTitle('✅ Anti-Raid Settings Updated')
                    .setDescription('Raid thresholds and lockdown duration saved.')
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'on') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_raid_enabled)
                    VALUES (?, 1)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_raid_enabled = 1, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#00d4ff')
                    .setTitle('✅ Anti-Raid Enabled')
                    .setDescription('Coordinated raid patterns will now be actively detected and blocked.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'off') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_raid_enabled)
                    VALUES (?, 0)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_raid_enabled = 0, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('⏸️ Anti-Raid Disabled')
                    .setDescription('Raid detection is now turned off.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (err) {
            bot.logger?.error('anti-raid command error:', err);
            return interaction.reply({ content: 'Error processing command.', ephemeral: true });
        }
    }
};
