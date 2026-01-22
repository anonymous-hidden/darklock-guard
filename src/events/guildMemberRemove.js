const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'guildMemberRemove',
    async execute(member, bot) {
        const guildId = member.guild.id;
        const userId = member.user.id;
        
        try {
            // Get guild configuration
            const config = await bot.database.getGuildConfig(guildId);
            
            // Log the leave
            bot.logger.info(`👋 Member left: ${member.user.tag} (${userId}) from ${member.guild.name}`);
            
            // Update analytics
            const now = new Date();
            const date = now.toISOString().split('T')[0];
            const hour = now.getHours();
            
            await bot.database.run(`
                INSERT OR IGNORE INTO analytics 
                (guild_id, metric_type, metric_value, date, hour)
                VALUES (?, 'leaves', 1, ?, ?)
                ON CONFLICT(guild_id, metric_type, date, hour) DO UPDATE SET
                metric_value = metric_value + 1
            `, [guildId, date, hour]);
            
            // Emit member leave event to dashboard
            if (bot.eventEmitter) {
                await bot.eventEmitter.emitMemberLeave(guildId, member, 'left');
            }

            // Send goodbye message if enabled
            if (config.goodbye_enabled) {
                await sendGoodbyeMessage(member, config, bot);
            }

        } catch (error) {
            bot.logger.error(`Error processing member leave for ${member.user.tag}:`, error);
            
            // Attempt to reconnect database if connection lost
            if (error.message.includes('database') || error.message.includes('SQLITE')) {
                bot.logger.warn('Database connection issue detected, attempting reconnect...');
                try {
                    await bot.database.initialize();
                    bot.logger.info('✅ Database reconnected successfully');
                } catch (reconnectError) {
                    bot.logger.error('❌ Failed to reconnect database:', reconnectError);
                }
            }
        }
    }
};

async function sendGoodbyeMessage(member, config, bot) {
    try {
        const guild = member.guild;
        const channelId = config?.goodbye_channel_id;
        const channel = channelId ? guild.channels.cache.get(channelId) : guild.systemChannel;
        if (!channel || !channel.isTextBased()) return;

        const message = (config.goodbye_message || 'Goodbye {user}! We\'ll miss you from {server}. 😢')
            .replace(/{user}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{memberCount}/g, guild.memberCount.toString());

        // Check if using embed
        const useEmbed = config?.goodbye_embed_enabled;

        if (useEmbed) {
            const embed = new EmbedBuilder()
                .setColor('#ef4444')
                .setDescription(message)
                .setTimestamp();

            const sent = await channel.send({ embeds: [embed] });
            
            // Auto-delete if configured
            if (config?.goodbye_delete_after && config.goodbye_delete_after > 0) {
                setTimeout(() => sent.delete().catch(() => {}), config.goodbye_delete_after * 1000);
            }
        } else {
            const sent = await channel.send({ content: message });
            
            // Auto-delete if configured
            if (config?.goodbye_delete_after && config.goodbye_delete_after > 0) {
                setTimeout(() => sent.delete().catch(() => {}), config.goodbye_delete_after * 1000);
            }
        }

        bot.logger?.info(`[GOODBYE] Sent goodbye message for ${member.user.tag}`);
    } catch (e) {
        bot.logger?.warn('[GOODBYE] Failed to send goodbye message:', e.message);
    }
}
