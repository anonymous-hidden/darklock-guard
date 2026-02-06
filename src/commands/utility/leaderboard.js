const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('🏆 View the server XP leaderboard'),

    async execute(interaction, bot) {
        await interaction.deferReply();

        const guildId = interaction.guild.id;
        
        // Check if XP is enabled
        const settings = await bot.xpDatabase?.getGuildSettings(guildId);
        if (!settings?.xp_enabled) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2B2D31)
                        .setDescription('⚠️ XP system is not enabled on this server.\nAsk an admin to use `/xp enable`')
                ]
            });
        }

        // Get leaderboard data
        const leaderboard = await bot.xpDatabase?.getLeaderboard(guildId, 10, 'overall');
        
        if (!leaderboard || leaderboard.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2B2D31)
                        .setDescription('📊 No XP data yet. Start chatting to earn XP!')
                ]
            });
        }

        const embed = await buildArcaneLeaderboard(interaction, leaderboard, 'overall', bot);
        const dropdown = createTimeDropdown('overall');
        
        await interaction.editReply({ embeds: [embed], components: [dropdown] });
    }
};

// Get level from XP
function getLevel(xp) {
    if (!xp || xp === 0) return 0;
    return Math.floor(0.1 * Math.sqrt(xp));
}

// Get time range config
function getTimeConfig(timeRange) {
    const configs = {
        daily: { label: 'Daily XP', emoji: '📅' },
        weekly: { label: 'Weekly XP', emoji: '📆' },
        monthly: { label: 'Monthly XP', emoji: '🗓️' },
        overall: { label: 'Overall XP', emoji: '🏆' }
    };
    return configs[timeRange] || configs.overall;
}

// Build the Arcane-style leaderboard embed
async function buildArcaneLeaderboard(interaction, leaderboard, timeRange, bot) {
    const guild = interaction.guild;
    
    // Build leaderboard entries - clean Arcane style
    let description = '';
    
    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const rank = i + 1;
        const xp = timeRange === 'overall' ? (entry.total_xp || 0) : (entry[`${timeRange}_xp`] || entry.total_xp || 0);
        const level = getLevel(xp);
        
        // Try to get user
        let username = 'Unknown User';
        try {
            const user = await interaction.client.users.fetch(entry.user_id).catch(() => null);
            if (user) username = user.username;
        } catch (e) {
            username = 'Unknown User';
        }
        
        // Rank display with colors
        let rankDisplay;
        if (rank === 1) {
            rankDisplay = '**#1**';  // Gold style
        } else if (rank === 2) {
            rankDisplay = '**#2**';  // Silver style  
        } else if (rank === 3) {
            rankDisplay = '**#3**';  // Bronze style
        } else {
            rankDisplay = `**#${rank}**`;
        }
        
        // Clean single-line format like Arcane
        description += `${rankDisplay} • @${username} • LVL: ${level}\n`;
    }
    
    // Remove trailing newline
    description = description.trimEnd();
    
    // Add visual terminator + dropdown hint (Arcane-style illusion technique)
    description += '\n\n'; // Spacer
    description += '─────────────────────────────'; // Divider
    description += '\n*Select leaderboard type below*'; // Hint text
    
    const config = getTimeConfig(timeRange);
    
    return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({
            name: guild.name,
            iconURL: guild.iconURL({ dynamic: true })
        })
        .setDescription(description)
        .setFooter({ text: `${config.emoji} ${config.label}` })
        .setTimestamp();
}

// Create time range dropdown (like Arcane's "Overall XP" dropdown)
function createTimeDropdown(activeRange) {
    const select = new StringSelectMenuBuilder()
        .setCustomId('leaderboard_select')
        .setPlaceholder('Select Type')  // ≤ 16 chars
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
            {
                label: '🏆 Overall',
                description: 'All-time',
                value: 'overall',
                default: activeRange === 'overall'
            },
            {
                label: '📅 Daily',
                description: 'Today',
                value: 'daily',
                default: activeRange === 'daily'
            },
            {
                label: '📆 Weekly',
                description: 'This week',
                value: 'weekly',
                default: activeRange === 'weekly'
            },
            {
                label: '🗓️ Monthly',
                description: 'This month',
                value: 'monthly',
                default: activeRange === 'monthly'
            }
        ]);
    
    return new ActionRowBuilder().addComponents(select);
}

// Handle dropdown interactions
async function handleLeaderboardSelect(interaction, bot) {
    const timeRange = interaction.values[0];
    const guildId = interaction.guild.id;
    
    await interaction.deferUpdate();
    
    const leaderboard = await bot.xpDatabase?.getLeaderboard(guildId, 10, timeRange);
    
    if (!leaderboard || leaderboard.length === 0) {
        const config = getTimeConfig(timeRange);
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x2B2D31)
                    .setDescription(`📊 No ${config.label.toLowerCase()} data yet!`)
            ],
            components: [createTimeDropdown(timeRange)]
        });
    }
    
    const embed = await buildArcaneLeaderboard(interaction, leaderboard, timeRange, bot);
    const dropdown = createTimeDropdown(timeRange);
    
    await interaction.editReply({ embeds: [embed], components: [dropdown] });
}

// Handle button interactions (legacy support)
async function handleLeaderboardButton(interaction, bot) {
    const timeRange = interaction.customId.replace('leaderboard_', '');
    const guildId = interaction.guild.id;
    
    await interaction.deferUpdate();
    
    const leaderboard = await bot.xpDatabase?.getLeaderboard(guildId, 10, timeRange);
    
    if (!leaderboard || leaderboard.length === 0) {
        const config = getTimeConfig(timeRange);
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x2B2D31)
                    .setDescription(`📊 No ${config.label.toLowerCase()} data yet!`)
            ],
            components: [createTimeDropdown(timeRange)]
        });
    }
    
    const embed = await buildArcaneLeaderboard(interaction, leaderboard, timeRange, bot);
    const dropdown = createTimeDropdown(timeRange);
    
    await interaction.editReply({ embeds: [embed], components: [dropdown] });
}

// Export handlers
module.exports.handleLeaderboardButton = handleLeaderboardButton;
module.exports.handleLeaderboardSelect = handleLeaderboardSelect;
module.exports.buildArcaneLeaderboard = buildArcaneLeaderboard;
module.exports.createTimeDropdown = createTimeDropdown;
