const moment = require('moment');

class AntiRaid {
    constructor(bot) {
        this.bot = bot;
        this.joinTimes = new Map(); // guildId -> array of join timestamps
        this.lockdowns = new Map(); // guildId -> lockdown info
        this.userCounts = new Map(); // guildId -> recent user count data
        this.raidPatterns = new Map(); // guildId -> detected patterns
    }

    async initializeGuild(guildId) {
        this.joinTimes.set(guildId, []);
        this.userCounts.set(guildId, []);
        this.bot.logger.debug(`🛡️  Anti-raid system initialized for guild ${guildId}`);
    }

    async checkNewMember(member) {
        // Alias for checkForRaid for backward compatibility
        return await this.checkForRaid(member);
    }

    async checkForRaid(member) {
        const guildId = member.guild.id;
        const now = Date.now();
        
        try {
            const config = await this.bot.database.getGuildConfig(guildId);
            
            // Feature toggle enforcement - skip if anti-raid is disabled
            if (!config.anti_raid_enabled && !config.antiraid_enabled) {
                return { isRaid: false, disabled: true };
            }
            
            const threshold = config.raid_threshold || 10;
            const timeWindow = 60000; // 1 minute in milliseconds
            
            // Get or initialize join times for this guild
            let joinTimes = this.joinTimes.get(guildId) || [];
            
            // Add current join time
            joinTimes.push({
                userId: member.user.id,
                timestamp: now,
                accountAge: now - member.user.createdTimestamp,
                username: member.user.username,
                discriminator: member.user.discriminator
            });
            
            // Remove old entries (outside time window)
            joinTimes = joinTimes.filter(join => now - join.timestamp <= timeWindow);
            this.joinTimes.set(guildId, joinTimes);
            
            // Check if raid threshold is exceeded
            if (joinTimes.length >= threshold) {
                await this.handleRaidDetection(member.guild, joinTimes);
                return { isRaid: true, disabled: false };
            }
            
            // Check for suspicious patterns
            await this.checkSuspiciousPatterns(member.guild, joinTimes);
            
            return { isRaid: false, disabled: false };
            
        } catch (error) {
            this.bot.logger.error(`Anti-raid check failed for guild ${guildId}:`, error);
            return false;
        }
    }

    async handleRaidDetection(guild, joinTimes) {
        const guildId = guild.id;
        
        try {
            this.bot.logger.security(`🚨 RAID DETECTED in ${guild.name} (${guildId}): ${joinTimes.length} users joined rapidly`);
            
            // Analyze raid pattern
            const raidData = await this.analyzeRaidPattern(joinTimes);
            
            // Log the raid incident
            await this.bot.database.run(`
                INSERT INTO raid_detection 
                (guild_id, user_count, time_window, pattern_type, user_ids)
                VALUES (?, ?, ?, ?, ?)
            `, [
                guildId,
                joinTimes.length,
                60,
                raidData.patternType,
                JSON.stringify(joinTimes.map(j => j.userId))
            ]);

            // Log security incident
            await this.bot.database.logSecurityIncident(guildId, 'RAID_DETECTED', 'HIGH', {
                userCount: joinTimes.length,
                pattern: raidData,
                users: joinTimes
            });
            
            // Get guild config for response actions
            const config = await this.bot.database.getGuildConfig(guildId);
            
            // Activate lockdown if enabled (check both field names)
            if (config.anti_raid_enabled || config.antiraid_enabled) {
                await this.activateLockdown(guild, raidData, config);
            }
            
            // Handle raid users
            await this.handleRaidUsers(guild, joinTimes, raidData);
            
            // Notify moderators
            await this.notifyModerators(guild, raidData, joinTimes);
            
            // Emit security event to dashboard
            if (this.bot.eventEmitter) {
                await this.bot.eventEmitter.emitSecurityEvent(guildId, 'raid_detected', {
                    executorId: null,
                    targetId: null,
                    targetType: 'raid',
                    count: joinTimes.length,
                    threshold: 10,
                    mitigated: true,
                    additionalInfo: {
                        patternType: raidData.patternType,
                        severity: raidData.severity,
                        confidence: raidData.confidence,
                        userIds: joinTimes.map(j => j.userId)
                    }
                });
            }
            
        } catch (error) {
            this.bot.logger.error(`Failed to handle raid detection for guild ${guildId}:`, error);
        }
    }

