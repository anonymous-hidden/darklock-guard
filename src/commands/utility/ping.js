const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and response time'),

    async execute(interaction) {
        const sent = await interaction.reply({
            content: 'Checking latency...',
            fetchReply: true,
            ephemeral: true
        });

        const responseTime = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);
        const bot = interaction.client.bot;
        let databaseStatus = 'not available';
        if (bot?.database) {
            try {
                await bot.database.get('SELECT 1 AS ok');
                databaseStatus = 'connected';
            } catch {
                databaseStatus = 'error';
            }
        }

        await interaction.editReply({
            content:
                `DarkLock is online.\n` +
                `Bot latency: ${responseTime}ms\n` +
                `Discord API: ${apiLatency}ms\n` +
                `Database: ${databaseStatus}`,
            embeds: []
        });

        // Log command usage to dashboard
        try {
            const bot = interaction.client.bot;
            if (bot && bot.dashboardLogger) {
                await bot.dashboardLogger.logCommandUsage(
                    'ping',
                    interaction.user.id,
                    interaction.user.username,
                    interaction.guild.id,
                    interaction.guild.name,
                    { responseTime, apiLatency, databaseStatus }
                );
            }
        } catch (error) {
            // Silent fail - don't break command if logging fails
            console.error('Dashboard logging failed for ping command:', error);
        }
    },
};
