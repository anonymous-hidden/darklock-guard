const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement to a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Announcement title')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Announcement message')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to send announcement to')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color')
                .addChoices(
                    { name: 'Blue', value: '#5865F2' },
                    { name: 'Green', value: '#57F287' },
                    { name: 'Red', value: '#ED4245' },
                    { name: 'Yellow', value: '#FEE75C' },
                    { name: 'Purple', value: '#9B59B6' }
                ))
        .addBooleanOption(option =>
            option.setName('ping')
                .setDescription('Ping @everyone (requires permissions)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const title = interaction.options.getString('title');
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const color = interaction.options.getString('color') || '#5865F2';
        const ping = interaction.options.getBoolean('ping') || false;

        const embed = new EmbedBuilder()
            .setTitle('📢 ' + title)
            .setDescription(message)
            .setColor(color)
            .setFooter({ text: `Announced by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();

        try {
            const content = ping ? '@everyone' : null;
            await channel.send({ content, embeds: [embed] });

            await interaction.editReply({
                content: `✅ Announcement sent to ${channel}`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to send announcement. Check bot permissions.',
                ephemeral: true
            });
        }
    }
};
