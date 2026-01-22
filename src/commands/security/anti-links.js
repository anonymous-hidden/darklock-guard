const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// DEPRECATED: Use /automod links instead
module.exports = {
    deprecated: true,
    newCommand: '/automod links',
    data: new SlashCommandBuilder()
        .setName('anti-links')
        .setDescription('⚠️ MOVED → Use /automod links instead')
        .addSubcommand(sub => sub.setName('on').setDescription('Enable anti-links protection'))
        .addSubcommand(sub => sub.setName('off').setDescription('Disable anti-links protection'))
        .addSubcommand(sub => sub
            .setName('settings')
            .setDescription('Configure allow/block lists and Safe Browsing')
            .addStringOption(opt => opt.setName('allow_domains').setDescription('Comma or JSON array of allowed domains'))
            .addStringOption(opt => opt.setName('block_domains').setDescription('Comma or JSON array of blocked domains'))
            .addStringOption(opt => opt.setName('phishing_domains').setDescription('Comma or JSON array of phishing domains'))
            .addStringOption(opt => opt.setName('iplogger_domains').setDescription('Comma or JSON array of IP logger domains'))
            .addBooleanOption(opt => opt.setName('safe_browsing_enabled').setDescription('Enable Google Safe Browsing for this guild'))
            .addStringOption(opt => opt.setName('safe_browsing_api_key').setDescription('API key (overrides env/global)'))
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

                const pushJson = (col, raw) => {
                    if (!raw) return;
                    updates.push(`${col} = ?`);
                    values.push(normalizeList(raw));
                };

                pushJson('antilinks_allowed_domains', interaction.options.getString('allow_domains'));
                pushJson('antilinks_blocked_domains', interaction.options.getString('block_domains'));
                pushJson('antilinks_phishing_domains', interaction.options.getString('phishing_domains'));
                pushJson('antilinks_iplogger_domains', interaction.options.getString('iplogger_domains'));

                const sbEnabled = interaction.options.getBoolean('safe_browsing_enabled');
                if (sbEnabled !== null) {
                    updates.push('safe_browsing_enabled = ?');
                    values.push(sbEnabled ? 1 : 0);
                }

                const sbKey = interaction.options.getString('safe_browsing_api_key');
                if (sbKey) {
                    updates.push('safe_browsing_api_key = ?');
                    values.push(sbKey);
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
                    .setTitle('✅ Anti-Links Settings Updated')
                    .setDescription('Domain lists and Safe Browsing settings saved.')
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'on') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_links_enabled)
                    VALUES (?, 1)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_links_enabled = 1, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#00d4ff')
                    .setTitle('✅ Anti-Links Enabled')
                    .setDescription('Malicious links will be detected and mitigated.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'off') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_links_enabled)
                    VALUES (?, 0)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_links_enabled = 0, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);

                const embed = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('⏸️ Anti-Links Disabled')
                    .setDescription('Link detection is now turned off.')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (err) {
            bot.logger?.error('anti-links command error:', err);
            return interaction.reply({ content: 'Error processing command.', ephemeral: true });
        }
    }
};

function normalizeList(raw) {
    const str = String(raw || '').trim();
    if (!str) return '[]';
    if (str.startsWith('[')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return JSON.stringify(parsed.map(s => String(s || '').trim()).filter(Boolean));
        } catch (_) {
            // fall through
        }
    }
    const arr = str.split(',').map(s => s.trim()).filter(Boolean);
    return JSON.stringify(arr);
}