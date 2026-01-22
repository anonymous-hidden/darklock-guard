const stringSimilarity = require('string-similarity');

class AntiPhishing {
    constructor(bot) {
        this.bot = bot;
        this.suspiciousPatterns = [
            // Discord impersonation patterns
            /dis[c|k|cc|с]ord/i,  // Using Cyrillic 'c' and variations
            /nitro[\s\-_]*free/i,
            /free[\s\-_]*nitro/i,
            /discord[\s\-_]*gift/i,
            /steam[\s\-_]*gift/i,
            
            // Common phishing terms
            /verify[\s\-_]*account/i,
            /claim[\s\-_]*now/i,
            /limited[\s\-_]*time/i,
            /act[\s\-_]*fast/i,
            /expires[\s\-_]*soon/i,
            /congratulations/i,
            /you[\s\-_]*won/i,
            /selected[\s\-_]*winner/i,
            
            // Cryptocurrency scams
            /crypto[\s\-_]*giveaway/i,
            /bitcoin[\s\-_]*generator/i,
            /earn[\s\-_]*crypto/i,
            /investment[\s\-_]*opportunity/i,
            
            // Technical phishing
            /download[\s\-_]*now/i,
            /install[\s\-_]*update/i,
            /security[\s\-_]*alert/i,
            /account[\s\-_]*suspended/i
        ];
        
        this.trustedStaffRoles = new Set(); // Will be populated per guild
        this.memberSimilarityCache = new Map(); // username -> similarity scores
    }

    async initializeGuild(guildId) {
        this.bot.logger.debug(`🛡️  Anti-phishing system initialized for guild ${guildId}`);
    }

    async checkNewMember(member) {
        const guildId = member.guild.id;
        
        try {
            const config = await this.bot.database.getGuildConfig(guildId);
            if (!config.anti_phishing_enabled && !config.antiphishing_enabled) return false;
            
            let phishingDetected = false;
            let detectedIssues = [];
            
            // Check username for lookalikes and suspicious patterns
            const usernameIssues = await this.checkUsername(member);
            if (usernameIssues.length > 0) {
                phishingDetected = true;
                detectedIssues.push(...usernameIssues);
            }
            
            // Check for admin/moderator impersonation
            const impersonationIssues = await this.checkAdminImpersonation(member);
            if (impersonationIssues.length > 0) {
                phishingDetected = true;
                detectedIssues.push(...impersonationIssues);
            }
            
            if (phishingDetected) {
                await this.handlePhishingDetection(member, detectedIssues, 'NEW_MEMBER');
                return true;
            }
            
            return false;
            
        } catch (error) {
            this.bot.logger.error(`Anti-phishing check failed for new member ${member.user.tag}:`, error);
            return false;
        }
    }

    async checkMessage(message) {
        const guildId = message.guildId;
        const userId = message.author.id;
        
        try {
            const config = await this.bot.database.getGuildConfig(guildId);
            if (!config.anti_phishing_enabled && !config.antiphishing_enabled) return false;
            
            let phishingDetected = false;
            let detectedIssues = [];
            
            // Check message content for phishing patterns
            const contentIssues = await this.checkMessageContent(message);
            if (contentIssues.length > 0) {
                phishingDetected = true;
                detectedIssues.push(...contentIssues);
            }
            
            if (phishingDetected) {
                await this.handlePhishingDetection(message.member, detectedIssues, 'MESSAGE', message);
                return true;
            }
            
            return false;
            
        } catch (error) {
            this.bot.logger.error(`Anti-phishing message check failed:`, error);
            return false;
        }
    }

