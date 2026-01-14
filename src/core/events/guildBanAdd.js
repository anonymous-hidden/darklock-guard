/**
 * Guild Ban Add Event Handler
 * Handles user bans - triggers appeal system notification
 */

module.exports = {
    name: 'guildBanAdd',
    once: false,
    async execute(ban, bot) {
        try {
            // Log the ban
            bot.logger.info(`[BAN] ${ban.user.tag} (${ban.user.id}) was banned from ${ban.guild.name}`);

            // Alt detector - store fingerprint
            if (bot.altDetector) {
                try {
                    await bot.altDetector.storeBannedFingerprint(ban.guild.id, ban.user, ban.reason);
                } catch (err) {
                    bot.logger.debug('Alt fingerprint storage error:', err.message);
                }
            }

            // Appeal system - send DM to banned user
            if (bot.appealSystem) {
                try {
                    await bot.appealSystem.handleBan(ban);
                } catch (err) {
                    bot.logger.debug('Appeal DM error:', err.message);
                }
            }

            // Log to database
            if (bot.database) {
                await bot.database.logEvent({
                    type: 'member_ban',
                    guildId: ban.guild.id,
                    userId: ban.user.id,
                    timestamp: Date.now(),
                    metadata: {
                        reason: ban.reason
                    }
                }).catch(() => {});
            }

            // Forensics audit
            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: ban.guild.id,
                    eventType: 'member_ban',
                    eventCategory: 'moderation',
                    executor: { id: 'unknown', tag: 'unknown' },
                    target: { id: ban.user.id, name: ban.user.tag, type: 'user' },
                    changes: { reason: ban.reason },
                    canReplay: false
                }).catch(() => {});
            }

        } catch (error) {
            bot.logger.error('Error in guildBanAdd handler:', error);
        }
    }
};
