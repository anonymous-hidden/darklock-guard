const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and response time'),

    async execute(interaction) {
        const sent = await interaction.reply({ 
            content: '🏃‍♂️ Checking latency...', 
            fetchReply: true,
            ephemeral: true 
        });

        const responseTime = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        // Determine status based on latency
        let status = '🟢 Excellent';
        let color = '#2ed573';
        
        if (responseTime > 200 || apiLatency > 150) {
            status = '🟡 Good';
            color = '#ffa502';
        }
        
        if (responseTime > 500 || apiLatency > 300) {
            status = '🟠 Fair';
            color = '#ff6348';
        }
        
        if (responseTime > 1000 || apiLatency > 500) {
            status = '🔴 Poor';
            color = '#ff4757';
        }

        const pingEmbed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setDescription(`Bot latency and performance metrics`)
            .addFields(
                { name: '⚡ Response Time', value: `${responseTime}ms`, inline: true },
                { name: '💫 API Latency', value: `${apiLatency}ms`, inline: true },
                { name: '📊 Status', value: status, inline: true }
            )
            .setColor(color)
            .setTimestamp();

        // Add additional metrics if available
        if (interaction.client.uptime) {
            const uptime = Math.floor(interaction.client.uptime / 1000);
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;
            
            let uptimeString = '';
            if (days > 0) uptimeString += `${days}d `;
            if (hours > 0) uptimeString += `${hours}h `;
            if (minutes > 0) uptimeString += `${minutes}m `;
            uptimeString += `${seconds}s`;
            
            pingEmbed.addFields({ name: '⏱️ Uptime', value: uptimeString, inline: true });
        }

        // Add memory usage if available
        const memoryUsage = process.memoryUsage();
        const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        pingEmbed.addFields({ name: '🧠 Memory Usage', value: `${memoryMB}MB`, inline: true });

        await interaction.editReply({ 
            content: null, 
            embeds: [pingEmbed] 
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
                    { responseTime, apiLatency, status }
                );
            }
        } catch (error) {
            // Silent fail - don't break command if logging fails
            console.error('Dashboard logging failed for ping command:', error);
        }
    },
};