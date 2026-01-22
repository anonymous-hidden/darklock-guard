const { PermissionsBitField } = require('discord.js');
const StandardEmbedBuilder = require('../utils/embed-builder');

class AntiSpam {
    constructor(bot) {
        this.bot = bot;
        this.userMessageTimes = new Map(); // userId -> array of message timestamps
        this.userChannelMessages = new Map(); // userId_channelId -> message data
        this.duplicateMessages = new Map(); // guildId_userId -> Map(content -> {count, timestamp})
        this.linkCooldowns = new Map(); // userId -> last link timestamp
        this.mentionCooldowns = new Map(); // userId -> mention data
        this.recentlyPunished = new Map(); // guildId_userId -> timestamp of last punishment
        this.userWarningDecay = new Map(); // guildId_userId -> last warning timestamp (for decay)
        this.notificationCooldowns = new Map(); // guildId_userId -> timestamp of last notification
        this.dmCooldowns = new Map(); // guildId_userId -> timestamp of last DM sent
    }

    async initializeGuild(guildId) {
        this.bot.logger.debug(`🛡️  Anti-spam system initialized for guild ${guildId}`);
    }

    async checkMessage(message) {
        const guildId = message.guildId;
        const userId = message.author.id;
        const channelId = message.channelId;
        const now = Date.now();
        
        try {
            // Skip if user has certain permissions
            if (message.member && this.hasModeratorPermissions(message.member)) {
                this.bot.logger.debug(`Skipping spam check for moderator: ${message.author.tag}`);
                return false;
            }
            
            // Skip if user was recently punished (grace period of 30 seconds)
            const punishmentKey = `${guildId}_${userId}`;
            const lastPunishment = this.recentlyPunished.get(punishmentKey);
            if (lastPunishment && (now - lastPunishment) < 30000) {
                this.bot.logger.debug(`Skipping spam check for ${message.author.tag} - in grace period after punishment`);
                return false;
            }
            
            const config = await this.bot.database.getGuildConfig(guildId);
            const guildNameSafe = message.guild?.name || guildId;
            if (!config) {
                this.bot.logger.debug(`Anti-spam: no config found for guild ${guildNameSafe}, skipping check`);
                return false;
            }
            
            // Check both field names (anti_spam_enabled and antispam_enabled) for compatibility
            // Must explicitly check for truthy values (1, true, etc) not just existence
            const isEnabled = !!(config.anti_spam_enabled || config.antispam_enabled);
            this.bot.logger.debug(`Anti-spam config for ${guildNameSafe}: anti_spam_enabled=${config.anti_spam_enabled}, antispam_enabled=${config.antispam_enabled}, final=${isEnabled}`);

            if (!isEnabled) {
                this.bot.logger.debug(`Anti-spam disabled for guild ${guildNameSafe}`);
                return false;
            }
            
            // Get spam configuration from DATABASE (not hardcoded config file)
            // Read all antispam thresholds from guild_configs
            const maxMessages = config.antispam_flood_messages || config.spam_threshold || 5;
            const timeWindow = (config.antispam_flood_seconds || 10) * 1000; // Convert to milliseconds
            const maxDuplicates = config.antispam_duplicate_mid || 3;
            const maxMentions = config.antispam_mention_threshold || 5;
            const maxEmojis = config.antispam_emoji_mid || 10;
            const maxLinks = config.antispam_link_threshold || 2;
            const capsRatio = (config.antispam_caps_ratio || 70) / 100; // Convert percentage to decimal
            const capsMinLength = config.antispam_caps_min_letters || 15;
            const spamAction = config.spam_action || 'timeout'; // delete | warn | timeout | kick
            
            this.bot.logger.debug(`Anti-spam thresholds for ${guildNameSafe}: flood=${maxMessages}/${timeWindow}ms, dup=${maxDuplicates}, mention=${maxMentions}, emoji=${maxEmojis}, links=${maxLinks}, caps=${capsRatio*100}%/${capsMinLength}chars, action=${spamAction}`);
            
            this.bot.logger.debug(`Checking message from ${message.author.tag}: "${message.content.substring(0, 50)}"`);
            
            let spamDetected = false;
            let spamTypes = [];
            
            // Check message flood
            const floodDetected = await this.checkMessageFlood(message, maxMessages, timeWindow);
            if (floodDetected) {
                spamDetected = true;
                spamTypes.push('MESSAGE_FLOOD');
                this.bot.logger.debug(`Flood detected for ${message.author.tag}`);
            }
            
            // Check duplicate messages
            const duplicateDetected = await this.checkDuplicateSpam(message, maxDuplicates);
            if (duplicateDetected) {
                spamDetected = true;
                spamTypes.push('DUPLICATE_SPAM');
            }
            
            // Check mention spam
            const mentionSpam = await this.checkMentionSpam(message, maxMentions);
            if (mentionSpam) {
                spamDetected = true;
                spamTypes.push('MENTION_SPAM');
            }
            
            // Check emoji spam
            const emojiSpam = await this.checkEmojiSpam(message, maxEmojis);
            if (emojiSpam) {
                spamDetected = true;
                spamTypes.push('EMOJI_SPAM');
            }
            
            // Check link spam
            const linkSpam = await this.checkLinkSpam(message, maxLinks);
            if (linkSpam) {
                spamDetected = true;
                spamTypes.push('LINK_SPAM');
            }
            
            // Check caps spam (with configurable ratio and min length)
            const capsSpam = await this.checkCapsSpam(message, capsRatio, capsMinLength);
            if (capsSpam) {
                spamDetected = true;
                spamTypes.push('CAPS_SPAM');
            }
            
            if (spamDetected) {
                await this.handleSpamDetection(message, spamTypes, spamAction, config);
                return true;
            }
            
            // Update message tracking data
            await this.updateMessageTracking(message);
            
            return false;
            
        } catch (error) {
            this.bot.logger.error(`Anti-spam check failed for user ${userId}:`, error);
            return false;
        }
    }

