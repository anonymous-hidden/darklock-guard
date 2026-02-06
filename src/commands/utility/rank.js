const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const rankCardRenderer = require('../../utils/rankCardRenderer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your XP rank card or another user\'s rank')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guild.id;
            const xpDatabase = interaction.client.xpDatabase;

            if (!xpDatabase) {
                return await interaction.editReply({
                    content: '❌ XP system is not initialized.',
                    ephemeral: true
                });
            }

            // Check if XP system is enabled
            const settings = await xpDatabase.getGuildSettings(guildId);
            if (!settings.xp_enabled) {
                return interaction.editReply({
                    content: '❌ **XP System Disabled**\n\nThe XP system is not enabled on this server.\n\n**To enable:** Use `/xp enable` (requires Administrator permission)',
                    ephemeral: true
                });
            }

            // Get user stats
            const stats = await xpDatabase.getUserStats(targetUser.id, guildId);
            
            if (!stats || stats.xp === 0) {
                return interaction.editReply({
                    content: `📊 **No Rank Data**\n\n${targetUser.username} hasn't earned any XP yet! Start chatting to earn XP and level up.`,
                    ephemeral: true
                });
            }

            // Get avatar URL (high quality)
            const avatarURL = targetUser.displayAvatarURL({ 
                extension: 'png', 
                size: 256 
            });

            // Prepare data for card renderer
            const cardData = {
                username: targetUser.username,
                avatarURL: avatarURL,
                level: stats.level || 0,
                rank: stats.rank || 0,
                currentXP: stats.xp_progress || 0,
                requiredXP: stats.xp_needed || 100,
                totalXP: stats.xp || 0
            };

            // Generate card image
            const cardBuffer = await rankCardRenderer.generateCard(cardData);

            // Create attachment
            const attachment = new AttachmentBuilder(cardBuffer, { 
                name: `rank-${targetUser.id}.png` 
            });

            // Send the image
            await interaction.editReply({ 
                files: [attachment]
            });

        } catch (error) {
            console.error('Error executing rank command:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nAn error occurred while generating your rank card. Please try again later.',
                ephemeral: true
            }).catch(() => {});
        }
    }
};
