const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the server XP leaderboard')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number to view')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction, bot) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            const page = interaction.options.getInteger('page') || 1;
            const perPage = 10;

            // Check if XP system is enabled
            const guildConfig = await bot.database.getGuildConfig(guildId);
            if (!guildConfig?.xp_enabled) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff6b6b')
                        .setDescription('❌ XP system is not enabled on this server. An admin can enable it in the dashboard.')
                    ]
                });
            }

            // Get total user count for pagination
            const totalUsers = await bot.rankSystem.getTotalUsers(guildId);
            const totalPages = Math.ceil(totalUsers / perPage) || 1;
            const currentPage = Math.min(page, totalPages);
            const offset = (currentPage - 1) * perPage;

            // Get leaderboard data
            const leaderboard = await bot.rankSystem.getLeaderboard(guildId, perPage, offset);

            if (leaderboard.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ffaa00')
                        .setTitle('📊 XP Leaderboard')
                        .setDescription('No one has earned XP yet! Start chatting to be the first on the leaderboard.')
                        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
                    ]
                });
            }

            // Build leaderboard embed
            const embed = await buildLeaderboardEmbed(interaction, leaderboard, currentPage, totalPages, totalUsers, offset);

            // Create pagination buttons
            const buttons = createPaginationButtons(currentPage, totalPages);

            const response = { embeds: [embed] };
            if (totalPages > 1) {
                response.components = [buttons];
            }

            const message = await interaction.editReply(response);

            // Handle button interactions if multiple pages
            if (totalPages > 1) {
                const collector = message.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id,
                    time: 120000 // 2 minutes
                });

                collector.on('collect', async i => {
                    try {
                        let newPage = currentPage;

                        switch (i.customId) {
                            case 'lb_first':
                                newPage = 1;
                                break;
                            case 'lb_prev':
                                newPage = Math.max(1, currentPage - 1);
                                break;
                            case 'lb_next':
                                newPage = Math.min(totalPages, currentPage + 1);
                                break;
                            case 'lb_last':
                                newPage = totalPages;
                                break;
                        }

                        const newOffset = (newPage - 1) * perPage;
                        const newLeaderboard = await bot.rankSystem.getLeaderboard(guildId, perPage, newOffset);
                        const newEmbed = await buildLeaderboardEmbed(interaction, newLeaderboard, newPage, totalPages, totalUsers, newOffset);
                        const newButtons = createPaginationButtons(newPage, totalPages);

                        await i.update({ embeds: [newEmbed], components: [newButtons] });
                    } catch (error) {
                        console.error('Error updating leaderboard:', error);
                    }
                });

                collector.on('end', () => {
                    // Disable buttons after timeout
                    const disabledButtons = createPaginationButtons(currentPage, totalPages, true);
                    interaction.editReply({ components: [disabledButtons] }).catch(() => {});
                });
            }

        } catch (error) {
            console.error('Error executing leaderboard command:', error);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ An error occurred while fetching the leaderboard.')
                ]
            });
        }
    }
};

/**
 * Build the leaderboard embed
 */
async function buildLeaderboardEmbed(interaction, leaderboard, currentPage, totalPages, totalUsers, offset) {
    const medals = ['🥇', '🥈', '🥉'];
    const descriptions = [];

    for (let i = 0; i < leaderboard.length; i++) {
        const user = leaderboard[i];
        const rank = offset + i + 1;
        const medal = rank <= 3 ? medals[rank - 1] : `\`${rank}.\``;
        
        // Try to fetch username
        let username;
        try {
            const member = await interaction.guild.members.fetch(user.user_id).catch(() => null);
            username = member?.user?.username || `User ${user.user_id.slice(0, 8)}...`;
        } catch {
            username = `User ${user.user_id.slice(0, 8)}...`;
        }

        const level = user.level || 0;
        const xp = formatNumber(user.xp || 0);
        const messages = formatNumber(user.total_messages || 0);

        descriptions.push(
            `${medal} **${username}**\n` +
            `   ╰ Level \`${level}\` • \`${xp}\` XP • \`${messages}\` msgs`
        );
    }

    // Find requesting user's position
    const userStats = await interaction.client.bot?.rankSystem?.getUserStats(interaction.guild.id, interaction.user.id);
    const userRank = userStats?.rank || '—';

    return new EmbedBuilder()
        .setColor('#00d4ff')
        .setTitle('🏆 XP Leaderboard')
        .setDescription(descriptions.join('\n\n'))
        .setThumbnail(interaction.guild.iconURL({ size: 256 }))
        .addFields(
            { name: '📊 Your Rank', value: `#${userRank}`, inline: true },
            { name: '👥 Total Members', value: formatNumber(totalUsers), inline: true },
            { name: '📄 Page', value: `${currentPage}/${totalPages}`, inline: true }
        )
        .setFooter({ text: `${interaction.guild.name} • Keep chatting to climb the ranks!`, iconURL: interaction.guild.iconURL() })
        .setTimestamp();
}

/**
 * Create pagination buttons
 */
function createPaginationButtons(currentPage, totalPages, disabled = false) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('lb_first')
                .setLabel('⏪')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || currentPage === 1),
            new ButtonBuilder()
                .setCustomId('lb_prev')
                .setLabel('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || currentPage === 1),
            new ButtonBuilder()
                .setCustomId('lb_page')
                .setLabel(`Page ${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('lb_next')
                .setLabel('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || currentPage === totalPages),
            new ButtonBuilder()
                .setCustomId('lb_last')
                .setLabel('⏩')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || currentPage === totalPages)
        );
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}
