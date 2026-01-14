const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// DEPRECATED: Use /automod spam instead
module.exports = {
    deprecated: true,
    newCommand: '/automod spam',
    data: new SlashCommandBuilder()
        .setName('anti-spam')
        .setDescription('⚠️ MOVED → Use /automod spam instead')
        .addSubcommand(sub => sub.setName('on').setDescription('Enable Anti-Spam Protection'))
        .addSubcommand(sub => sub.setName('off').setDescription('Disable Anti-Spam Protection'))
        .addSubcommand(sub => sub
            .setName('settings')
            .setDescription('Configure spam thresholds and bypass channels')
            .addStringOption(opt => opt.setName('bypass_channels').setDescription('Comma or JSON array of channel IDs to bypass'))
            .addIntegerOption(opt => opt.setName('flood_mid').setDescription('Messages in 10s for medium severity (default 8)').setMinValue(1).setMaxValue(50))
            .addIntegerOption(opt => opt.setName('flood_high').setDescription('Messages in 10s for high severity (default 12)').setMinValue(1).setMaxValue(100))
            .addIntegerOption(opt => opt.setName('duplicate_mid').setDescription('Repeated identical messages for medium (default 3)').setMinValue(1).setMaxValue(50))
            .addIntegerOption(opt => opt.setName('duplicate_high').setDescription('Repeated identical messages for high (default 5)').setMinValue(1).setMaxValue(100))
            .addIntegerOption(opt => opt.setName('mention_threshold').setDescription('Mentions to trigger medium (default 5)').setMinValue(1).setMaxValue(50))
            .addIntegerOption(opt => opt.setName('emoji_mid').setDescription('Emojis for medium (default 15)').setMinValue(1).setMaxValue(200))
            .addIntegerOption(opt => opt.setName('emoji_high').setDescription('Emojis for high (default 30)').setMinValue(1).setMaxValue(400))
            .addIntegerOption(opt => opt.setName('link_threshold').setDescription('Links in a message for medium (default 3)').setMinValue(1).setMaxValue(50))
            .addNumberOption(opt => opt.setName('caps_ratio').setDescription('Uppercase ratio 0-1 to flag (default 0.8)').setMinValue(0).setMaxValue(1))
            .addIntegerOption(opt => opt.setName('caps_min_letters').setDescription('Minimum letters before caps ratio applies (default 20)').setMinValue(1).setMaxValue(500))
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

                const pushIfDefined = (col, val) => {
                    if (val === null || val === undefined) return;
                    updates.push(`${col} = ?`);
                    values.push(val);
                };

                const bypass = interaction.options.getString('bypass_channels');
                if (bypass) {
                    const normalized = normalizeList(bypass);
                    pushIfDefined('antispam_bypass_channels', normalized);
                }

                pushIfDefined('antispam_flood_mid', interaction.options.getInteger('flood_mid'));
                pushIfDefined('antispam_flood_high', interaction.options.getInteger('flood_high'));
                pushIfDefined('antispam_duplicate_mid', interaction.options.getInteger('duplicate_mid'));
                pushIfDefined('antispam_duplicate_high', interaction.options.getInteger('duplicate_high'));
                pushIfDefined('antispam_mention_threshold', interaction.options.getInteger('mention_threshold'));
                pushIfDefined('antispam_emoji_mid', interaction.options.getInteger('emoji_mid'));
                pushIfDefined('antispam_emoji_high', interaction.options.getInteger('emoji_high'));
                pushIfDefined('antispam_link_threshold', interaction.options.getInteger('link_threshold'));
                pushIfDefined('antispam_caps_ratio', interaction.options.getNumber('caps_ratio'));
                pushIfDefined('antispam_caps_min_letters', interaction.options.getInteger('caps_min_letters'));

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
                    .setTitle('✅ Anti-Spam Settings Updated')
                    .setDescription('Custom thresholds and bypass channels have been saved.')
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'on') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_spam_enabled)
                    VALUES (?, 1)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_spam_enabled = 1, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#00d4ff')
                    .setTitle('✅ Anti-Spam Enabled')
                    .setDescription('Spam bursts, repeated messages, and mention floods will be mitigated.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'off') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_spam_enabled)
                    VALUES (?, 0)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_spam_enabled = 0, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('⏸️ Anti-Spam Disabled')
                    .setDescription('Spam detection is now turned off.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (err) {
            bot.logger?.error('anti-spam command error:', err);
            return interaction.reply({ content: 'Error processing command.', ephemeral: true });
        }
    }
};

function normalizeList(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';
    // accept JSON array
    if (str.startsWith('[')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
                return JSON.stringify(parsed.map(String));
            }
        } catch (_) {
            // fall through
        }
    }
    // fall back to comma separated
    const arr = str.split(',').map(s => s.trim()).filter(Boolean);
    return JSON.stringify(arr);
}
