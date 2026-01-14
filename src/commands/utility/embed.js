const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Create a custom embed message')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Embed title')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Embed description')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color (hex code like #5865F2)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('footer')
                .setDescription('Embed footer text')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('image')
                .setDescription('Image URL')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('thumbnail')
                .setDescription('Thumbnail URL')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to send to (defaults to current)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color') || '#5865F2';
        const footer = interaction.options.getString('footer');
        const image = interaction.options.getString('image');
        const thumbnail = interaction.options.getString('thumbnail');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        if (footer) embed.setFooter({ text: footer });
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);

        try {
            await channel.send({ embeds: [embed] });

            await interaction.editReply({
                content: `✅ Embed sent to ${channel}`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to send embed. Check URLs and permissions.',
                ephemeral: true
            });
        }
    }
};
