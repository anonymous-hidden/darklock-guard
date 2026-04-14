const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('🏆 View the server XP leaderboard'),

    async execute(interaction, bot) {
        await interaction.deferReply();

        const guildId = interaction.guild.id;

        if (!bot.rankSystem) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2B2D31)
                        .setDescription('❌ XP system is not initialized.')
                ]
            });
        }

        try {
            const config = await bot.database?.getGuildConfig(guildId);
            if (config && config.xp_enabled === 0) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x2B2D31)
                            .setDescription('⚠️ XP system is not enabled on this server.\nAsk an admin to use `/xp enable`')
                    ]
                });
            }
        } catch (_) {}

        const leaderboard = bot.rankSystem.getLeaderboard(guildId, 10, 'alltime');

        if (!leaderboard || leaderboard.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2B2D31)
                        .setDescription('📊 No XP data yet. Start chatting to earn XP!')
                ]
            });
        }

        const embed = await buildLeaderboard(interaction, bot, leaderboard, 'alltime');
        const dropdown = createTimeDropdown('alltime');
        const buttons = createButtons(guildId);

        await interaction.editReply({ embeds: [embed], components: [dropdown, buttons] });
    }
};

// ── Helpers ──────────────────────────────────────────────────────────

function mapTimeRange(range) {
    const map = { overall: 'alltime', alltime: 'alltime', weekly: 'weekly', monthly: 'monthly' };
    return map[range] || 'alltime';
}

function getTimeConfig(timeRange) {
    const configs = {
        weekly:  { label: 'Weekly XP',  footerLabel: 'Weekly XP' },
        monthly: { label: 'Monthly XP', footerLabel: 'Monthly XP' },
        alltime: { label: 'Overall XP', footerLabel: 'Overall XP' },
        overall: { label: 'Overall XP', footerLabel: 'Overall XP' }
    };
    return configs[timeRange] || configs.alltime;
}

function getXP(entry, timeRange) {
    if (timeRange === 'weekly') return entry.weeklyXP || 0;
    if (timeRange === 'monthly') return entry.monthlyXP || 0;
    return entry.xp || 0;
}

function bar(percent, len = 20) {
    const filled = Math.round((percent / 100) * len);
    return '▰'.repeat(filled) + '▱'.repeat(len - filled);
}

// ── Build Embed ─────────────────────────────────────────────────────

async function buildLeaderboard(interaction, bot, leaderboard, timeRange) {
    const guild = interaction.guild;
    const config = getTimeConfig(timeRange);
    const topXP = Math.max(...leaderboard.map(e => getXP(e, timeRange)), 1);

    let description = '';

    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const rank = i + 1;
        const xp = getXP(entry, timeRange);
        const level = entry.level || 0;
        const pct = Math.round((xp / topXP) * 100);

        let username = 'Unknown';
        try {
            const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
            if (user) username = user.username;
        } catch (_) {}

        description += `**#${rank}** • @${username} • **LVL: ${level}**\n`;
        description += `${bar(pct)}\n\n`;
    }

    return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({
            name: guild.name,
            iconURL: guild.iconURL({ dynamic: true })
        })
        .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
        .setDescription(description.trimEnd())
        .setFooter({ text: config.footerLabel })
        .setTimestamp();
}

// ── Dropdown ────────────────────────────────────────────────────────

function createTimeDropdown(activeRange) {
    const select = new StringSelectMenuBuilder()
        .setCustomId('leaderboard_select')
        .setPlaceholder('Overall XP')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
            { label: 'Overall XP',  value: 'alltime', default: activeRange === 'alltime' || activeRange === 'overall' },
            { label: 'Weekly XP',   value: 'weekly',  default: activeRange === 'weekly' },
            { label: 'Monthly XP',  value: 'monthly', default: activeRange === 'monthly' },
        ]);

    return new ActionRowBuilder().addComponents(select);
}

// ── Web Dashboard Button ────────────────────────────────────────────

function createButtons(guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('View Full Leaderboard')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://admin.darklock.net/leaderboard/${guildId}`)
            .setEmoji('🌐')
    );
}

// ── Dropdown Handler (called from bot.js) ───────────────────────────

async function handleLeaderboardSelect(interaction, bot) {
    const timeRange = interaction.values[0];
    const guildId = interaction.guild.id;

    await interaction.deferUpdate();

    if (!bot.rankSystem) {
        return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x2B2D31).setDescription('❌ XP system is not initialized.')],
            components: []
        });
    }

    const leaderboard = bot.rankSystem.getLeaderboard(guildId, 10, mapTimeRange(timeRange));

    if (!leaderboard || leaderboard.length === 0) {
        const config = getTimeConfig(timeRange);
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x2B2D31)
                    .setDescription(`📊 No ${config.label.toLowerCase()} data yet!`)
            ],
            components: [createTimeDropdown(timeRange), createButtons(guildId)]
        });
    }

    const embed = await buildLeaderboard(interaction, bot, leaderboard, timeRange);
    const dropdown = createTimeDropdown(timeRange);
    const buttons = createButtons(guildId);

    await interaction.editReply({ embeds: [embed], components: [dropdown, buttons] });
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports.handleLeaderboardSelect = handleLeaderboardSelect;
module.exports.buildLeaderboard = buildLeaderboard;
module.exports.createTimeDropdown = createTimeDropdown;
