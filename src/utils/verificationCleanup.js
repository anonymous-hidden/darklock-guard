const { t } = require('../../locale');

module.exports = {
    nextExpiryTimer: null,
    
    start(bot) {
        if (!bot || !bot.database) return;
        this.scheduleNext(bot);
        bot.logger?.info && bot.logger.info('[VerificationCleanup] Started with dynamic scheduling');
    },
    
    async scheduleNext(bot) {
        try {
            // Find next expiry timestamp
            const next = await bot.database.get(
                `SELECT MIN(expires_at) as nextExpiry FROM verification_queue WHERE status = 'pending' AND expires_at IS NOT NULL`
            );
            
            if (!next?.nextExpiry) {
                // No pending verifications, check again in 5 minutes
                this.nextExpiryTimer = setTimeout(() => this.scheduleNext(bot), 5 * 60 * 1000);
                return;
            }
            
            const nextExpiryTime = new Date(next.nextExpiry).getTime();
            const now = Date.now();
            const delay = Math.max(0, nextExpiryTime - now);
            
            bot.logger?.debug && bot.logger.debug(`[VerificationCleanup] Next expiry in ${Math.round(delay/1000)}s`);
            
            // Schedule cleanup at exact expiry time
            this.nextExpiryTimer = setTimeout(async () => {
                await this.processExpired(bot);
                this.scheduleNext(bot);
            }, delay + 1000); // +1s buffer
            
        } catch (error) {
            bot.logger?.error && bot.logger.error('[VerificationCleanup] Schedule error:', error);
            // Fallback to 5 minute retry
            this.nextExpiryTimer = setTimeout(() => this.scheduleNext(bot), 5 * 60 * 1000);
        }
    },
    
    async processExpired(bot) {
        try {
            const guilds = await bot.database.all(`SELECT DISTINCT guild_id FROM guild_configs WHERE verification_enabled = 1`);
            
            for (const { guild_id: guildId } of guilds) {
                try {
                    const cfg = await bot.database.getGuildConfig(guildId).catch(() => ({}));
                    if (!cfg.verification_enabled) continue;
                    
                    const timeoutMinutes = cfg.verification_timeout_minutes || cfg.verification_timeout || 30;
                    const autoKick = cfg.auto_kick_on_timeout || false;
                    const lang = cfg.verification_language || 'en';

                    const expired = await bot.database.all(
                        `SELECT user_id, status, created_at FROM verification_records 
                         WHERE guild_id = ? 
                         AND (status = 'pending' OR status = 'awaiting_approval')
                         AND datetime(created_at, '+${timeoutMinutes} minutes') <= datetime('now')`,
                        [guildId]
                    );
                    
                    if (!expired || expired.length === 0) continue;

                    const guild = bot.client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    for (const record of expired) {
                        try {
                            const Actions = require('../security/verificationActions');
                            if (!bot.verificationActions) bot.verificationActions = new Actions(bot);
                            
                            await bot.verificationActions.setStatus(guildId, record.user_id, 'expired', { 
                                source: 'auto_timeout', 
                                method: 'auto_expired' 
                            });
                            
                            bot.logger?.info(`[VerificationCleanup] Expired ${record.user_id} in ${guildId} (timeout: ${timeoutMinutes}m)`);

                            // Localized DM to user
                            try {
                                const member = await guild.members.fetch(record.user_id).catch(() => null);
                                const msg = t(lang, 'verification.dm.timeout_expired', { 
                                    minutes: timeoutMinutes, 
                                    server: guild.name 
                                });
                                await member?.send({ content: msg }).catch(() => {});
                            } catch (dmErr) {
                                // Ignore DM errors
                            }

                            // Log timeout to log_channel
                            try {
                                const logChannelId = cfg.mod_log_channel || cfg.log_channel_id;
                                if (logChannelId) {
                                    const logChannel = guild.channels.cache.get(logChannelId);
                                    if (logChannel) {
                                        const { EmbedBuilder } = require('discord.js');
                                        const logEmbed = new EmbedBuilder()
                                            .setTitle('⏱️ Verification Timeout')
                                            .setDescription(`User: <@${record.user_id}>\nTimeout: ${timeoutMinutes} minutes`)
                                            .setColor('#FF4500')
                                            .setTimestamp();
                                        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                                    }
                                }
                            } catch (logErr) {
                                bot.logger?.warn && bot.logger.warn('[VerificationCleanup] Failed to log timeout', logErr?.message || logErr);
                            }

                            // Dashboard event with localized preview
                            const preview = t(lang, 'verification.console.timeout_expired', { 
                                user: record.user_id, 
                                minutes: timeoutMinutes 
                            });
                            
                            bot.verificationActions.notify(guildId, 'TIMEOUT_EXPIRED', { 
                                event: 'TIMEOUT_EXPIRED', 
                                userId: record.user_id, 
                                group: 'verification', 
                                source: 'auto_timeout', 
                                timeoutMinutes, 
                                preview 
                            });

                            // Auto-kick if enabled
                            if (autoKick) {
                                const member = await guild.members.fetch(record.user_id).catch(() => null);
                                if (member) {
                                    await bot.verificationActions.kickUser(guildId, record.user_id, 'system', 'auto_timeout');
                                    bot.logger?.info(`[VerificationCleanup] Auto-kicked ${member.user.tag} (${record.user_id}) from ${guildId}`);
                                }
                            }

                            // Remove unverified role
                            if (cfg.unverified_role_id) {
                                const member = await guild.members.fetch(record.user_id).catch(() => null);
                                if (member) {
                                    await bot.verificationActions.applyRoles(guild, record.user_id, { 
                                        remove: [cfg.unverified_role_id] 
                                    });
                                }
                            }
                        } catch (recordErr) {
                            bot.logger?.error(`[VerificationCleanup] Error processing expired record:`, recordErr);
                        }
                    }
                } catch (guildErr) {
                    bot.logger?.error('[VerificationCleanup] Guild processing error:', guildErr);
                }
            }
        } catch (error) {
            bot.logger?.error('[VerificationCleanup] processExpired error:', error);
        }
    },

    stop(bot) {
        if (this.nextExpiryTimer) {
            clearTimeout(this.nextExpiryTimer);
            this.nextExpiryTimer = null;
            bot.logger?.info('[VerificationCleanup] Stopped');
        }
    }
};
