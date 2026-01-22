/**
 * /settings - Alias/Redirect to /setup
 * Many users expect /settings to exist
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('⚙️ Server settings - Redirects to /setup')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Server Settings')
            .setDescription('All server configuration has been consolidated into the `/setup` command!')
            .setColor('#5865F2')
            .addFields(
                {
                    name: '📊 View All Config',
                    value: '`/setup view` - See everything at once',
                    inline: false
                },
                {
                    name: '🔧 Common Setup Commands',
                    value: [
                        '`/setup wizard start` - Interactive setup',
                        '`/setup welcome setup` - Welcome messages',
                        '`/setup goodbye setup` - Goodbye messages',
                        '`/setup roles add` - Auto-roles',
                        '`/setup language set` - Server language'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🤖 Automod Settings',
                    value: '`/automod status` - View all protection settings',
                    inline: false
                },
                {
                    name: '🎫 Ticket Settings',
                    value: '`/ticket setup` - Configure ticket system',
                    inline: false
                }
            )
            .setFooter({ text: 'Tip: Use /setup view for a quick overview!' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
