const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function getInviteUrl(interaction) {
    const configured = process.env.BOT_INVITE_URL;
    if (configured) return configured;
    const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || interaction.client.user?.id;
    return clientId
        ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`
        : 'https://darklock.net';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get the DarkLock invite link and invite-tracking status'),

    async execute(interaction) {
        const tracker = interaction.client.inviteTracker;
        let trackingStatus = 'Invite tracking is not available right now.';

        if (tracker && interaction.guildId) {
            const config = await tracker.getConfig(interaction.guildId).catch(() => null);
            trackingStatus = config?.enabled
                ? 'Invite tracking is enabled for this server.'
                : 'Invite tracking is available but not enabled. Use `/invites setup` and `/invites toggle`.';
        }

        const embed = new EmbedBuilder()
            .setTitle('Invite DarkLock')
            .setColor(0x5865F2)
            .setDescription(getInviteUrl(interaction))
            .addFields({ name: 'Invite Tracking', value: trackingStatus })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