    async checkMessageFlood(message, maxMessages, timeWindow) {
        const userId = message.author.id;
        const channelId = message.channelId;
        const now = Date.now();
        
        // Get or create user message times
        const key = `${userId}_${channelId}`;
        let messageTimes = this.userChannelMessages.get(key) || [];
        
        // Add current message time
        messageTimes.push(now);
        
        // Remove old messages outside time window
        messageTimes = messageTimes.filter(time => now - time <= timeWindow);
        this.userChannelMessages.set(key, messageTimes);
        
        return messageTimes.length > maxMessages;
    }

    async checkDuplicateSpam(message, maxDuplicates) {
        const guildId = message.guildId;
        const userId = message.author.id;
        const content = message.content.toLowerCase().trim();
        const now = Date.now();
        
        if (content.length < 5) return false; // Ignore very short messages
        
        // Use per-user duplicate tracking (not guild-wide)
        const userKey = `${guildId}_${userId}`;
        let userDuplicates = this.duplicateMessages.get(userKey);
        if (!userDuplicates) {
            userDuplicates = new Map();
            this.duplicateMessages.set(userKey, userDuplicates);
        }
        
        // Get existing entry for this content
        const existing = userDuplicates.get(content);
        
        // If entry exists but is older than 60 seconds, reset it
        if (existing && (now - existing.timestamp) > 60000) {
            userDuplicates.delete(content);
        }
        
        // Count this message
        const currentData = userDuplicates.get(content) || { count: 0, timestamp: now };
        currentData.count += 1;
        currentData.timestamp = now;
        userDuplicates.set(content, currentData);
        
        // Clean old entries (keep only last 30 seconds)
        for (const [key, data] of userDuplicates.entries()) {
            if (now - data.timestamp > 30000) {
                userDuplicates.delete(key);
            }
        }
        
        // Limit map size
        if (userDuplicates.size > 20) {
            const entries = Array.from(userDuplicates.entries());
            entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            userDuplicates.clear();
            entries.slice(0, 10).forEach(([key, value]) => {
                userDuplicates.set(key, value);
            });
        }
        
        return currentData.count > maxDuplicates;
    }

    async checkMentionSpam(message, maxMentions) {
        const mentions = message.mentions;
        const totalMentions = mentions.users.size + mentions.roles.size;
        
        // Check for @everyone or @here abuse
        if (mentions.everyone) {
            return true;
        }
        
        // Check total mention count
        if (totalMentions > maxMentions) {
            return true;
        }
        
        // Check for repeated mentions of the same user/role
        const userMentions = Array.from(mentions.users.keys());
        const roleMentions = Array.from(mentions.roles.keys());
        
        const uniqueUserMentions = [...new Set(userMentions)];
        const uniqueRoleMentions = [...new Set(roleMentions)];
        
        // If there are duplicate mentions in the same message
        if (userMentions.length !== uniqueUserMentions.length || 
            roleMentions.length !== uniqueRoleMentions.length) {
            return true;
        }
        
        return false;
    }

    async checkEmojiSpam(message, maxEmojis) {
        const content = message.content;
        
        // Count Unicode emojis
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        const unicodeEmojis = (content.match(unicodeEmojiRegex) || []).length;
        
        // Count custom emojis
        const customEmojiRegex = /<a?:\w+:\d+>/g;
        const customEmojis = (content.match(customEmojiRegex) || []).length;
        
        const totalEmojis = unicodeEmojis + customEmojis;
        
        return totalEmojis > maxEmojis;
    }

