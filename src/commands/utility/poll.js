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
                .setDescription('Poll duration in minutes (default: 60)')
                .setMinValue(1)
                .setMaxValue(10080)),

    async execute(interaction) {
        await interaction.deferReply();
        
        const question = interaction.options.getString('question');
        const options = [
            interaction.options.getString('option1'),
            interaction.options.getString('option2'),
            interaction.options.getString('option3'),
            interaction.options.getString('option4')
        ].filter(o => o !== null);

        const duration = interaction.options.getInteger('duration') || 60;
        const endTime = new Date(Date.now() + duration * 60000);

        const embed = new EmbedBuilder()
            .setTitle('📊 ' + question)
            .setColor('#5865F2')
            .setDescription(options.map((opt, i) => `${['1️⃣', '2️⃣', '3️⃣', '4️⃣'][i]} ${opt}`).join('\n\n'))
            .setFooter({ text: `Poll ends at ${endTime.toLocaleTimeString()} | ${duration} minutes` })
            .setTimestamp();

        const msg = await interaction.editReply({
            embeds: [embed],
            fetchReply: true
        });

        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'].slice(0, options.length);
        for (const emoji of emojis) {
            await msg.react(emoji);
        }

        // Store poll in database
        const bot = interaction.client.bot;
        try {
            await bot.database.run(`
                INSERT INTO polls (guild_id, channel_id, message_id, question, options, creator_id, ends_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [interaction.guild.id, interaction.channel.id, msg.id, question, JSON.stringify(options), interaction.user.id, endTime.toISOString()]);
        } catch (error) {
            console.error('Failed to store poll:', error);
        }
    }
};
