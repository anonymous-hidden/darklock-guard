/**
 * Guild Member Remove Event Handler
 * Handles member leaves with logging and analytics
 */

module.exports = {
    name: 'guildMemberRemove',
    once: false,
    async execute(member, bot) {
        try {
            // Broadcast to console
            try {
                bot.broadcastConsole(member.guild.id, `[LEAVE] ${member.user.tag} (${member.id}) left ${member.guild.name}`);
            } catch (_) {}

            if (bot.database) {
                await bot.database.logEvent({
                    type: 'member_leave',
                    guildId: member.guild.id,
                    userId: member.id,
                    timestamp: Date.now()
                });
            }
            
            // Analytics tracking
            if (bot.analyticsManager) {
                await bot.analyticsManager.trackMemberLeave(member);
            }

            // Invite tracking - handle leave
            if (bot.inviteTracker) {
                try {
                    await bot.inviteTracker.handleMemberLeave(member);
                } catch (err) {
                    bot.logger.debug('Invite tracking leave error:', err.message);
                }
            }

            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: member.guild.id,
                    eventType: 'member_leave',
                    eventCategory: 'member',
                    executor: { id: member.id, tag: member.user.tag },
                    target: { id: member.id, name: member.user.tag, type: 'user' },
                    canReplay: false
                });
            }

            // Goodbye message
            if (bot.database) {
                try {
                    const config = await bot.database.getGuildConfig(member.guild.id);
                    if (config?.goodbye_enabled && config?.goodbye_channel) {
                        const channel = member.guild.channels.cache.get(config.goodbye_channel);
                        if (channel && channel.permissionsFor(member.guild.members.me)?.has('SendMessages')) {
                            const goodbyeMessage = bot.formatWelcomeMessage(
                                config.goodbye_message || 'Goodbye **{username}**! We will miss you. 👋',
                                member
                            );
                            await channel.send(goodbyeMessage);
                            bot.logger.info(`👋 Sent goodbye message for ${member.user.tag} in ${member.guild.name}`);
                        }
                    }
                } catch (error) {
                    bot.logger.error('Error sending goodbye message:', error);
                }
            }
        } catch (error) {
            bot.logger.error('Error in member leave handler:', error);
        }
    }
};
