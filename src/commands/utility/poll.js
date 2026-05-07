const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a poll')
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Poll question')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('option1')
                .setDescription('First option')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('option2')
                .setDescription('Second option')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('option3')
                .setDescription('Third option')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('option4')
                .setDescription('Fourth option')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Poll duration in hours (default: 1)')
                .setMinValue(1)
                .setMaxValue(336)) // 2 weeks
        .addBooleanOption(option =>
            option.setName('multiselect')
                .setDescription('Allow multiple answers? (default: false)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        const question = interaction.options.getString('question');
        const options = [
            interaction.options.getString('option1'),
            interaction.options.getString('option2'),
            interaction.options.getString('option3'),
            interaction.options.getString('option4')
        ].filter(o => o !== null);

        const duration = interaction.options.getInteger('duration') || 1;
        const multiselect = interaction.options.getBoolean('multiselect') || false;

        await interaction.followUp({
            poll: {
                allowMultiselect: multiselect,
                answers: options.map(opt => {
                    return { text: opt };
                }),
                duration: duration,
                question: {
                    text: question
                },
            }
        });
    }
};
