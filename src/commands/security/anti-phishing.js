const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const LINK_REGEX = /https?:\/\/[^\s)]+/gi;
const SUSPICIOUS_PATTERNS = [/discord\.[a-z]{2}\//i, /free-?nitro/i, /steamgift/i, /@everyone/i];

function analyzeLink(link) {
    const flags = [];
    if (/discord(gifts|app)?\.com\.[a-z]{2,}/i.test(link)) flags.push('Domain spoof');
    if (/nitro|giveaway|free|gift/i.test(link)) flags.push('Incentive bait');
    if (/\bverify\b|login|auth/i.test(link)) flags.push('Credential lure');
    return { link, flags };
}

// DEPRECATED: Use /automod phishing instead
module.exports = {
    deprecated: true,
    newCommand: '/automod phishing',
    data: new SlashCommandBuilder()
        .setName('anti-phishing')
        .setDescription('⚠️ MOVED → Use /automod phishing instead')
        .addSubcommand(sub => sub.setName('on').setDescription('Enable Anti-Phishing Protection'))
        .addSubcommand(sub => sub.setName('off').setDescription('Disable Anti-Phishing Protection'))
        .addSubcommand(sub => sub.setName('scan').setDescription('Scan recent messages or a specific URL')
            .addStringOption(opt => opt.setName('url').setDescription('Single URL to scan').setRequired(false))
            .addIntegerOption(opt => opt.setName('limit').setDescription('Messages to scan (default 50)').setRequired(false))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need Manage Server or Administrator to use this command.', ephemeral: true });
        }

        try {
            if (sub === 'on') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_phishing_enabled)
                    VALUES (?, 1)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_phishing_enabled = 1, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);
                const embed = new EmbedBuilder().setColor('#00d4ff').setTitle('✅ Anti-Phishing Enabled').setDescription('Suspicious links and phishing attempts will now be scanned.').setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (sub === 'off') {
                await bot.database.run(`
                    INSERT INTO guild_configs (guild_id, anti_phishing_enabled)
                    VALUES (?, 0)
                    ON CONFLICT(guild_id) DO UPDATE SET anti_phishing_enabled = 0, updated_at = CURRENT_TIMESTAMP
                `, [guildId]);
                const embed = new EmbedBuilder().setColor('#f59e0b').setTitle('⏸️ Anti-Phishing Disabled').setDescription('Phishing link detection is now turned off.').setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (sub === 'scan') {
                await interaction.deferReply({ ephemeral: true });
                const single = interaction.options.getString('url');
                if (single) {
                    const result = analyzeLink(single);
                    const suspicious = result.flags.length || SUSPICIOUS_PATTERNS.some(r => r.test(single));
                    const embed = new EmbedBuilder()
                        .setColor(suspicious ? '#ef4444' : '#22c55e')
                        .setTitle(suspicious ? '⚠️ Suspicious Link' : '✅ Link Looks Safe')
                        .addFields({ name: 'URL', value: single });
                    if (result.flags.length) embed.addFields({ name: 'Indicators', value: result.flags.join(', ') });
                    return interaction.editReply({ embeds: [embed] });
                }

                const limit = interaction.options.getInteger('limit') || 50;
                const channel = interaction.channel;
                const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) }).catch(() => new Map());
                const links = [];
                for (const msg of messages.values()) {
                    const found = msg.content.match(LINK_REGEX);
                    if (found) found.forEach(f => links.push({ link: f, author: msg.author }));
                }
                const analyzed = links.map(l => ({ author: l.author, ...analyzeLink(l.link) }));
                const suspicious = analyzed.filter(a => a.flags.length || SUSPICIOUS_PATTERNS.some(r => r.test(a.link)));

                const embed = new EmbedBuilder()
                    .setColor(suspicious.length ? '#ef4444' : '#22c55e')
                    .setTitle('🔎 Phishing Scan Results')
                    .setDescription(`${links.length} links scanned. ${suspicious.length} flagged.`)
                    .setTimestamp();

                if (suspicious.length) {
                    embed.addFields({
                        name: 'Flagged Links',
                        value: suspicious.slice(0, 10).map(s => `${s.author}: ${s.link} (${s.flags.join('/') || 'pattern'})`).join('\n')
                    });
                    if (suspicious.length > 10) embed.addFields({ name: 'More', value: `${suspicious.length - 10} additional flagged link(s)...` });
                }

                return interaction.editReply({ embeds: [embed] });
            }
        } catch (err) {
            bot.logger?.error('anti-phishing command error:', err);
            if (interaction.deferred) return interaction.editReply({ content: 'Error processing scan.' });
            return interaction.reply({ content: 'Error processing command.', ephemeral: true });
        }
    }
};
