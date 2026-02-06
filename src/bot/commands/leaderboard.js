const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

        const embed = await buildModernLeaderboard(interaction, leaderboard, 'overall', bot);
        const buttons = createTimeButtons('overall');
        
        await interaction.editReply({ embeds: [embed], components: [buttons] });
    }
};

// Format XP with K/M suffixes
function formatXP(xp) {
    if (xp >= 1000000) return `${(xp / 1000000).toFixed(1)}M`;
    if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
    return xp.toLocaleString();
}

// Get level from XP
function getLevel(xp) {
    return Math.floor(0.1 * Math.sqrt(xp));
}

// Get XP needed for next level
function getXPForLevel(level) {
    return Math.pow(level / 0.1, 2);
}

// Create modern progress bar
function createProgressBar(current, max, length = 12) {
    const progress = Math.min(current / max, 1);
    const filled = Math.round(progress * length);
    const empty = length - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
}

// Get rank display (medals for top 3, numbers for rest)
function getRankDisplay(rank) {
    const medals = ['👑', '🥈', '🥉'];
    if (rank <= 3) return medals[rank - 1];
    
    // Circled numbers for 4-10
    const circled = ['④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    if (rank <= 10) return circled[rank - 4];
    
    return `#${rank}`;
}

// Get level tier color/emoji
function getLevelTier(level) {
    if (level >= 50) return { emoji: '🔥', name: 'Legendary', color: 0xFF6B35 };
    if (level >= 40) return { emoji: '💎', name: 'Diamond', color: 0x00D4FF };
    if (level >= 30) return { emoji: '💜', name: 'Master', color: 0xA855F7 };
    if (level >= 20) return { emoji: '💙', name: 'Expert', color: 0x3B82F6 };
    if (level >= 10) return { emoji: '💚', name: 'Skilled', color: 0x22C55E };
    return { emoji: '⬜', name: 'Novice', color: 0x6B7280 };
}

// Get time range config
function getTimeConfig(timeRange) {
    const configs = {
        daily: { 
            emoji: '📅', 
            label: 'Daily', 
            color: 0xFF9500,
            description: 'Top performers in the last 24 hours'
        },
        weekly: { 
            emoji: '📆', 
            label: 'Weekly', 
            color: 0x00C8FF,
            description: 'Top performers this week'
        },
        monthly: { 
            emoji: '🗓️', 
            label: 'Monthly', 
            color: 0xA855F7,
            description: 'Top performers this month'
        },
        overall: { 
            emoji: '🏆', 
            label: 'All Time', 
            color: 0xFFD700,
            description: 'All-time server champions'
        }
    };
    return configs[timeRange] || configs.overall;
}

// Build the modern leaderboard embed
async function buildModernLeaderboard(interaction, leaderboard, timeRange, bot) {
    const config = getTimeConfig(timeRange);
    const guild = interaction.guild;
    
    // Build leaderboard entries
    let description = '';
    
    // Add decorative header
    description += `\`\`\`ansi\n`;
    description += `\x1b[1;33m╔══════════════════════════════════╗\x1b[0m\n`;
    description += `\x1b[1;33m║\x1b[0m    ${config.emoji} ${config.label.toUpperCase()} LEADERBOARD ${config.emoji}    \x1b[1;33m║\x1b[0m\n`;
    description += `\x1b[1;33m╚══════════════════════════════════╝\x1b[0m\n`;
    description += `\`\`\`\n`;
    
    // Process each user
    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const rank = i + 1;
        const xp = timeRange === 'overall' ? entry.total_xp : entry[`${timeRange}_xp`] || entry.total_xp;
        const level = getLevel(xp);
        const tier = getLevelTier(level);
        
        // Try to get username
        let username = 'Unknown User';
        try {
            const user = await interaction.client.users.fetch(entry.user_id).catch(() => null);
            if (user) username = user.username;
        } catch (e) {
            username = 'Unknown User';
        }
        
        // Truncate username if too long
        if (username.length > 12) {
            username = username.substring(0, 11) + '…';
        }
        
        const rankEmoji = getRankDisplay(rank);
        const xpFormatted = formatXP(xp);
        const nextLevelXP = getXPForLevel(level + 1);
        const currentLevelXP = getXPForLevel(level);
        const progressPercent = Math.floor(((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100) || 0;
        
        if (rank <= 3) {
            // Featured style for top 3
            description += `${rankEmoji} **${username}**\n`;
            description += `┃ ${tier.emoji} Level **${level}** • \`${xpFormatted} XP\`\n`;
            description += `┃ ${createProgressBar(xp - currentLevelXP, nextLevelXP - currentLevelXP)} ${progressPercent}%\n`;
            description += `\n`;
        } else {
            // Compact style for 4-10
            description += `${rankEmoji} **${username}** • Lv.**${level}** • \`${xpFormatted}\`\n`;
        }
    }
    
    // Server stats footer
    const totalUsers = leaderboard.length;
    const topXP = leaderboard[0] ? (timeRange === 'overall' ? leaderboard[0].total_xp : leaderboard[0][`${timeRange}_xp`] || leaderboard[0].total_xp) : 0;
    const avgLevel = Math.floor(leaderboard.reduce((sum, e) => sum + getLevel(e.total_xp), 0) / totalUsers) || 0;
    
    description += `\n─────────────────────────────\n`;
    description += `📊 **${totalUsers}** ranked • 🎯 Top: **${formatXP(topXP)}** • 📈 Avg Lv: **${avgLevel}**`;
    
    return new EmbedBuilder()
        .setColor(config.color)
        .setAuthor({
            name: guild.name,
            iconURL: guild.iconURL({ dynamic: true })
        })
        .setDescription(description)
        .setFooter({ 
            text: `${config.description} • Use buttons to switch time range`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp();
}

// Create time range buttons
function createTimeButtons(activeRange) {
    const buttons = [
        { id: 'daily', label: '📅 Daily', style: ButtonStyle.Secondary },
        { id: 'weekly', label: '📆 Weekly', style: ButtonStyle.Secondary },
        { id: 'monthly', label: '🗓️ Monthly', style: ButtonStyle.Secondary },
        { id: 'overall', label: '🏆 All Time', style: ButtonStyle.Secondary }
    ];
    
    return new ActionRowBuilder().addComponents(
        buttons.map(btn => {
            const isActive = btn.id === activeRange;
            return new ButtonBuilder()
                .setCustomId(`leaderboard_${btn.id}`)
                .setLabel(btn.label)
                .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(isActive);
        })
    );
}

// Handle button interactions
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
                    .setColor(config.color)
                    .setDescription(`📊 No ${config.label.toLowerCase()} XP data yet!`)
            ],
            components: [createTimeButtons(timeRange)]
        });
    }
    
    const embed = await buildModernLeaderboard(interaction, leaderboard, timeRange, bot);
    const buttons = createTimeButtons(timeRange);
    
    await interaction.editReply({ embeds: [embed], components: [buttons] });
}

// Export the button handler
module.exports.handleLeaderboardButton = handleLeaderboardButton;
module.exports.buildModernLeaderboard = buildModernLeaderboard;
module.exports.createTimeButtons = createTimeButtons;