    async checkLinkSpam(message, maxLinks) {
        const content = message.content;
        const userId = message.author.id;
        const now = Date.now();
        
        // URL regex
        const urlRegex = /https?:\/\/[^\s]+/gi;
        const urls = content.match(urlRegex) || [];
        
        if (urls.length === 0) return false;
        
        // Check if too many links in single message
        if (urls.length > maxLinks) {
            return true;
        }
        
        // Check link frequency (time-based)
        const lastLinkTime = this.linkCooldowns.get(userId) || 0;
        const timeSinceLastLink = now - lastLinkTime;
        
        if (urls.length > 0) {
            this.linkCooldowns.set(userId, now);
            
            // If user posted links very recently (less than 5 seconds)
            if (timeSinceLastLink < 5000) {
                return true;
            }
        }
        
        return false;
    }

    async checkCapsSpam(message, capsThreshold = 0.7, minLength = 15) {
        const content = message.content;
        
        if (content.length < minLength) return false; // Ignore short messages based on config
        
        // Count uppercase letters
        const uppercaseCount = (content.match(/[A-Z]/g) || []).length;
        const totalLetters = (content.match(/[A-Za-z]/g) || []).length;
        
        if (totalLetters === 0) return false;
        
        const capsRatio = uppercaseCount / totalLetters;
        
        // Use configurable caps ratio threshold
        return capsRatio > capsThreshold && content.length >= minLength;
    }