    async analyzeRaidPattern(joinTimes) {
        const now = Date.now();
        
        // Check for bot-like usernames
        const botLikeCount = joinTimes.filter(join => 
            /^[a-z]+[0-9]+$/i.test(join.username) || 
            join.username.length < 4 ||
            /discord|admin|mod|bot|official/i.test(join.username)
        ).length;
        
        // Check for very new accounts
        const newAccountCount = joinTimes.filter(join => 
            join.accountAge < 24 * 60 * 60 * 1000 // Less than 24 hours
        ).length;
        
        // Check for similar usernames
        const usernames = joinTimes.map(j => j.username.toLowerCase());
        const uniqueUsernames = [...new Set(usernames)];
        const similarityRatio = uniqueUsernames.length / usernames.length;
        
        // Determine pattern type
        let patternType = 'STANDARD_RAID';
        let severity = 'HIGH';
        let confidence = 0.7;
        
        if (botLikeCount / joinTimes.length > 0.7) {
            patternType = 'BOT_RAID';
            confidence = 0.9;
            severity = 'CRITICAL';
        } else if (newAccountCount / joinTimes.length > 0.8) {
            patternType = 'NEW_ACCOUNT_RAID';
            confidence = 0.85;
            severity = 'HIGH';
        } else if (similarityRatio < 0.3) {
            patternType = 'COORDINATED_RAID';
            confidence = 0.8;
            severity = 'HIGH';
        }
        
        return {
            patternType,
            severity,
            confidence,
            botLikeCount,
            newAccountCount,
            similarityRatio,
            totalUsers: joinTimes.length,
            timespan: Math.max(...joinTimes.map(j => j.timestamp)) - Math.min(...joinTimes.map(j => j.timestamp))
        };
    }

    async activateLockdown(guild, raidData, config = null, autoLift = true) {
        const guildId = guild.id;
        const configuredDuration = Number(config?.raid_lockdown_duration_ms);
        const lockdownDuration = Number.isFinite(configuredDuration) && configuredDuration > 0
            ? configuredDuration
            : 5 * 60 * 1000; // 5 minutes default
        
        try {
            const existing = this.lockdowns.get(guildId);
            if (existing?.liftTimeout) {
                clearTimeout(existing.liftTimeout);
            }

            // Store lockdown info
            this.lockdowns.set(guildId, {
                startTime: Date.now(),
                duration: lockdownDuration,
                reason: `Raid detected: ${raidData.patternType}`,
                severity: raidData.severity,
                liftTimeout: null
            });
            
            // Find system/general channel for notifications
            const systemChannel = guild.systemChannel || 
                                guild.channels.cache.find(c => c.type === 0 && c.name.includes('general')) ||
                                guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me).has('SEND_MESSAGES'));
            
            if (systemChannel) {
                const lockdownEmbed = {
                    title: '🚨 EMERGENCY LOCKDOWN ACTIVATED',
                    description: `Server is under lockdown due to detected raid activity.\n\n**Pattern:** ${raidData.patternType}\n**Severity:** ${raidData.severity}\n**Duration:** ${lockdownDuration / 60000} minutes`,
                    color: 0xff0000,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Lockdown will automatically lift when safe' }
                };
                
                await systemChannel.send({ embeds: [lockdownEmbed] });
            }
            
            // Apply temporary restrictions
            await this.applyTemporaryRestrictions(guild);
            