    async checkUsername(member) {
        const issues = [];
        const username = member.user.username.toLowerCase();
        const displayName = member.displayName.toLowerCase();
        
        // Check for Discord lookalikes
        const discordSimilarity = this.checkDiscordLookalike(username);
        if (discordSimilarity.isSuspicious) {
            issues.push({
                type: 'DISCORD_LOOKALIKE',
                severity: 'HIGH',
                details: discordSimilarity.reason,
                confidence: discordSimilarity.confidence
            });
        }
        
        // Check for staff impersonation
        const staffImpersonation = await this.checkStaffNameImpersonation(member, username);
        if (staffImpersonation.isSuspicious) {
            issues.push({
                type: 'STAFF_IMPERSONATION',
                severity: 'CRITICAL',
                details: staffImpersonation.reason,
                confidence: staffImpersonation.confidence
            });
        }
        
        // Check for common phishing usernames
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(username) || pattern.test(displayName)) {
                issues.push({
                    type: 'SUSPICIOUS_USERNAME',
                    severity: 'MEDIUM',
                    details: `Username matches phishing pattern: ${pattern}`,
                    confidence: 0.7
                });
                break; // Only report one pattern match
            }
        }
        
        return issues;
    }

    checkDiscordLookalike(username) {
        const discordVariants = [
            'discord', 'dis-cord', 'dis cord', 'discоrd', 'disсord', 'dis-c-ord',
            'diseord', 'discrod', 'disocrd', 'dіscord', 'discоrd'
        ];
        
        for (const variant of discordVariants) {
            const similarity = stringSimilarity.compareTwoStrings(username, variant);
            
            if (similarity > 0.8 && username !== 'discord') {
                return {
                    isSuspicious: true,
                    reason: `Username '${username}' closely resembles 'Discord' (${Math.round(similarity * 100)}% similar)`,
                    confidence: similarity
                };
            }
        }
        
        // Check for Unicode confusables (basic check)
        if (this.hasUnicodeConfusables(username)) {
            return {
                isSuspicious: true,
                reason: 'Username contains potentially confusing Unicode characters',
                confidence: 0.8
            };
        }
        
        return { isSuspicious: false };
    }

    hasUnicodeConfusables(text) {
        // Basic check for Cyrillic characters that look like Latin
        const cyrillic = /[а-яё]/i;
        const latin = /[a-z]/i;
        
        // If text contains both Cyrillic and Latin, it might be trying to confuse
        return cyrillic.test(text) && latin.test(text);
    }

    async checkStaffNameImpersonation(member, username) {
        try {
            // Get all staff members (members with mod/admin roles)
            const staffMembers = member.guild.members.cache.filter(m => 
                m.permissions.has('MODERATE_MEMBERS') || 
                m.permissions.has('MANAGE_GUILD') ||
                m.permissions.has('ADMINISTRATOR')
            );
            
            for (const [_, staffMember] of staffMembers) {
                if (staffMember.id === member.id) continue; // Skip self
                
                const staffUsername = staffMember.user.username.toLowerCase();
                const staffDisplayName = staffMember.displayName.toLowerCase();
                
                // Check similarity
                const usernameSimilarity = stringSimilarity.compareTwoStrings(username, staffUsername);
                const displaySimilarity = stringSimilarity.compareTwoStrings(username, staffDisplayName);
                
                const maxSimilarity = Math.max(usernameSimilarity, displaySimilarity);
                
                if (maxSimilarity > 0.85 && username !== staffUsername) {
                    return {
                        isSuspicious: true,
                        reason: `Username closely resembles staff member '${staffMember.user.username}' (${Math.round(maxSimilarity * 100)}% similar)`,
                        confidence: maxSimilarity,
                        impersonatedUser: staffMember.user.id
                    };
                }
            }
            
            return { isSuspicious: false };
            
        } catch (error) {
            this.bot.logger.error(`Staff impersonation check failed:`, error);
            return { isSuspicious: false };
        }
    }

    async checkAdminImpersonation(member) {
        const issues = [];
        
        // Check if user has typical admin/mod keywords in name but no actual permissions
        const adminKeywords = ['admin', 'mod', 'moderator', 'staff', 'helper', 'support', 'owner'];
        const username = member.user.username.toLowerCase();
        const displayName = member.displayName.toLowerCase();
        
        const hasAdminKeyword = adminKeywords.some(keyword => 
            username.includes(keyword) || displayName.includes(keyword)
        );
        
        const hasModPermissions = member.permissions.has('MODERATE_MEMBERS') ||
                                 member.permissions.has('MANAGE_MESSAGES') ||
                                 member.permissions.has('MANAGE_GUILD') ||
                                 member.permissions.has('ADMINISTRATOR');
        
        if (hasAdminKeyword && !hasModPermissions) {
            issues.push({
                type: 'FAKE_ADMIN',
                severity: 'HIGH',
                details: 'Username suggests admin role but user has no moderation permissions',
                confidence: 0.8
            });
        }
        
        return issues;
    }

    async checkMessageContent(message) {
        const issues = [];
        const content = message.content.toLowerCase();
        
        // Check for phishing patterns in message
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(content)) {
                issues.push({
                    type: 'PHISHING_CONTENT',
                    severity: 'HIGH',
                    details: `Message contains phishing pattern`,
                    confidence: 0.8,
                    pattern: pattern.source
                });
            }
        }
        
        // Check for fake Discord messages
        if (this.isFakeDiscordMessage(content)) {
            issues.push({
                type: 'FAKE_DISCORD_MESSAGE',
                severity: 'CRITICAL',
                details: 'Message appears to impersonate Discord system messages',
                confidence: 0.9
            });
        }
        
        // Check for impersonation mentions
        const impersonationMention = await this.checkImpersonationMentions(message);
        if (impersonationMention.isSuspicious) {
            issues.push({
                type: 'IMPERSONATION_MENTION',
                severity: 'HIGH',
                details: impersonationMention.reason,
                confidence: impersonationMention.confidence
            });
        }
        
        return issues;
    }

    isFakeDiscordMessage(content) {
        const discordMessagePatterns = [
            /discord.*has.*sent.*you.*gift/i,
            /congratulations.*discord.*nitro/i,
            /discord.*security.*team/i,
            /official.*discord.*message/i,
            /discord.*account.*verification/i,
            /discord.*support.*team/i
        ];
        
        return discordMessagePatterns.some(pattern => pattern.test(content));
    }

    async checkImpersonationMentions(message) {
        try {
            // If message mentions users and contains admin-like content
            if (message.mentions.users.size > 0) {
                const content = message.content.toLowerCase();
                const hasAdminTerms = /ban|kick|warn|timeout|mute|promote|demote/i.test(content);
                const hasUrgentTerms = /urgent|immediate|asap|now|quickly/i.test(content);
                
                if (hasAdminTerms && hasUrgentTerms && !message.member.permissions.has('MODERATE_MEMBERS')) {
                    return {
                        isSuspicious: true,
                        reason: 'Non-moderator user sending admin-like commands with urgency',
                        confidence: 0.7
                    };
                }
            }
            
            return { isSuspicious: false };
            
        } catch (error) {
            return { isSuspicious: false };
        }
    }

    async handlePhishingDetection(member, detectedIssues, source, message = null) {
        const guildId = member.guild.id;
        const userId = member.user.id;
        
        try {
            // Determine overall severity
            const maxSeverity = this.getMaxSeverity(detectedIssues);
            const avgConfidence = detectedIssues.reduce((sum, issue) => sum + issue.confidence, 0) / detectedIssues.length;
            
            // Log security incident
            await this.bot.database.logSecurityIncident(guildId, 'PHISHING_DETECTED', maxSeverity, {
                userId: userId,
                source: source,
                issues: detectedIssues,
                messageContent: message?.content?.substring(0, 200)
            });
            
            // Update user record
            await this.bot.database.createOrUpdateUserRecord(guildId, userId, {
                trust_score: Math.max(0, 25), // Very low trust score
                flags: JSON.stringify({ 
                    phishingDetected: true, 
                    issues: detectedIssues.map(i => i.type),
                    source: source
                })
            });
            
            // Apply appropriate response
            await this.applyPhishingResponse(member, detectedIssues, maxSeverity, avgConfidence, message);
            
            // Send warning
            await this.sendPhishingWarning(member, detectedIssues, source);
            
            // Notify moderators
            await this.notifyModerators(member, detectedIssues, source, message);
            
            this.bot.logger.security(`🎣 Phishing detected: ${member.user.tag} - ${detectedIssues.map(i => i.type).join(', ')}`);
            
        } catch (error) {
            this.bot.logger.error(`Failed to handle phishing detection:`, error);
        }
    }

    getMaxSeverity(issues) {
        const severityLevels = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4 };
        const maxLevel = Math.max(...issues.map(issue => severityLevels[issue.severity] || 1));
        
        return Object.keys(severityLevels).find(key => severityLevels[key] === maxLevel);
    }

    async applyPhishingResponse(member, detectedIssues, severity, confidence, message = null) {
        try {
            // Delete message if it exists (always safe to do)
            if (message) {
                try {
                    await message.delete();
                } catch (error) {
                    this.bot.logger.error(`Failed to delete phishing message:`, error);
                }
            }
            
            // Check if auto_action_enabled before applying punishments
            const guildConfig = await this.bot.database?.getGuildConfig(member.guild.id);
            const autoActionEnabled = guildConfig?.auto_action_enabled;
            
            if (!autoActionEnabled) {
                // Log but don't kick/timeout - warn-only mode
                this.bot.logger?.info(`[AntiPhishing] Phishing detected for ${member.id} but auto_action_enabled=false, logging only`);
                await this.bot.database?.run(`
                    INSERT INTO security_logs 
                    (guild_id, event_type, user_id, details, severity, created_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    member.guild.id,
                    'phishing_detected',
                    member.user.id,
                    JSON.stringify({ issues: detectedIssues, severity, confidence, autoActionSkipped: true }),
                    severity
                ]);
                return;
            }
            
            // Get configured action from database (default: timeout)
            const configuredAction = (guildConfig?.phishing_action || 'timeout').toLowerCase();
            this.bot.logger?.info(`[AntiPhishing] Applying action: ${configuredAction} for ${member.id} (severity: ${severity})`);
            
            // Apply the configured action
            const reason = `Phishing detection: ${detectedIssues[0]?.type || 'suspicious content'}`;
            
            switch (configuredAction) {
                case 'ban':
                    try {
                        await member.ban({ reason, deleteMessageSeconds: 86400 });
                        await this.bot.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            member.guild.id,
                            'BAN',
                            member.user.id,
                            this.bot.client.user.id,
                            `Auto-ban: ${reason}`
                        ]);
                        this.bot.logger?.info(`[AntiPhishing] Banned ${member.user.tag} for phishing`);
                    } catch (error) {
                        this.bot.logger.error(`Failed to ban phishing user:`, error);
                    }
                    break;
                    
                case 'kick':
                    try {
                        await member.kick(reason);
                        await this.bot.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            member.guild.id,
                            'KICK',
                            member.user.id,
                            this.bot.client.user.id,
                            `Auto-kick: ${reason}`
                        ]);
                        this.bot.logger?.info(`[AntiPhishing] Kicked ${member.user.tag} for phishing`);
                    } catch (error) {
                        this.bot.logger.error(`Failed to kick phishing user:`, error);
                    }
                    break;
                    
                case 'timeout':
                case 'mute':
                    try {
                        const duration = 24 * 60 * 60 * 1000; // 24 hours
                        await member.timeout(duration, reason);
                        await this.bot.database.run(`
                            INSERT INTO mod_actions 
                            (guild_id, action_type, target_user_id, moderator_id, reason, duration, expires_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [
                            member.guild.id,
                            'TIMEOUT',
                            member.user.id,
                            this.bot.client.user.id,
                            `Auto-timeout: ${reason}`,
                            duration,
                            new Date(Date.now() + duration).toISOString()
                        ]);
                        this.bot.logger?.info(`[AntiPhishing] Timed out ${member.user.tag} for phishing (24h)`);
                    } catch (error) {
                        this.bot.logger.error(`Failed to timeout phishing user:`, error);
                    }
                    break;
                    
                case 'warn':
                    // Just log and warn, no punishment
                    await this.bot.database.run(`
                        INSERT INTO mod_actions 
                        (guild_id, action_type, target_user_id, moderator_id, reason)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        member.guild.id,
                        'WARN',
                        member.user.id,
                        this.bot.client.user.id,
                        `Auto-warn: ${reason}`
                    ]);
                    this.bot.logger?.info(`[AntiPhishing] Warned ${member.user.tag} for phishing`);
                    break;
                    
                case 'delete':
                default:
                    // Message already deleted above, just log
                    await this.bot.database?.run(`
                        INSERT INTO security_logs 
                        (guild_id, event_type, user_id, details, severity, created_at)
                        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    `, [
                        member.guild.id,
                        'phishing_detected',
                        member.user.id,
                        JSON.stringify({ issues: detectedIssues, severity, confidence, action: 'delete_only' }),
                        severity
                    ]);
                    this.bot.logger?.info(`[AntiPhishing] Deleted message from ${member.user.tag} for phishing (delete only)`);
                    break;
            }
            
        } catch (error) {
            this.bot.logger.error(`Failed to apply phishing response:`, error);
        }
    }

    async sendPhishingWarning(member, detectedIssues, source) {
        try {
            const warningEmbed = {
                title: '🚨 Phishing Detection Alert',
                description: 'Your account has been flagged for potential phishing activity.',
                fields: [
                    {
                        name: 'Issues Detected',
                        value: detectedIssues.map(issue => `• ${issue.type.replace('_', ' ')}`).join('\n'),
                        inline: false
                    },
                    {
                        name: 'What This Means',
                        value: 'Your username, display name, or message content appears designed to deceive other users.',
                        inline: false
                    },
                    {
                        name: 'Next Steps',
                        value: 'Please contact a moderator if you believe this is an error. Consider changing your username to something less confusing.',
                        inline: false
                    }
                ],
                color: 0xff0000,
                footer: { text: 'This action was taken automatically to protect the community.' }
            };

            try {
                await member.user.send({ embeds: [warningEmbed] });
            } catch {
                // If DM fails, the user will see the moderation action in the server
            }

        } catch (error) {
            this.bot.logger.error(`Failed to send phishing warning:`, error);
        }
    }

    async notifyModerators(member, detectedIssues, source, message = null) {
        try {
            const config = await this.bot.database.getGuildConfig(member.guild.id);
            const logChannel = config.log_channel_id ? 
                member.guild.channels.cache.get(config.log_channel_id) : 
                member.guild.channels.cache.find(c => c.name.includes('log') || c.name.includes('security'));

            if (logChannel) {
                const alertEmbed = {
                    title: '🎣 Phishing Detection Alert',
                    description: `**${member.user.tag}** flagged for potential phishing`,
                    fields: [
                        {
                            name: 'User',
                            value: `${member.user} (${member.user.id})`,
                            inline: true
                        },
                        {
                            name: 'Detection Source',
                            value: source,
                            inline: true
                        },
                        {
                            name: 'Issues Detected',
                            value: detectedIssues.map(issue => 
                                `• **${issue.type}** (${issue.severity}): ${issue.details}`
                            ).join('\n').substring(0, 1000),
                            inline: false
                        }
                    ],
                    color: 0xff4500,
                    timestamp: new Date().toISOString()
                };

                if (message) {
                    alertEmbed.fields.push({
                        name: 'Message Content',
                        value: `\`\`\`${message.content.substring(0, 500)}\`\`\``,
                        inline: false
                    });
                }

                await logChannel.send({ embeds: [alertEmbed] });
            }

        } catch (error) {
            this.bot.logger.error(`Failed to notify moderators about phishing:`, error);
        }
    }
}

module.exports = AntiPhishing;