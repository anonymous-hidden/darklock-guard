const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Generate Unicode progress bar (Arcane style)
 * @param {number} percent - Progress percentage (0-100)
 * @param {number} length - Total length of bar (default 20)
 * @returns {string} Progress bar string
 */
function createProgressBar(percent, length = 20) {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    
    const filledChar = '▰';
    const emptyChar = '▱';
    
    return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the server XP leaderboard')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            const xpTracker = interaction.client.xpTracker;

            if (!xpTracker) {
                return await interaction.editReply({
                    content: '❌ XP system is not initialized.',
                    ephemeral: true
                });
            }

            // Check if XP is enabled
            const settings = await xpTracker.db.getGuildSettings(guildId);
            if (!settings.xp_enabled) {
                return await interaction.editReply({
                    content: '❌ XP system is disabled for this server.',
                    ephemeral: true
                });
            }

            // Get top 10 users
            const leaderboard = await xpTracker.getLeaderboard(guildId, 10);

            if (!leaderboard || leaderboard.length === 0) {
                return await interaction.editReply({
                    content: '📊 No one has earned XP yet. Start chatting to climb the leaderboard!',
                    ephemeral: true
                });
            }

            // Build leaderboard embed
            const embed = await buildLeaderboardEmbed(
                interaction.guild,
                leaderboard,
                interaction.client
            );

            // Create "View leaderboard" button
            const button = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('View leaderboard')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${process.env.DASHBOARD_ORIGIN || process.env.DASHBOARD_URL || process.env.XP_DASHBOARD_URL || 'https://admin.darklock.net'}/leaderboard/${guildId}`)
                    .setEmoji('📊')
            );

            await interaction.editReply({
                embeds: [embed],
                components: [button]
            });

        } catch (error) {
            console.error('Error in leaderboard command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching the leaderboard.',
                ephemeral: true
            });
        }
    }
};

/**
 * Build Arcane-style leaderboard embed
 * @param {Guild} guild - Discord guild
 * @param {Array} leaderboard - Leaderboard data
 * @param {Client} client - Discord client
 * @returns {Promise<EmbedBuilder>}
 */
async function buildLeaderboardEmbed(guild, leaderboard, client) {
    const embed = new EmbedBuilder()
        .setTitle(guild.name)
        .setColor('#1a1a2e') // Dark theme matching Arcane
        .setFooter({ text: 'Overall XP' })
        .setTimestamp();

    // Set guild icon if available
    if (guild.iconURL()) {
        embed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
    }

    // Build leaderboard entries
    let description = '';

    for (const entry of leaderboard) {
        try {
            // Fetch user
            let username;
            try {
                const user = await client.users.fetch(entry.user_id);
                username = `@${user.username}`;
            } catch (err) {
                username = '@unknown-user';
            }

            // Build entry line
            const rank = entry.rank;
            const level = entry.level;
            const progressBar = createProgressBar(entry.progress_percent, 20);

            // Format: #RANK • @username • LVL: X
            description += `**#${rank}** • ${username} • **LVL: ${level}**\n`;
            description += `${progressBar}\n\n`;

        } catch (error) {
            console.error('Error processing leaderboard entry:', error);
        }
    }

    embed.setDescription(description || 'No data available');

    return embed;
}