            // Schedule lockdown removal
            if (autoLift !== false) {
                const timeout = setTimeout(() => {
                    this.removeLockdown(guild);
                }, lockdownDuration);
                const info = this.lockdowns.get(guildId);
                if (info) info.liftTimeout = timeout;
            }
            
            this.bot.logger.security(`🔒 Lockdown activated for ${guild.name} (${guildId})`);
            
        } catch (error) {
            this.bot.logger.error(`Failed to activate lockdown for guild ${guildId}:`, error);
        }
    }

    async applyTemporaryRestrictions(guild) {
        try {
            // Get mod and admin roles from config
            const config = await this.bot.database.getGuildConfig(guild.id);
            const modRoleId = config.mod_role_id;
            const adminRoleId = config.admin_role_id;
            
            // Lock down @everyone in all channels except for admins and moderators
            const lockedChannels = [];
            
            for (const channel of guild.channels.cache.values()) {
                if (channel.type === 0 || channel.type === 2 || channel.type === 13) { // Text, voice, or stage channels
                    try {
                        // Deny @everyone from sending messages/speaking
                        await channel.permissionOverwrites.edit(guild.roles.everyone, {
                            SendMessages: false,
                            AddReactions: false,
                            Speak: false,
                            Connect: false,
                            CreatePublicThreads: false,
                            CreatePrivateThreads: false
                        }, { reason: 'Lockdown: Raid detection' });
                        
                        // Ensure moderators and admins can still access
                        if (modRoleId) {
                            const modRole = guild.roles.cache.get(modRoleId);
                            if (modRole) {
                                await channel.permissionOverwrites.edit(modRole, {
                                    SendMessages: true,
                                    AddReactions: true,
                                    Speak: true,
                                    Connect: true
                                }, { reason: 'Lockdown: Moderator override' });
                            }
                        }
                        
                        if (adminRoleId) {
                            const adminRole = guild.roles.cache.get(adminRoleId);
                            if (adminRole) {
                                await channel.permissionOverwrites.edit(adminRole, {
                                    SendMessages: true,
                                    AddReactions: true,
                                    Speak: true,
                                    Connect: true
                                }, { reason: 'Lockdown: Admin override' });
                            }
                        }
                        
                        lockedChannels.push(channel.id);
                    } catch (err) {
                        this.bot.logger.warn(`Failed to lock channel ${channel.name}:`, err.message);
                    }
                }
            }
            
            this.bot.logger.info(`🔒 Locked ${lockedChannels.length} channels for lockdown`);
            return lockedChannels;
            
        } catch (error) {
            this.bot.logger.error(`Failed to apply temporary restrictions:`, error);
            return [];
        }
    }

    async handleRaidUsers(guild, joinTimes, raidData) {
        const config = await this.bot.database.getGuildConfig(guild.id);
        const quarantineRole = await this.applyTemporaryRestrictions(guild);
        
        for (const joinData of joinTimes) {
            try {
                const member = await guild.members.fetch(joinData.userId).catch(() => null);
                if (!member) continue;
                
                // Apply quarantine role
                if (quarantineRole) {
                    await member.roles.add(quarantineRole, 'Raid detection quarantine');
                }
                
                // Update user record with raid flag
                await this.bot.database.createOrUpdateUserRecord(guild.id, joinData.userId, {
                    flags: JSON.stringify({ raidParticipant: true, raidType: raidData.patternType }),
                    trust_score: 10, // Very low trust score
                    verification_status: 'quarantined'
                });
                
                // Log moderation action
                await this.bot.database.run(`
                    INSERT INTO mod_actions 
                    (guild_id, action_type, target_user_id, moderator_id, reason, active)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    guild.id,
                    'QUARANTINE',
                    joinData.userId,
                    this.bot.client.user.id,
                    `Raid detection: ${raidData.patternType}`,
                    1
                ]);
                
                this.bot.logger.security(`🔒 Quarantined raid participant: ${member.user.tag} (${joinData.userId})`);
                
            } catch (error) {
                this.bot.logger.error(`Failed to handle raid user ${joinData.userId}:`, error);
            }
        }
    }

    async notifyModerators(guild, raidData, joinTimes) {
        try {
            const config = await this.bot.database.getGuildConfig(guild.id);
            
            // Find mod/admin roles
            const modRole = config.mod_role_id ? guild.roles.cache.get(config.mod_role_id) : null;
            const adminRole = config.admin_role_id ? guild.roles.cache.get(config.admin_role_id) : null;
            
            // Find log channel
            const logChannel = config.log_channel_id ? 
                guild.channels.cache.get(config.log_channel_id) : 
                guild.channels.cache.find(c => c.name.includes('log') || c.name.includes('mod'));
            
            if (logChannel) {
                const raidEmbed = {
                    title: '🚨 RAID ALERT',
                    description: `**${joinTimes.length} users** joined within 60 seconds`,
                    fields: [
                        {
                            name: '📊 Pattern Analysis',
                            value: `**Type:** ${raidData.patternType}\n**Severity:** ${raidData.severity}\n**Confidence:** ${(raidData.confidence * 100).toFixed(1)}%`,
                            inline: true
                        },
                        {
                            name: '🔍 Details',
                            value: `**Bot-like names:** ${raidData.botLikeCount}\n**New accounts:** ${raidData.newAccountCount}\n**Similarity:** ${(raidData.similarityRatio * 100).toFixed(1)}%`,
                            inline: true
                        },
                        {
                            name: '🛡️ Actions Taken',
                            value: `✅ Lockdown activated\n✅ Users quarantined\n✅ Restrictions applied`,
                            inline: false
                        }
                    ],
                    color: raidData.severity === 'CRITICAL' ? 0xff0000 : 0xffa500,
                    timestamp: new Date().toISOString(),
                    footer: { text: `Guild: ${guild.name} | ID: ${guild.id}` }
                };
                
                let mention = '';
                if (modRole) mention += `${modRole} `;
                if (adminRole) mention += `${adminRole} `;
                
                await logChannel.send({ 
                    content: mention || '@here',
                    embeds: [raidEmbed] 
                });
            }
            
        } catch (error) {
            this.bot.logger.error(`Failed to notify moderators about raid:`, error);
        }
    }

    async removeLockdown(guild) {
        const guildId = guild.id;
        
        try {
            // Restore @everyone permissions in all channels
            for (const channel of guild.channels.cache.values()) {
                if (channel.type === 0 || channel.type === 2 || channel.type === 13) {
                    try {
                        // Remove the lockdown permission overwrites for @everyone
                        await channel.permissionOverwrites.delete(guild.roles.everyone, { reason: 'Lockdown ended' });
                    } catch (err) {
                        this.bot.logger.warn(`Failed to unlock channel ${channel.name}:`, err.message);
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(`Failed to remove lockdown restrictions:`, error);
        }
        
        try {
            const lockdownInfo = this.lockdowns.get(guildId);
            if (!lockdownInfo) return;

            if (lockdownInfo.liftTimeout) {
                clearTimeout(lockdownInfo.liftTimeout);
            }
            
            // Remove lockdown from memory
            this.lockdowns.delete(guildId);
            
            // Find and remove quarantine role restrictions
            const quarantineRole = guild.roles.cache.find(r => r.name === 'Raid Quarantine');
            if (quarantineRole) {
                // Remove role from all members
                for (const member of quarantineRole.members.values()) {
                    try {
                        await member.roles.remove(quarantineRole, 'Lockdown ended');
                    } catch (error) {
                        this.bot.logger.error(`Failed to remove quarantine role from ${member.user.tag}:`, error);
                    }
                }
                
                // Delete the role
                await quarantineRole.delete('Lockdown ended');
            }
            
            // Update database
            await this.bot.database.run(
                'UPDATE raid_detection SET lockdown_activated = 0, handled = 1 WHERE guild_id = ? AND handled = 0',
                [guildId]
            );
            
            // Notify about lockdown end
            const systemChannel = guild.systemChannel || 
                                guild.channels.cache.find(c => c.type === 0 && c.name.includes('general'));
            
            if (systemChannel) {
                const endEmbed = {
                    title: '✅ LOCKDOWN LIFTED',
                    description: 'Server lockdown has been automatically lifted. Normal operations restored.',
                    color: 0x00ff00,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Continue monitoring for suspicious activity' }
                };
                
                await systemChannel.send({ embeds: [endEmbed] });
            }
            
            this.bot.logger.security(`🔓 Lockdown lifted for ${guild.name} (${guildId})`);
            
        } catch (error) {
            this.bot.logger.error(`Failed to remove lockdown for guild ${guildId}:`, error);
        }
    }

    async checkSuspiciousPatterns(guild, joinTimes) {
        const guildId = guild.id;
        
        try {
            // Check for coordinated account creation times
            const creationTimes = joinTimes.map(j => j.timestamp - j.accountAge);
            const avgCreationTime = creationTimes.reduce((a, b) => a + b, 0) / creationTimes.length;
            const creationVariance = creationTimes.reduce((acc, time) => acc + Math.pow(time - avgCreationTime, 2), 0) / creationTimes.length;
            
            // If accounts were created very close in time, it's suspicious
            if (creationVariance < 1000 * 60 * 60 * 24 && joinTimes.length >= 3) { // 24 hours variance
                await this.bot.database.logSecurityIncident(guildId, 'SUSPICIOUS_PATTERN', 'MEDIUM', {
                    description: 'Multiple accounts with synchronized creation times detected',
                    pattern: 'COORDINATED_CREATION',
                    users: joinTimes.map(j => j.userId),
                    variance: creationVariance
                });
                
                this.bot.logger.security(`⚠️  Suspicious coordinated account creation pattern detected in ${guild.name}`);
            }
            
        } catch (error) {
            this.bot.logger.error(`Failed to check suspicious patterns:`, error);
        }
    }

    isGuildInLockdown(guildId) {
        return this.lockdowns.has(guildId);
    }

    getLockdownInfo(guildId) {
        return this.lockdowns.get(guildId) || null;
    }

    async manualLockdown(guild, reason = 'Manual activation', duration = 5 * 60 * 1000) {
        await this.activateLockdown(guild, {
            patternType: 'MANUAL',
            severity: 'HIGH',
            confidence: 1.0
        }, { raid_lockdown_duration_ms: duration });
        
        // Override reason
        const lockdownInfo = this.lockdowns.get(guild.id);
        if (lockdownInfo) {
            lockdownInfo.reason = reason;
            lockdownInfo.duration = duration;
        }
    }

    async restoreLockdown(guild) {
        await this.removeLockdown(guild);
    }

    scheduleLockdownLift(guild, config = null, durationOverride = null) {
        const guildId = guild.id;
        const lockdownInfo = this.lockdowns.get(guildId);
        if (!lockdownInfo) return;

        const override = Number(durationOverride);
        const configuredDuration = Number(config?.raid_lockdown_duration_ms);
        const duration = Number.isFinite(override) && override > 0
            ? override
            : (Number.isFinite(configuredDuration) && configuredDuration > 0
                ? configuredDuration
                : (lockdownInfo.duration || 5 * 60 * 1000));

        if (lockdownInfo.liftTimeout) {
            clearTimeout(lockdownInfo.liftTimeout);
        }

        lockdownInfo.duration = duration;
        lockdownInfo.liftTimeout = setTimeout(() => {
            this.removeLockdown(guild);
        }, duration);
    }

    async manualLockdownRemoval(guild) {
        await this.removeLockdown(guild);
    }
}

module.exports = AntiRaid;