    async handleSpamDetection(message, spamTypes, configuredAction = 'timeout', guildConfig = null) {
        const guildId = message.guildId;
        const userId = message.author.id;
        const channelId = message.channelId;
        
        this.bot.logger.info(`🚨 SPAM DETECTED! User: ${message.author.tag}, Types: ${spamTypes.join(', ')}, Guild: ${message.guild.name}, Action: ${configuredAction}`);
        
        // Broadcast analytics_update for real-time charts
        if (this.bot.analyticsManager) {
            this.bot.analyticsManager.trackSpamEvent(guildId);
        }
        
        // Broadcast to console
        try {
            if (this.bot && typeof this.bot.broadcastConsole === 'function') {
                this.bot.broadcastConsole(guildId, `[ANTI-SPAM] ${message.author.tag} - ${spamTypes.join(', ')} in #${message.channel.name}`);
            }
        } catch (_) {}
        
        // Capture all message data BEFORE deleting anything
        const messageData = {
            content: message.content,
            authorTag: message.author.tag,
            authorId: message.author.id,
            author: message.author,
            channel: message.channel,
            guild: message.guild,
            member: message.member,
            createdAt: message.author.createdAt,
            joinedAt: message.member?.joinedAt
        };
        
        this.bot.logger.debug(`Message data cached for ${messageData.authorTag}`);
        
        try {
            // Log spam detection
            await this.bot.database.run(`
                INSERT INTO spam_detection 
                (guild_id, user_id, channel_id, spam_type, message_count, time_window, content_sample)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                userId,
                channelId,
                spamTypes.join(','),
                1,
                10,
                messageData.content.substring(0, 100)
            ]);

            // Log security incident
            await this.bot.database.logSecurityIncident(guildId, 'SPAM_DETECTED', 'MEDIUM', {
                userId: userId,
                channelId: channelId,
                spamTypes: spamTypes,
                content: messageData.content.substring(0, 200)
            });

            // Delete the message EARLY to stop spam immediately
            try {
                await message.delete();
            } catch (error) {
                this.bot.logger.error(`Failed to delete spam message:`, error);
            }

            // Get user record and calculate warning count with decay
            const userRecord = await this.bot.database.getUserRecord(guildId, userId);
            const decayKey = `${guildId}_${userId}`;
            const lastWarningTime = this.userWarningDecay.get(decayKey) || 0;
            const now = Date.now();
            
            // Get current warning count from DB
            let dbWarningCount = userRecord?.warning_count || 0;
            
            // Apply decay: if last warning was more than 10 minutes ago, reduce count
            // This prevents old warnings from escalating punishment forever
            const timeSinceLastWarning = now - lastWarningTime;
            if (lastWarningTime > 0 && timeSinceLastWarning > 10 * 60 * 1000) {
                // Decay 1 warning per 10 minutes of good behavior (max decay 3)
                const decayAmount = Math.min(3, Math.floor(timeSinceLastWarning / (10 * 60 * 1000)));
                dbWarningCount = Math.max(0, dbWarningCount - decayAmount);
                this.bot.logger.debug(`Warning decay applied for ${message.author.tag}: -${decayAmount} warnings`);
            }
            
            // Now increment for current violation
            let warningCount = dbWarningCount + 1;
            let trustScore = Math.max(0, (userRecord?.trust_score || 50) - 10);
            
            // Update last warning time
            this.userWarningDecay.set(decayKey, now);

            await this.bot.database.createOrUpdateUserRecord(guildId, userId, {
                warning_count: warningCount,
                trust_score: trustScore,
                flags: JSON.stringify({ spamDetected: true, spamTypes: spamTypes })
            });

            // Determine punishment based on configured action and warning count
            let action = null;
            let actionDuration = null;

            // Use passed guildConfig or fetch if needed
            const config = guildConfig || await this.bot.database?.getGuildConfig(guildId);
            const autoActionEnabled = config?.auto_action_enabled;
            const punishmentThreshold = config?.spam_punishment_threshold || 10; // Default threshold for auto-escalation
            
            // Apply the configured spam_action from dashboard
            // configuredAction values: 'delete' | 'warn' | 'timeout' | 'mute' | 'kick' | 'ban'
            if (configuredAction === 'delete') {
                // Message already deleted above, just log/warn
                action = 'WARN';
            } else if (configuredAction === 'warn') {
                action = 'WARN';
            } else if (configuredAction === 'timeout' || configuredAction === 'mute') {
                // Use timeout with escalating duration based on warnings
                action = 'TIMEOUT';
                const muteDuration = config?.spam_mute_duration || 300; // Default 5 minutes
                actionDuration = Math.min(muteDuration * 1000 * warningCount, 24 * 60 * 60 * 1000);
            } else if (configuredAction === 'kick') {
                if (message.member && message.member.kickable) {
                    action = 'KICK';
                } else {
                    action = 'TIMEOUT';
                    actionDuration = 24 * 60 * 60 * 1000; // 24h timeout as fallback
                }
            } else if (configuredAction === 'ban') {
                if (message.member && message.member.bannable) {
                    action = 'BAN';
                } else {
                    action = 'KICK'; // Fallback to kick
                    if (!message.member?.kickable) {
                        action = 'TIMEOUT';
                        actionDuration = 24 * 60 * 60 * 1000; // 24h timeout as last fallback
                    }
                }
            }

            // ALWAYS escalate to kick at threshold warnings (unless action is already BAN)
            // This ensures chronic spammers are removed regardless of configured action
            if (warningCount >= punishmentThreshold && action !== 'BAN') {
                if (message.member && message.member.kickable) {
                    action = 'KICK';
                    this.bot.logger.info(`[ANTI-SPAM] Auto-escalating to KICK: ${message.author.tag} exceeded ${punishmentThreshold} warnings (${warningCount})`);
                } else if (message.member && message.member.bannable) {
                    action = 'BAN';
                    this.bot.logger.info(`[ANTI-SPAM] Auto-escalating to BAN: ${message.author.tag} exceeded threshold but not kickable (${warningCount})`);
                }
            }
            
            // Additional escalation: Auto-kick at 5+ warnings if auto_action_enabled (original behavior)
            if (autoActionEnabled && warningCount >= 5 && message.member && message.member.kickable && action !== 'KICK' && action !== 'BAN') {
                action = 'KICK';
            }

            if (action && message.member && action !== 'WARN') {
                try {
                    if (action === 'BAN') {
                        await message.member.ban({ reason: `Auto-ban: spam detection - ${spamTypes.join(', ')}`, deleteMessageSeconds: 60 });
                        await this.bot.database.logAction({
                            guildId: guildId,
                            actionType: 'ban',
                            actionCategory: 'moderation',
                            targetUserId: userId,
                            targetUsername: message.author.tag,
                            moderatorId: this.bot.client.user.id,
                            moderatorUsername: this.bot.client.user.tag,
                            reason: `Auto-ban: spam detection - ${spamTypes.join(', ')}`,
                            canUndo: true,
                            details: { spamTypes, warningCount, auto: true, configuredAction }
                        });
                        this.clearUserTracking(guildId, userId);
                    } else if (action === 'KICK') {
                        await message.member.kick(`Auto-kick: spam threshold reached (${warningCount}/5)`);
                        // Log action in unified action_logs
                        await this.bot.database.logAction({
                            guildId: guildId,
                            actionType: 'kick',
                            actionCategory: 'moderation',
                            targetUserId: userId,
                            targetUsername: message.author.tag,
                            moderatorId: this.bot.client.user.id,
                            moderatorUsername: this.bot.client.user.tag,
                            reason: `Auto-kick: spam detection threshold (${warningCount}/5) - ${spamTypes.join(', ')}`,
                            canUndo: false,
                            details: { spamTypes, warningCount, auto: true, configuredAction }
                        });
                        // Clear all tracking for this user after kick
                        this.clearUserTracking(guildId, userId);
                    } else if (action === 'TIMEOUT' && actionDuration) {
                        await message.member.timeout(actionDuration, `Spam detection: ${spamTypes.join(', ')}`);
                        await this.bot.database.logAction({
                            guildId: guildId,
                            actionType: 'timeout',
                            actionCategory: 'moderation',
                            targetUserId: userId,
                            targetUsername: message.author.tag,
                            moderatorId: this.bot.client.user.id,
                            moderatorUsername: this.bot.client.user.tag,
                            reason: `Auto-timeout: spam detection (${spamTypes.join(', ')})`,
                            duration: `${Math.round(actionDuration/60000)}m`,
                            canUndo: true,
                            expiresAt: new Date(Date.now() + actionDuration).toISOString(),
                            details: { spamTypes, warningCount, auto: true, configuredAction }
                        });
                        // Clear tracking and set grace period after timeout
                        this.clearUserTracking(guildId, userId);
                        this.recentlyPunished.set(`${guildId}_${userId}`, Date.now());
                    }
                } catch (error) {
                    this.bot.logger.error(`Failed to apply punishment for spam:`, error);
                }
            }

            // Send warning message using cached data
            // Skip warning DM if kicked or banned
            if (action !== 'KICK' && action !== 'BAN') {
                await this.sendSpamWarning(messageData, spamTypes, warningCount, actionDuration);
            }

            // Notify moderators for ALL timeouts (not just severe ones) using cached data
            await this.notifyModeratorsWithActions(messageData, spamTypes, warningCount, action, actionDuration);

            this.bot.logger.security(`🚫 Spam detected from ${messageData.authorTag} in ${messageData.guild.name}: ${spamTypes.join(', ')}`);

        } catch (error) {
            this.bot.logger.error(`Failed to handle spam detection:`, error);
        }
    }

    async sendSpamWarning(messageData, spamTypes, warningCount, actionDuration) {
        try {
            // Check DM cooldown - only send one DM per 60 seconds per user
            const dmCooldownKey = `${messageData.guild.id}_${messageData.authorId}`;
            const lastDm = this.dmCooldowns.get(dmCooldownKey);
            const now = Date.now();
            
            if (lastDm && (now - lastDm) < 60000) {
                this.bot.logger.debug(`Skipping spam DM for ${messageData.authorTag} - DM cooldown active (${Math.round((60000 - (now - lastDm))/1000)}s remaining)`);
                return;
            }
            
            // Set DM cooldown
            this.dmCooldowns.set(dmCooldownKey, now);
            
            const warningEmbed = {
                title: '⚠️ Spam Detection Warning',
                description: `Your message was automatically removed for spam detection.`,
                fields: [
                    {
                        name: 'Violation Type',
                        value: spamTypes.map(type => type.replace('_', ' ').toLowerCase()).join(', '),
                        inline: true
                    },
                    {
                        name: 'Warning Count',
                        value: `${warningCount}/5`,
                        inline: true
                    }
                ],
                color: warningCount >= 3 ? 0xff0000 : 0xffa500,
                footer: { text: 'Please follow the server rules to avoid further warnings.' }
            };

            if (actionDuration) {
                warningEmbed.fields.push({
                    name: 'Action Taken',
                    value: `Temporary timeout: ${Math.round(actionDuration / 60000)} minutes`,
                    inline: false
                });
            }

            // Try to send DM first, fallback to channel
            try {
                await messageData.author.send({ embeds: [warningEmbed] });
            } catch {
                // If DM fails, send to channel and delete after a few seconds
                const warningMsg = await messageData.channel.send({
                    content: `${messageData.author}`,
                    embeds: [warningEmbed]
                });
                setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
            }

        } catch (error) {
            this.bot.logger.error(`Failed to send spam warning:`, error);
        }
    }

    async notifyModerators(message, spamTypes, warningCount) {
        try {
            // This method is deprecated - notifyModeratorsWithActions is preferred
            // But keep for backwards compatibility
            const config = await this.bot.database.getGuildConfig(message.guildId);
            
            // Check notification cooldown
            const cooldownKey = `${message.guildId}_${message.author.id}`;
            const lastNotification = this.notificationCooldowns.get(cooldownKey);
            const now = Date.now();
            
            if (lastNotification && (now - lastNotification) < 10000) {
                this.bot.logger.debug(`Skipping duplicate notification for ${message.author.tag} - cooldown active`);
                return;
            }
            this.notificationCooldowns.set(cooldownKey, now);
            
            // Find log channel
            const logChannel = config.log_channel_id ? 
                message.guild.channels.cache.get(config.log_channel_id) : 
                message.guild.channels.cache.find(c => 
                    c.name.includes('log') || c.name.includes('mod')
                );

            if (logChannel) {
                const messageContent = message.content ? message.content.substring(0, 200) : 'No content';
                
                const alertEmbed = {
                    title: '🚨 Spam Alert - Moderator Attention Required',
                    description: `Repeated spam detected from **${message.author.tag}**`,
                    fields: [
                        {
                            name: 'User',
                            value: `${message.author} (${message.author.id})`,
                            inline: true
                        },
                        {
                            name: 'Channel',
                            value: `${message.channel}`,
                            inline: true
                        },
                        {
                            name: 'Spam Types',
                            value: spamTypes.map(type => type.replace('_', ' ')).join('\n'),
                            inline: true
                        },
                        {
                            name: 'Warning Count',
                            value: `${warningCount}/5`,
                            inline: true
                        },
                        {
                            name: 'Account Age',
                            value: this.getAccountAge(message.author.createdAt),
                            inline: true
                        },
                        {
                            name: 'Join Date',
                            value: message.member ? this.getAccountAge(message.member.joinedAt) : 'Unknown',
                            inline: true
                        },
                        {
                            name: '💬 Message Content',
                            value: `\`\`\`${messageContent}\`\`\``,
                            inline: false
                        }
                    ],
                    color: 0xff0000,
                    timestamp: new Date().toISOString()
                };

