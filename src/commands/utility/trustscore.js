const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trustscore')
        .setDescription('View your trust score or another user\'s')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (leave empty for yourself)')
                .setRequired(false)
        ),

    async execute(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get target user (or interaction user if not specified)
            const targetUser = interaction.options.getUser('user') || interaction.user;

            // Check if trust score system exists
            if (!bot.trustScore) {
                return await interaction.editReply({
                    content: '❌ Trust score system is not enabled.',
                    ephemeral: true
                });
            }

            // Calculate trust score
            const result = await bot.trustScore.calculateScore(
                interaction.guild.id,
                targetUser.id
            );

            // Get embed data
            const embedData = bot.trustScore.getScoreEmbed(
                result.score,
                result.level,
                result.factors
            );

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle(embedData.title)
                .setColor(embedData.color)
                .setDescription(
                    `Trust assessment for **${targetUser.tag}**\n\n` +
                    `A trust score reflects behavior patterns, account age, and moderation history. ` +
                    `Higher scores may grant access to features that require trust.`
                )
                .addFields(embedData.fields)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setFooter({ 
                    text: 'Trust scores are calculated from behavior, not user actions',
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })
                .setTimestamp();

            // Add warnings count if viewing self
            if (targetUser.id === interaction.user.id && result.factors.warnings > 0) {
                embed.addFields({
                    name: '⚠️ Active Warnings',
                    value: `You have ${result.factors.warnings} active warning(s) affecting your score.`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

            // Log the lookup
            if (bot.logger) {
                await bot.logger.logCommand({
                    commandName: 'trustscore',
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id,
                    options: { targetUserId: targetUser.id },
                    success: true
                });
            }

        } catch (error) {
            console.error('Error in trustscore command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while calculating trust score.',
                ephemeral: true
            });
        }
    }
};
