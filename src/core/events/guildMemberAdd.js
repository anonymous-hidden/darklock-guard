/**
 * Guild Member Add Event Handler
 * Handles new member joins with security checks and welcome messages
 */

module.exports = {
    name: 'guildMemberAdd',
    once: false,
    async execute(member, bot) {
        try {
            // Broadcast to console
            try {
                bot.broadcastConsole(member.guild.id, `[JOIN] ${member.user.tag} (${member.id}) joined ${member.guild.name}`);
            } catch (_) {}

            // Lockdown check - handle first
            if (bot.lockdownManager) {
                await bot.lockdownManager.handleNewJoin(member);
            }

            // Get config once for all checks
            const config = await bot.database.getGuildConfig(member.guild.id);

            // Anti-raid check (only if enabled)
            if (bot.antiRaid && config && (config.anti_raid_enabled || config.antiraid_enabled)) {
                const raidResult = await bot.antiRaid.checkNewMember(member);
                if (raidResult && raidResult.isRaid) return;
            }

            // User verification via join queue (raid-safe)
            if (bot.joinQueue) {
                bot.joinQueue.enqueueJoin(member);
            } else if (bot.userVerification && typeof bot.userVerification.verifyNewMember === 'function') {
                await bot.userVerification.verifyNewMember(member);
            }

            // Log join
            if (bot.database) {
                await bot.database.logEvent({
                    type: 'member_join',
                    guildId: member.guild.id,
                    userId: member.id,
                    timestamp: Date.now(),
                    metadata: {
                        accountAge: Date.now() - member.user.createdTimestamp,
                        joinMethod: 'unknown'
                    }
                });
            }
            
            // Security Manager join check
            if (bot.securityManager) {
                await bot.securityManager.handleMemberJoin(member);
            }
            
            // Invite tracking
            if (bot.inviteTracker) {
                try {
                    await bot.inviteTracker.handleMemberJoin(member);
                } catch (err) {
                    bot.logger.debug('Invite tracking error:', err.message);
                }
            }
            
            // Alt account detection
            if (bot.altDetector) {
                try {
                    await bot.altDetector.checkNewMember(member);
                } catch (err) {
                    bot.logger.debug('Alt detection error:', err.message);
                }
            }
            
            // Analytics tracking
            if (bot.analyticsManager) {
                await bot.analyticsManager.trackMemberJoin(member);
            }

            // Forensics audit log
            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: member.guild.id,
                    eventType: 'member_join',
                    eventCategory: 'member',
                    executor: { id: member.id, tag: member.user.tag },
                    target: { id: member.id, name: member.user.tag, type: 'user' },
                    changes: { accountAgeMs: Date.now() - member.user.createdTimestamp },
                    canReplay: false
                });
            }
            
            // Welcome message - only send if verification is NOT enabled
            // If verification is enabled, welcome is sent after user verifies (in markVerified)
            if (bot.database && config) {
                const verificationEnabled = config.verification_enabled;
                if (!verificationEnabled && config.welcome_enabled && config.welcome_channel) {
                    try {
                        const channel = member.guild.channels.cache.get(config.welcome_channel);
                        if (channel && channel.permissionsFor(member.guild.members.me).has('SendMessages')) {
                            const welcomeMessage = bot.formatWelcomeMessage(
                                config.welcome_message || 'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉',
                                member
                            );
                            await channel.send(welcomeMessage);
                            bot.logger.info(`📩 Sent welcome message to ${member.user.tag} in ${member.guild.name}`);
                        }
                    } catch (error) {
                        bot.logger.error('Error sending welcome message:', error);
                    }
                }
            }
        } catch (error) {
            bot.logger.error('Error in member join handler:', error);
        }
    }
};