                await logChannel.send({ embeds: [alertEmbed] });
            }

        } catch (error) {
            this.bot.logger.error(`Failed to notify moderators about spam:`, error);
        }
    }

    async notifyModeratorsWithActions(messageData, spamTypes, warningCount, action, actionDuration) {
        try {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
            // Check notification cooldown (prevent duplicate notifications within 10 seconds)
            const cooldownKey = `${messageData.guild.id}_${messageData.authorId}`;
            const lastNotification = this.notificationCooldowns.get(cooldownKey);
            const now = Date.now();
            
            if (lastNotification && (now - lastNotification) < 10000) {
                this.bot.logger.debug(`Skipping duplicate notification for ${messageData.authorTag} - cooldown active`);
                return;
            }
            
            // Set cooldown
            this.notificationCooldowns.set(cooldownKey, now);
            
            this.bot.logger.info(`🔔 Spam notification triggered for ${messageData.authorTag} in ${messageData.guild.name}`);
            
            const config = await this.bot.database.getGuildConfig(messageData.guild.id);
            
            // Verify we have guild data
            if (!messageData.guild || !messageData.guild.channels) {
                this.bot.logger.error(`❌ Cannot send spam notification: guild or channels not available`);
                return;
            }
            
            // Find log channel with multiple fallbacks
            let logChannel = null;
            
            // Try configured log channel first
            if (config && config.log_channel_id) {
                logChannel = messageData.guild.channels.cache.get(config.log_channel_id);
                if (logChannel && logChannel.isTextBased()) {
                    this.bot.logger.info(`✅ Using configured log channel: #${logChannel.name}`);
                } else {
                    logChannel = null;
                    this.bot.logger.warn(`⚠️ Configured log channel is not a text channel`);
                }
            }
            
            // Fallback: find channel with 'log' or 'mod' in name
            if (!logChannel) {
                logChannel = messageData.guild.channels.cache.find(c => 
                    c.isTextBased() && (
                        c.name.toLowerCase().includes('log') || 
                        c.name.toLowerCase().includes('mod') ||
                        c.name.toLowerCase().includes('security')
                    )
                );
                if (logChannel) {
                    this.bot.logger.info(`✅ Using auto-discovered log channel: #${logChannel.name}`);
                }
            }
            
            // Final fallback: use the channel where spam occurred
            if (!logChannel) {
                logChannel = messageData.channel;
                if (logChannel.isTextBased()) {
                    this.bot.logger.warn(`⚠️ Using spam channel as fallback: #${logChannel.name}`);
                } else {
                    logChannel = null;
                }
            }
            
            if (!logChannel) {
                this.bot.logger.error(`❌ Cannot send spam notification: no valid text channel found in guild ${messageData.guild.name}`);
                this.bot.logger.error(`Available channels: ${messageData.guild.channels.cache.map(c => `#${c.name} (${c.type})`).join(', ')}`);
                // Still send to dashboard and database even if Discord channel fails
            }

            const actionTaken = action === 'TIMEOUT' ? 
                `Timed out for ${Math.round(actionDuration / 60000)} minutes` : 
                'Message deleted and user warned';

            // Build notification data for both Discord and Dashboard
            const notificationData = {
                type: 'SPAM_DETECTED',
                userId: messageData.authorId,
                userTag: messageData.authorTag,
                userAvatar: messageData.author.displayAvatarURL({ dynamic: true }),
                channelId: messageData.channel.id,
                channelName: messageData.channel.name,
                guildId: messageData.guild.id,
                guildName: messageData.guild.name,
                spamTypes: spamTypes,
                warningCount: warningCount,
                action: action || 'WARN',
                actionDuration: actionDuration,
                actionTaken: actionTaken,
                messageContent: messageData.content.substring(0, 500),
                accountAge: this.getAccountAge(messageData.createdAt),
                joinedAge: messageData.joinedAt ? this.getAccountAge(messageData.joinedAt) : 'Unknown',
                timestamp: new Date().toISOString(),
                severity: warningCount >= 3 ? 'HIGH' : warningCount >= 2 ? 'MEDIUM' : 'LOW'
            };

            // 1. Send Discord notification with embed and buttons
            const alertEmbed = StandardEmbedBuilder.spamDetection(
                messageData.authorTag,
                messageData.authorId,
                messageData.channel.id,
                spamTypes,
                warningCount,
                actionTaken,
                notificationData.accountAge,
                messageData.content.substring(0, 200),
                notificationData.userAvatar,
                notificationData.severity
            );

            // Create action buttons for moderators
            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`spam_remove_${messageData.authorId}`)
                        .setLabel('Remove Timeout')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`spam_warn_${messageData.authorId}`)
                        .setLabel('Add Warning')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚠️'),
                    new ButtonBuilder()
                        .setCustomId(`spam_kick_${messageData.authorId}`)
                        .setLabel('Kick User')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('👢'),
                    new ButtonBuilder()
                        .setCustomId(`spam_ban_${messageData.authorId}`)
                        .setLabel('Ban User')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔨')
                );

            // Send to Discord (if log channel available)
            let discordMessageSent = false;
            if (logChannel) {
                try {
                    const sentMessage = await logChannel.send({ 
                        embeds: [alertEmbed],
                        components: [actionRow]
                    });
                    this.bot.logger.info(`✅ Discord spam notification sent to #${logChannel.name}`);
                    notificationData.discordMessageId = sentMessage.id;
                    discordMessageSent = true;
                } catch (sendError) {
                    this.bot.logger.error(`❌ Failed to send Discord notification:`, sendError);
                    
                    // Try fallback without buttons
                    if (sendError.code === 50013) {
                        try {
                            await logChannel.send({ 
                                content: `⚠️ **Spam Detected**\nUser: ${messageData.authorTag} (\`${messageData.authorId}\`)\nViolation: ${spamTypes.join(', ')}\nAction: ${actionTaken}`,
                            });
                            discordMessageSent = true;
                            this.bot.logger.info(`✅ Sent simplified spam notification (no buttons)`);
                        } catch (fallbackError) {
                            this.bot.logger.error(`❌ Fallback notification also failed:`, fallbackError);
                        }
                    }
                }
            } else {
                this.bot.logger.warn(`⚠️ Skipping Discord notification - no log channel available`);
            }

            // 2. Send to Dashboard via WebSocket (ALWAYS attempt this)
            if (this.bot.dashboard && this.bot.dashboard.wss) {
                try {
                    this.bot.dashboard.broadcastToGuild(messageData.guild.id, {
                        type: 'spam_alert',
                        data: notificationData
                    });
                    this.bot.logger.info(`✅ Dashboard notification sent via WebSocket`);
                } catch (wsError) {
                    this.bot.logger.error(`❌ Failed to send dashboard WebSocket notification:`, wsError);
                }
            }

            // 3. Store in database for dashboard API access
            try {
                await this.bot.database.run(`
                    INSERT INTO security_logs (
                        guild_id, event_type, severity, user_id, channel_id, 
                        action_taken, description, timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `, [
                    messageData.guild.id,
                    'SPAM_DETECTED',
                    notificationData.severity,
                    messageData.authorId,
                    messageData.channel.id,
                    actionTaken,
                    JSON.stringify(notificationData)
                ]);
                this.bot.logger.debug(`✅ Spam notification stored in database`);
            } catch (dbError) {
                this.bot.logger.error(`❌ Failed to store notification in database:`, dbError);
            }

            // Log final status
            if (discordMessageSent) {
                this.bot.logger.info(`✅ Complete spam notification sent for ${messageData.authorTag}`);
            } else {
                this.bot.logger.error(`❌ Failed to send spam notification for ${messageData.authorTag}`);
            }

        } catch (error) {
            this.bot.logger.error(`❌ Critical error in spam notification system:`, error);
        }
    }

    async updateMessageTracking(message) {
        const userId = message.author.id;
        const now = Date.now();
        
        // Update global user message times
        let userTimes = this.userMessageTimes.get(userId) || [];
        userTimes.push(now);
        
        // Keep only recent messages (last 10 minutes)
        userTimes = userTimes.filter(time => now - time <= 600000);
        this.userMessageTimes.set(userId, userTimes);
    }

    hasModeratorPermissions(member) {
        return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
               member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
               member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
               member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    getAccountAge(date) {
        const now = Date.now();
        const created = new Date(date).getTime();
        const ageMs = now - created;
        
        const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        } else {
            return `${hours}h`;
        }
    }

    // Clear all tracking data for a specific user (called after punishment)
    clearUserTracking(guildId, userId) {
        const userKey = `${guildId}_${userId}`;
        
        // Clear message times
        this.userMessageTimes.delete(userId);
        
        // Clear channel-specific tracking for all channels
        for (const key of this.userChannelMessages.keys()) {
            if (key.startsWith(`${userId}_`)) {
                this.userChannelMessages.delete(key);
            }
        }
        
        // Clear duplicate tracking
        this.duplicateMessages.delete(userKey);
        
        // Clear link cooldown
        this.linkCooldowns.delete(userId);
        
        // Clear mention cooldown
        this.mentionCooldowns.delete(userId);
        
        this.bot.logger.debug(`Cleared spam tracking data for user ${userId} in guild ${guildId}`);
    }
    
    // Reset warning count for a user (can be called when mod manually removes timeout)
    async resetUserWarnings(guildId, userId) {
        try {
            const userKey = `${guildId}_${userId}`;
            
            // Clear in-memory tracking
            this.clearUserTracking(guildId, userId);
            this.userWarningDecay.delete(userKey);
            this.recentlyPunished.delete(userKey);
            
            // Reset database warning count
            await this.bot.database.createOrUpdateUserRecord(guildId, userId, {
                warning_count: 0,
                trust_score: 50, // Reset to neutral
                flags: JSON.stringify({ warningsReset: true, resetAt: new Date().toISOString() })
            });
            
            this.bot.logger.info(`Reset spam warnings for user ${userId} in guild ${guildId}`);
            return true;
        } catch (error) {
            this.bot.logger.error(`Failed to reset warnings for ${userId}:`, error);
            return false;
        }
    }

    // Cleanup method to be called periodically
    cleanup() {
        const now = Date.now();
        const maxAge = 600000; // 10 minutes
        
        // Clean message tracking data
        for (const [key, times] of this.userMessageTimes.entries()) {
            const filteredTimes = times.filter(time => now - time <= maxAge);
            if (filteredTimes.length === 0) {
                this.userMessageTimes.delete(key);
            } else {
                this.userMessageTimes.set(key, filteredTimes);
            }
        }

        // Clean channel-specific message tracking
        for (const [key, times] of this.userChannelMessages.entries()) {
            const filteredTimes = times.filter(time => now - time <= maxAge);
            if (filteredTimes.length === 0) {
                this.userChannelMessages.delete(key);
            } else {
                this.userChannelMessages.set(key, filteredTimes);
            }
        }

        // Clean link cooldowns
        for (const [userId, lastTime] of this.linkCooldowns.entries()) {
            if (now - lastTime > maxAge) {
                this.linkCooldowns.delete(userId);
            }
        }
        
        // Clean duplicate message tracking (30 seconds)
        for (const [userKey, contentMap] of this.duplicateMessages.entries()) {
            for (const [content, data] of contentMap.entries()) {
                if (now - data.timestamp > 30000) {
                    contentMap.delete(content);
                }
            }
            if (contentMap.size === 0) {
                this.duplicateMessages.delete(userKey);
            }
        }
        
        // Clean recently punished tracking (keep for 5 minutes)
        for (const [key, timestamp] of this.recentlyPunished.entries()) {
            if (now - timestamp > 5 * 60 * 1000) {
                this.recentlyPunished.delete(key);
            }
        }
        
        // Clean warning decay timestamps (keep for 1 hour)
        for (const [key, timestamp] of this.userWarningDecay.entries()) {
            if (now - timestamp > 60 * 60 * 1000) {
                this.userWarningDecay.delete(key);
            }
        }
        
        // Clean notification cooldowns (keep for 30 seconds)
        for (const [key, timestamp] of this.notificationCooldowns.entries()) {
            if (now - timestamp > 30000) {
                this.notificationCooldowns.delete(key);
            }
        }
    }
}

module.exports = AntiSpam;