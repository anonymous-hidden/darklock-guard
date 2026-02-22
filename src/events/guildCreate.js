/**
 * guildCreate Event Handler
 * Triggered when the bot is added to a new server
 * Sends DM to server owner with setup instructions
 */

const { EmbedBuilder, Events } = require('discord.js');

const CONFIG = {
    SUPPORT_SERVER_INVITE: 'https://discord.gg/Vsq9PUTrgb',
    BOT_NAME: 'Security Bot',
    BOT_COLOR: '#00d4ff'
};

module.exports = {
    name: Events.GuildCreate,
    once: false,

    async execute(guild, client) {
        try {
            console.log(`[GUILD_CREATE] Bot added to new guild: ${guild.name} (${guild.id})`);

            // Initialize guild config row so all defaults are in place
            const bot = client.bot || client;
            if (bot.configService) {
                await bot.configService.initializeGuild(guild.id);
                console.log(`[GUILD_CREATE] Initialized config for ${guild.name}`);
            } else if (bot.database) {
                await bot.database.run(
                    'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)',
                    [guild.id]
                );
            }

            const owner = await guild.fetchOwner().catch(() => null);
            if (!owner) {
                console.error(`[GUILD_CREATE] Could not fetch owner of ${guild.name}`);
                return;
            }

            await sendSetupDM(owner, guild, client);
        } catch (error) {
            console.error('[GUILD_CREATE] Error:', error);
        }
    }
};

async function sendSetupDM(owner, guild, client) {
    try {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('👋 Welcome to DarkLock!')
            .setDescription(
                `DarkLock is your all-in-one Discord security bot — protecting your server from raids, nukes, phishing, spam, and more.\n\n` +
                `🎯 I'm currently performing an initial security scan of your server to check for existing threats. This will complete in a few minutes.`
            )
            .setColor(0x6366f1)
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        await owner.send({ embeds: [welcomeEmbed] });
        console.log(`[GUILD_CREATE] Sent welcome DM to ${owner.user.tag} (${guild.name})`);

    } catch (error) {
        console.log(`[GUILD_CREATE] Could not DM owner: ${error.message}`);
    }
}

async function sendSystemChannelFallback(guild, client) {
    try {
        let targetChannel = guild.systemChannel;
        if (!targetChannel) {
            targetChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.permissionsFor(client.user).has(['SendMessages', 'EmbedLinks'])
            );
        }

        if (!targetChannel) {
            console.log(`[GUILD_CREATE] No suitable channel found in ${guild.name} for fallback message`);
            return;
        }

        const dashboardURL = process.env.DASHBOARD_URL || 'https://darklock.xyz/dashboard';
        const fallbackEmbed = new EmbedBuilder()
            .setTitle('🛡️ DarkLock Security Bot - Welcome!')
            .setDescription(
                `Hey <@${guild.ownerId}>! I tried to DM you setup instructions, but your DMs are closed.\n\n` +
                '**🚀 Quick Start:**\n' +
                '• Type `/wizard` for interactive setup guide\n' +
                '• Use `/security enable` to enable protection features\n' +
                '• Visit the dashboard for full control\n' +
                `• Get help: ${CONFIG.SUPPORT_SERVER_INVITE}\n\n` +
                `**🌐 Dashboard:** ${dashboardURL}\n` +
                '**📚 Commands:** Type `/help` to see all available commands'
            )
            .setColor(CONFIG.BOT_COLOR)
            .setFooter({ text: 'DarkLock - Protecting your server 24/7' })
            .setTimestamp();

        await targetChannel.send({ content: `<@${guild.ownerId}>`, embeds: [fallbackEmbed] });
        console.log(`[GUILD_CREATE] Sent fallback message in #${targetChannel.name} (${guild.name})`);

    } catch (error) {
        console.error(`[GUILD_CREATE] Fallback message failed for ${guild.name}:`, error.message);
    }
}

async function logBotStats(guild, client, action) {
    try {
        const statsChannelId = process.env.STATS_CHANNEL_ID;
        if (!statsChannelId) return;

        const statsChannel = client.channels.cache.get(statsChannelId);
        if (!statsChannel) return;

        const totalGuilds = client.guilds.cache.size;
        const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

        const statsEmbed = new EmbedBuilder()
            .setTitle(action === 'join' ? '?? Bot Added to Guild' : '?? Bot Removed from Guild')
            .setDescription(`**${guild.name}**\n\`${guild.id}\``)
            .addFields(
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Total Guilds', value: `${totalGuilds}`, inline: true },
                { name: 'Total Users', value: `${totalMembers.toLocaleString()}`, inline: true }
            )
            .setColor(action === 'join' ? '#00FF00' : '#FF0000')
            .setThumbnail(guild.iconURL() || undefined)
            .setTimestamp();

        await statsChannel.send({ embeds: [statsEmbed] });
    } catch (error) {
        console.error('[GUILD_CREATE] Failed to log stats:', error);
    }
}
