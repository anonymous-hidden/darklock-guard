/**
 * guildCreate Event Handler
 * Triggered when the bot is added to a new server
 * Sends DM to server owner with setup instructions
 */

const { EmbedBuilder, Events } = require('discord.js');

const CONFIG = {
    SUPPORT_SERVER_INVITE: 'https://discord.gg/r8dvnad9c9',
    BOT_NAME: 'Security Bot',
    BOT_COLOR: '#00d4ff'
};

module.exports = {
    name: Events.GuildCreate,
    once: false,

    async execute(guild, client) {
        try {
            console.log(`[GUILD_CREATE] Bot added to new guild: ${guild.name} (${guild.id})`);
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
        const setupEmbed = new EmbedBuilder()
            .setAuthor({ name: `Thanks for adding ${CONFIG.BOT_NAME}!`, iconURL: client.user.displayAvatarURL() })
            .setTitle('??? Welcome to Guardian Security Bot!')
            .setDescription(`Hey ${owner.user.username}! Thanks for adding me to **${guild.name}**.\n\nI'm here to keep your server safe with powerful security and moderation tools.`)
            .setColor(CONFIG.BOT_COLOR)
            .addFields(
                {
                    name: '? Quick Start Guide',
                    value: '**1.** Run `/wizard` for interactive setup\n**2.** Configure security with `/security`\n**3.** Set up welcome & verification\n**4.** Enable moderation logging',
                    inline: false
                },
                {
                    name: '??? Security & Protection',
                    value: '• **Anti-Nuke** - Protects against mass deletions\n• **Anti-Raid** - Detects coordinated attacks\n• **Anti-Spam** - Stops message floods\n• **Anti-Phishing** - Blocks malicious links\n• **Verification System** - Screen new members',
                    inline: false
                },
                {
                    name: '?? Moderation Arsenal',
                    value: '• Ban, Kick, Timeout, Warn\n• Mass purge & channel lock\n• Case management system\n• Mod notes & user tracking\n• Automated actions & logging',
                    inline: true
                },
                {
                    name: '??? Advanced Tickets',
                    value: '• Multi-category support\n• Auto transcripts\n• Staff assignment\n• Priority system\n• Full logging & analytics',
                    inline: true
                },
                {
                    name: '?? Analytics & Insights',
                    value: '• Server activity tracking\n• Member join/leave patterns\n• Command usage stats\n• Security incident reports\n• Customizable dashboards',
                    inline: false
                },
                {
                    name: '?? Web Dashboard',
                    value: `Manage everything from your browser!\n• ${process.env.DASHBOARD_URL || 'Configure DASHBOARD_URL in .env'}\n• Real-time settings\n• Visual customization\n• Role & permission management`,
                    inline: false
                },
                {
                    name: '? Pro Features Available',
                    value: '• Advanced AI moderation\n• Custom branding & themes\n• Priority support\n• Extended analytics\n• Automation workflows',
                    inline: false
                },
                {
                    name: '? Need Help?',
                    value: `• **Support Server:** ${CONFIG.SUPPORT_SERVER_INVITE}\n• **Commands:** Use \`/help\` anytime\n• **Setup Wizard:** \`/wizard\` for step-by-step guide`,
                    inline: false
                },
                {
                    name: '?? Required Permissions',
                    value: '**Administrator** (recommended) or at minimum:\n• Manage Server, Roles & Channels\n• Kick & Ban Members\n• Manage Messages & Threads\n• View Audit Log\n\n**Important:** My role must be above the roles I manage!',
                    inline: false
                }
            )
            .setFooter({ text: `${guild.name} • Server ID: ${guild.id}` })
            .setTimestamp();

        await owner.send({ embeds: [setupEmbed] });
        console.log(`[GUILD_CREATE] Sent setup DM to ${owner.user.tag} (${guild.name})`);

        // Quick follow-up with essential links
        await owner.send({
            content: '**?? Ready to get started?**\n\n' +
                `?? **Dashboard:** ${process.env.DASHBOARD_URL || 'Configure in your .env file'}\n` +
                `?? **Support Server:** ${CONFIG.SUPPORT_SERVER_INVITE}\n` +
                `?? **Quick Command:** Type \`/wizard\` in your server to begin interactive setup!\n\n` +
                '_All features are unlocked and ready to use. Have questions? Join our support server!_'
        });

    } catch (error) {
        console.log(`[GUILD_CREATE] Could not DM owner ${owner.user.tag}: ${error.message}`);
        await sendSystemChannelFallback(guild, client);
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

        const fallbackEmbed = new EmbedBuilder()
            .setTitle('??? Guardian Security Bot - Welcome!')
            .setDescription(
                `Hey <@${guild.ownerId}>! I tried to DM you setup instructions, but your DMs are closed.\n\n` +
                '**?? Quick Start:**\n' +
                '• Type `/wizard` for interactive setup guide\n' +
                '• Use `/security` to enable protection features\n' +
                '• Visit the dashboard for full control\n' +
                `• Get help: ${CONFIG.SUPPORT_SERVER_INVITE}\n\n` +
                `**?? Dashboard:** ${process.env.DASHBOARD_URL || 'Configure DASHBOARD_URL in .env'}\n` +
                '**?? Commands:** Type `/help` to see all available commands'
            )
            .setColor(CONFIG.BOT_COLOR)
            .setFooter({ text: 'All features unlocked and ready to use!' })
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
