const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, bot) {
        try {
            const guild = member.guild;
            const config = bot.configService
                ? await bot.configService.resolveEffective(guild.id)
                : await bot.database.getGuildConfig(guild.id);

            const welcomeOn = !!config?.welcome_enabled;
            const verifyOn = !!config?.verification_enabled;

            // Apply autoroles (if enabled and verification is off or bypasses bots for bots)
            if (config?.autorole_enabled) {
                // Check if we should skip bots
                const skipBots = config?.autorole_bypass_bots && member.user.bot;
                if (!skipBots) {
                    // Delay if configured
                    const delay = (config?.autorole_delay_seconds || 0) * 1000;
                    if (delay > 0) {
                        setTimeout(() => applyAutoroles(member, bot), delay);
                    } else {
                        await applyAutoroles(member, bot);
                    }
                }
            }

            // Case 1: Welcome ON, Verification OFF -> send welcome immediately
            if (welcomeOn && !verifyOn) {
                bot.logger?.info(`[JOIN] Welcome ON, Verification OFF for ${member.user.tag}`);
                await sendImmediateWelcome(member, config, bot);
                return;
            }

            // Case 2: Welcome OFF, Verification ON -> run verification only (no welcome)
            if (!welcomeOn && verifyOn) {
                bot.logger?.info(`[JOIN] Welcome OFF, Verification ON for ${member.user.tag}`);
                const Actions = require('../security/verificationActions');
                if (!bot.verificationActions) bot.verificationActions = new Actions(bot);
                await bot.verificationActions.handleJoin(member);
                return;
            }

            // Case 3: Both ON -> run verification, defer welcome until after verification completes
            if (welcomeOn && verifyOn) {
                bot.logger?.info(`[JOIN] Both Welcome and Verification ON for ${member.user.tag}; deferring welcome`);
                const Actions = require('../security/verificationActions');
                if (!bot.verificationActions) bot.verificationActions = new Actions(bot);
                await bot.verificationActions.handleJoin(member);
                return;
            }

            // Case 4: Both OFF -> do nothing special
            bot.logger?.debug(`[JOIN] Both welcome and verification OFF for ${member.user.tag}; normal entry`);

        } catch (error) {
            bot.logger?.error('Error processing member join:', error);
        }
    }
};

/**
 * Apply autoroles to a new member
 * Reads from the autoroles table (shared with /autorole command)
 */
async function applyAutoroles(member, bot) {
    try {
        const autoroles = await bot.database.all(
            'SELECT role_id FROM autoroles WHERE guild_id = ?',
            [member.guild.id]
        );
        
        if (!autoroles || autoroles.length === 0) {
            bot.logger?.debug(`[AUTOROLE] No autoroles configured for ${member.guild.name}`);
            return;
        }
        
        const rolesToAdd = [];
        for (const ar of autoroles) {
            const role = member.guild.roles.cache.get(ar.role_id);
            if (role && !role.managed && role.position < member.guild.members.me.roles.highest.position) {
                rolesToAdd.push(role);
            }
        }
        
        if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, 'Autorole assignment');
            bot.logger?.info(`[AUTOROLE] Applied ${rolesToAdd.length} autoroles to ${member.user.tag}`);
        }
    } catch (e) {
        bot.logger?.warn(`[AUTOROLE] Failed to apply autoroles to ${member.user.tag}:`, e.message);
    }
}

async function sendImmediateWelcome(member, config, bot) {
    try {
        const guild = member.guild;
        // Check both column names: new dashboard saves welcome_channel_id, /welcome command saves welcome_channel
        const channelId = config?.welcome_channel_id || config?.welcome_channel;
        const channel = channelId ? guild.channels.cache.get(channelId) : guild.systemChannel;
        if (!channel || !channel.isTextBased()) return;

        let customization;
        try {
            customization = JSON.parse(config.welcome_message);
        } catch (e) {
            customization = { message: config.welcome_message || 'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉' };
        }

        const message = customization.message
            .replace(/{user}/g, member.user.toString())
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{memberCount}/g, guild.memberCount.toString());

        // Check if using embed
        const useEmbed = config?.welcome_embed_enabled;
        const pingUser = config?.welcome_ping_user;

        if (useEmbed) {
            const embed = new EmbedBuilder()
                .setColor(customization.embedColor || '#00d4ff')
                .setDescription(message)
                .setTimestamp();

            if (customization.embedTitle) embed.setTitle(customization.embedTitle);
            if (customization.imageUrl) embed.setImage(customization.imageUrl);

            const msgOptions = { embeds: [embed] };
            if (pingUser) msgOptions.content = member.user.toString();

            const sent = await channel.send(msgOptions);
            
            // Auto-delete if configured
            if (config?.welcome_delete_after && config.welcome_delete_after > 0) {
                setTimeout(() => sent.delete().catch(() => {}), config.welcome_delete_after * 1000);
            }
        } else {
            const content = pingUser ? `${member.user.toString()} ${message}` : message;
            const sent = await channel.send({ content });
            
            // Auto-delete if configured
            if (config?.welcome_delete_after && config.welcome_delete_after > 0) {
                setTimeout(() => sent.delete().catch(() => {}), config.welcome_delete_after * 1000);
            }
        }

        bot.logger?.info(`[WELCOME] Sent immediate welcome for ${member.user.tag}`);
    } catch (e) {
        member.guild.client.bot?.logger?.warn('[WELCOME] Failed to send immediate welcome:', e.message);
    }
}
