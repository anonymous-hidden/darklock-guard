/**
 * Message Create Event Handler
 * Handles all guild message events for security, XP, and logging
 */

const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message, bot) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Handle DMs for ModMail
        if (!message.guild) {
            if (bot.modmail) {
                try {
                    await bot.modmail.handleDM(message);
                } catch (err) {
                    bot.logger.debug('ModMail DM error:', err.message);
                }
            }
            return;
        }

        try {
            // Get guild config once for all checks
            const guildConfig = await bot.database.getGuildConfig(message.guild.id).catch(() => ({}));

            // Anti-spam check
            if (bot.antiSpam && guildConfig.anti_spam_enabled !== 0) {
                const spamResult = await bot.antiSpam.checkMessage(message);
                // checkMessage returns true if spam detected
                if (spamResult === true) {
                    bot.logger.debug(`Spam detected, message handled by antiSpam`);
                    return;
                }
            }

            // Word Filter check (custom auto-mod)
            if (bot.wordFilter) {
                const filterResult = await bot.wordFilter.checkMessage(message);
                if (filterResult?.blocked) {
                    bot.logger.debug(`Word filter triggered: ${filterResult.filter?.filter_name}`);
                    return;
                }
            }

            // Emoji/Sticker spam check
            if (bot.emojiSpam) {
                const emojiResult = await bot.emojiSpam.checkMessage(message);
                if (emojiResult?.isSpam) {
                    bot.logger.debug(`Emoji spam detected: ${emojiResult.reason}`);
                    return;
                }
            }

            // Unified link analysis
            if (bot.linkAnalyzer) {
                const linkResult = await bot.linkAnalyzer.analyzeMessage(message);
                if (linkResult?.dominated) return;
            }

            // Toxicity filter (part of auto-mod)
            if (bot.toxicityFilter && guildConfig.auto_mod_enabled !== 0) {
                await bot.toxicityFilter.checkMessage(message);
            }

            // Behavior detection
            if (bot.behaviorDetection) {
                await bot.behaviorDetection.trackUserBehavior(message);
            }
            
            // Alt detector behavior fingerprinting
            if (bot.altDetector) {
                try {
                    await bot.altDetector.updateBehaviorFromMessage(message);
                } catch (err) {
                    // Silent fail - non-critical
                }
            }
            
            // Security Manager comprehensive check
            if (bot.securityManager) {
                await bot.securityManager.handleMessage(message);
            }
            
            // Analytics tracking
            if (bot.analyticsManager) {
                await bot.analyticsManager.trackMessage(message);
            }

            // Rank System: Add XP for message
            if (bot.rankSystem) {
                await handleXPGain(message, bot, guildConfig);
            }

            // Ticket system message logging
            if (bot.ticketSystem) {
                await bot.ticketSystem.handleTicketMessage(message);
            }
        } catch (error) {
            bot.logger.error('Error in message handler:', error);
        }
    }
};

/**
 * Handle XP gain and level-up notifications
 */
async function handleXPGain(message, bot, guildConfig) {
    // Check if XP is enabled for this guild
    if (!guildConfig?.xp_enabled) {
        return;
    }

    // Anti-ghost XP protection
    const content = message.content.trim();
    
    // Check minimum length (5 characters)
    if (content.length < 5) {
        return;
    }
    // Check emoji-only messages
    if (/^[\p{Emoji}\s]+$/u.test(content)) {
        return;
    }
    
    // Award XP using the rank system (handles cooldowns internally)
    const result = await bot.rankSystem.awardMessageXP(message.guild.id, message.author.id);
    
    // If user leveled up, send congratulations
    if (result && result.leveledUp) {
        // Get guild config for custom level-up message
        const config = await bot.database.getGuildConfig(message.guild.id);
        
        // Build custom message with variable replacement
        const defaultMessage = 'Congratulations {user}! You\'ve reached **Level {level}**!';
        let customMessage = config?.xp_levelup_message || defaultMessage;
        
        // Get user stats for message count
        const userStats = await bot.rankSystem.getUserStats(message.guild.id, message.author.id);
        
        // Replace variables
        customMessage = customMessage
            .replace(/{user}/g, message.author.toString())
            .replace(/{username}/g, message.author.username)
            .replace(/{level}/g, result.newLevel.toString())
            .replace(/{xp}/g, formatXP(result.totalXP))
            .replace(/{messages}/g, (userStats.total_messages || 0).toString());
        
        const embedTitle = config?.xp_levelup_title || '🎉 Level Up!';
        const embedColor = config?.xp_levelup_embed_color || '#00d4ff';
        const showXP = config?.xp_levelup_show_xp !== 0;
        const showMessages = config?.xp_levelup_show_messages !== 0;

        const levelUpEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(embedTitle)
            .setDescription(customMessage)
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        // Add optional fields
        if (showXP) {
            levelUpEmbed.addFields({ name: 'Total XP', value: formatXP(result.totalXP), inline: true });
        }
        if (showMessages) {
            levelUpEmbed.addFields({ name: 'Messages', value: (userStats.total_messages || 0).toString(), inline: true });
        }

        try {
            // Check for custom level-up channel
            const levelUpChannelId = config?.xp_levelup_channel;
            const targetChannel = levelUpChannelId 
                ? message.guild.channels.cache.get(levelUpChannelId) 
                : message.channel;
                
            if (targetChannel && targetChannel.isTextBased()) {
                await targetChannel.send({ embeds: [levelUpEmbed] });
            } else {
                await message.channel.send({ embeds: [levelUpEmbed] });
            }
            
            bot.logger.info(`User ${message.author.tag} leveled up to ${result.newLevel} in ${message.guild.name}`);
        } catch (e) {
            // Couldn't send level up message (permissions)
            bot.logger.warn(`Failed to send level up message: ${e.message}`);
        }
        
        // Check for role rewards (level roles configured in dashboard)
        await checkLevelRoleRewards(message, bot, result.newLevel);
    }
}

/**
 * Check and assign level role rewards
 */
async function checkLevelRoleRewards(message, bot, newLevel) {
    try {
        // Get level roles from database
        const levelRoles = await bot.database.all(
            'SELECT * FROM level_roles WHERE guild_id = ? AND level <= ? ORDER BY level DESC',
            [message.guild.id, newLevel]
        );

        for (const levelRole of levelRoles) {
            const role = message.guild.roles.cache.get(levelRole.role_id);
            if (role && !message.member.roles.cache.has(role.id)) {
                try {
                    await message.member.roles.add(role);
                    
                    // Announce if it's a milestone level
                    if (levelRole.level === newLevel) {
                        await message.channel.send(`🏆 ${message.author} earned the **${role.name}** role for reaching Level ${newLevel}!`);
                    }
                } catch (e) {
                    bot.logger.warn(`Failed to assign level role ${role.name}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        // Level roles table might not exist yet
    }
}

/**
 * Format XP with K/M suffixes
 */
function formatXP(xp) {
    if (xp >= 1000000) return (xp / 1000000).toFixed(1) + 'M';
    if (xp >= 1000) return (xp / 1000).toFixed(1) + 'K';
    return xp.toLocaleString();
}
