const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
let rankCardRenderer;
try { rankCardRenderer = require('../../utils/rankCardRenderer'); } catch (_) { rankCardRenderer = null; }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your XP rank card or another user\'s rank')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction, bot) {
        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guild.id;
            const rankSystem = bot?.rankSystem || interaction.client.rankSystem;

            if (!rankSystem) {
                return await interaction.editReply({
                    content: '❌ XP system is not initialized.'
                });
            }

            // Get user stats from RankSystem (JSON-based)
            const stats = rankSystem.getUserStats(guildId, targetUser.id);

            if (!stats || stats.xp === 0) {
                return interaction.editReply({
                    content: `📊 **No Rank Data**\n\n${targetUser.username} hasn't earned any XP yet! Start chatting to earn XP and level up.`
                });
            }

            // Try to render a card image, fall back to embed
            if (rankCardRenderer) {
                try {
                    const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
                    const cardData = {
                        username: targetUser.username,
                        avatarURL: avatarURL,
                        level: stats.level,
                        rank: stats.rank,
                        currentXP: stats.xpProgress,
                        requiredXP: stats.xpNeeded,
                        totalXP: stats.xp
                    };
                    const cardBuffer = await rankCardRenderer.generateCard(cardData);
                    const attachment = new AttachmentBuilder(cardBuffer, { name: `rank-${targetUser.id}.png` });
                    return await interaction.editReply({ files: [attachment] });
                } catch (_) {
                    // Fall through to embed
                }
            }

            // Fallback: text embed
            const { EmbedBuilder } = require('discord.js');
            const progressBar = createProgressBar(stats.progressPercent);
            const embed = new EmbedBuilder()
                .setColor('#00d4ff')
                .setAuthor({ name: `${targetUser.username}'s Rank`, iconURL: targetUser.displayAvatarURL() })
                .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                .addFields(
                    { name: '🏆 Rank', value: `#${stats.rank}`, inline: true },
                    { name: '⭐ Level', value: `${stats.level}`, inline: true },
                    { name: '✨ Total XP', value: `${stats.xp.toLocaleString()}`, inline: true },
                    { name: '📊 Progress', value: `${progressBar} ${Math.round(stats.progressPercent)}%\n${stats.xpProgress.toLocaleString()} / ${stats.xpNeeded.toLocaleString()} XP`, inline: false }
                )
                .setFooter({ text: `🔥 ${stats.streak} day streak • ${stats.totalMessages.toLocaleString()} messages` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error executing rank command:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nAn error occurred while generating your rank card. Please try again later.'
            }).catch(() => {});
        }
    }
};

function createProgressBar(percent, length = 12) {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}
