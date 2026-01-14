/**
 * Guild Member Update Event Handler
 * Handles member updates including role conflicts and timeout notifications
 */

const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'guildMemberUpdate',
    once: false,
    async execute(oldMember, newMember, bot) {
        // Handle role conflict resolution
        await handleRoleConflicts(oldMember, newMember, bot);
        
        // Handle timeout notifications
        await handleTimeoutNotifications(oldMember, newMember, bot);
    }
};

/**
 * Auto-resolve verified/unverified role conflicts
 */
async function handleRoleConflicts(oldMember, newMember, bot) {
    try {
        const cfg = await bot.database.getGuildConfig(newMember.guild.id).catch(() => null);
        if (cfg?.verified_role_id && cfg?.unverified_role_id) {
            if (newMember.roles.cache.has(cfg.verified_role_id) && newMember.roles.cache.has(cfg.unverified_role_id)) {
                await newMember.roles.remove(cfg.unverified_role_id).catch(() => {});
                bot.logger?.info && bot.logger.info(`[RoleConflict] Removed Unverified from ${newMember.user.tag} (has Verified)`);
            }
        }
    } catch (err) {
        bot.logger?.warn && bot.logger.warn('[RoleConflict] Failed to resolve:', err);
    }
}

/**
 * Handle timeout notifications when a member is timed out or un-timed out
 */
async function handleTimeoutNotifications(oldMember, newMember, bot) {
    try {
        // Check if timeout status changed
        const wasTimedOut = oldMember.communicationDisabledUntil;
        const isTimedOut = newMember.communicationDisabledUntil;
        
        // User was just timed out
        if (!wasTimedOut && isTimedOut) {
            bot.logger.info(`🔇 Timeout detected: ${newMember.user.tag} in ${newMember.guild.name}`);
            
            const timeoutUntil = new Date(isTimedOut);
            const duration = Math.round((timeoutUntil - Date.now()) / 1000 / 60); // minutes
            
            // Broadcast to dashboard console
            if (typeof bot.broadcastConsole === 'function') {
                bot.broadcastConsole(newMember.guild.id, `[TIMEOUT] ${newMember.user.tag} (${newMember.user.id}) for ${duration} minutes`);
            }
            
            // Get guild config
            const config = await bot.database.getGuildConfig(newMember.guild.id);
            
            // Find log channel
            let logChannel = null;
            if (config && config.log_channel_id) {
                logChannel = newMember.guild.channels.cache.get(config.log_channel_id);
            }
            
            if (!logChannel) {
                logChannel = newMember.guild.channels.cache.find(c => 
                    c.name.toLowerCase().includes('log') || 
                    c.name.toLowerCase().includes('mod') ||
                    c.name.toLowerCase().includes('security')
                );
            }
            
            if (logChannel && logChannel.isTextBased()) {
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle('🔇 Member Timed Out')
                    .setDescription(`**${newMember.user.tag}** has been timed out`)
                    .addFields(
                        { name: '👤 User', value: `${newMember.user.tag}\n<@${newMember.user.id}>\n\`${newMember.user.id}\``, inline: true },
                        { name: '⏰ Duration', value: `${duration} minutes`, inline: true },
                        { name: '🕐 Until', value: `<t:${Math.floor(timeoutUntil.getTime() / 1000)}:F>`, inline: true }
                    )
                    .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
                    .setColor('#ffa502')
                    .setTimestamp();
                
                try {
                    await logChannel.send({ embeds: [timeoutEmbed] });
                    bot.logger.info(`✅ Timeout notification sent to #${logChannel.name}`);
                } catch (error) {
                    bot.logger.error('Failed to send timeout notification:', error);
                }
            }
            
            // Send to dashboard via WebSocket
            if (bot.dashboard && bot.dashboard.wss) {
                bot.dashboard.broadcastToGuild(newMember.guild.id, {
                    type: 'timeout_alert',
                    data: {
                        type: 'TIMEOUT',
                        userId: newMember.user.id,
                        userTag: newMember.user.tag,
                        userAvatar: newMember.user.displayAvatarURL({ dynamic: true }),
                        guildId: newMember.guild.id,
                        guildName: newMember.guild.name,
                        duration: duration,
                        until: timeoutUntil.toISOString(),
                        timestamp: new Date().toISOString(),
                        severity: 'MEDIUM'
                    }
                });
                bot.logger.info('✅ Timeout notification sent to dashboard');
            }
            
            // Log to new Logger system
            try {
                await bot.logger.logSecurityEvent({
                    eventType: 'TIMEOUT',
                    guildId: newMember.guild.id,
                    channelId: null,
                    moderatorId: null,
                    moderatorTag: null,
                    targetId: newMember.user.id,
                    targetTag: newMember.user.tag,
                    reason: `Timed out for ${duration} minutes`,
                    details: {
                        duration: duration,
                        until: timeoutUntil.toISOString()
                    }
                });
                bot.logger.info('✅ Timeout logged to database');
            } catch (error) {
                bot.logger.error('Failed to log timeout to database:', error);
            }
        }
        
        // User timeout was removed (manually by mod or expired)
        if (wasTimedOut && !isTimedOut) {
            bot.logger.info(`✅ Timeout removed: ${newMember.user.tag} in ${newMember.guild.name}`);
            
            // Reset spam tracking for this user to prevent instant re-timeout
            if (bot.antiSpam && typeof bot.antiSpam.clearUserTracking === 'function') {
                bot.antiSpam.clearUserTracking(newMember.guild.id, newMember.user.id);
                bot.logger.debug(`Cleared spam tracking for ${newMember.user.tag} after timeout removal`);
            }
            
            // Also give them a grace period
            if (bot.antiSpam && bot.antiSpam.recentlyPunished) {
                // Remove from recently punished so they don't have to wait extra
                bot.antiSpam.recentlyPunished.delete(`${newMember.guild.id}_${newMember.user.id}`);
            }
        }
        
    } catch (error) {
        bot.logger.error('Error handling member update:', error);
    }
}
