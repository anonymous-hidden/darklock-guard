const { EmbedBuilder, PermissionsBitField } = require('discord.js');

class SecurityManager {
    constructor(bot) {
        this.bot = bot;
        this.settings = new Map();
        this.rateLimits = new Map();
        this.suspiciousUsers = new Map();
        this.raidMode = false;
        
        // Default security settings
        this.defaultSettings = {
            antiSpam: {
                enabled: true,
                maxMessages: 5,
                timeWindow: 10000,
                muteTime: 300000,
                deleteMessages: true
            },
            antiRaid: {
                enabled: true,
                maxJoins: 10,
                timeWindow: 60000,
                lockdownTime: 600000,
                minimumAge: 604800000 // 7 days
            },
            antiPhishing: {
                enabled: true,
                checkLinks: true,
                suspiciousPatterns: [
                    'discord\\.gift',
                    'free\\s*nitro',
                    'nitro\\s*gift',
                    'steam\\s*gift',
                    'csgo\\s*skins'
                ]
            },
            moderation: {
                autoTimeout: true,
                timeoutDuration: 300000,
                logChannel: null,
                staffRoles: [],
                bypassRoles: []
            }
        };
    }

    async initialize(guildId) {
        const settings = await this.bot.database.get(
            'SELECT settings FROM guild_security WHERE guild_id = ?',
            [guildId]
        );
        
        if (settings) {
            this.settings.set(guildId, JSON.parse(settings.settings));
        } else {
            this.settings.set(guildId, this.defaultSettings);
            await this.saveSettings(guildId);
        }
    }

    async saveSettings(guildId) {
        const settings = this.settings.get(guildId) || this.defaultSettings;
        await this.bot.database.run(`
            INSERT OR REPLACE INTO guild_security (guild_id, settings, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [guildId, JSON.stringify(settings)]);
    }

    getSettings(guildId) {
        return this.settings.get(guildId) || this.defaultSettings;
    }

    async updateSettings(guildId, newSettings) {
        this.settings.set(guildId, { ...this.getSettings(guildId), ...newSettings });
        await this.saveSettings(guildId);
    }

    // Anti-Spam System
    async handleMessage(message) {
        if (!message.guild || message.author.bot) return;
        
        const settings = this.getSettings(message.guild.id);
        
        // Skip spam handling if the dedicated AntiSpam system is active
        // This prevents double-punishment issues
        if (this.bot.antiSpam) {
            // Only do phishing/suspicious content checks, not spam
            await this.checkSuspiciousContent(message, settings);
            return;
        }
        
        if (!settings.antiSpam.enabled) return;

        // Check if user bypasses security
        if (await this.canBypassSecurity(message.member, settings)) return;

        const userId = message.author.id;
        const guildId = message.guild.id;
        const key = `${guildId}-${userId}`;
        
        // Initialize rate limit tracking
        if (!this.rateLimits.has(key)) {
            this.rateLimits.set(key, { messages: [], warnings: 0 });
        }

        const userLimits = this.rateLimits.get(key);
        const now = Date.now();
        
        // Clean old messages
        userLimits.messages = userLimits.messages.filter(
            timestamp => now - timestamp < settings.antiSpam.timeWindow
        );
        
        userLimits.messages.push(now);

        // Check for spam
        if (userLimits.messages.length >= settings.antiSpam.maxMessages) {
            await this.handleSpam(message, settings);
            userLimits.messages = [];
            userLimits.warnings++;
        }

        // Check for suspicious patterns
        await this.checkSuspiciousContent(message, settings);
    }

    async handleSpam(message, settings) {
        try {
            // Delete recent messages if enabled
            if (settings.antiSpam.deleteMessages) {
                const messages = await message.channel.messages.fetch({ limit: 10 });
                const userMessages = messages.filter(msg => 
                    msg.author.id === message.author.id && 
                    Date.now() - msg.createdTimestamp < settings.antiSpam.timeWindow
                );
                
                await message.channel.bulkDelete(userMessages);
            }

            // Timeout user
            if (settings.moderation.autoTimeout) {
                try {
                    await message.member.timeout(
                        settings.antiSpam.muteTime,
                        'Anti-spam: Excessive messaging'
                    );
                } catch (error) {
                    if (error.code === 50013) {
                        console.log('[SecurityManager] Missing "Moderate Members" permission to timeout user');
                    } else {
                        throw error;
                    }
                }
            }

            // Log incident
            // Compute approximate recent message count if available
            let recentCount = 'unknown';
            try {
                const key = `${message.guild.id}-${message.author.id}`;
                const rl = this.rateLimits.get(key);
                if (rl && Array.isArray(rl.messages)) recentCount = rl.messages.length;
            } catch (_) { /* ignore */ }

            await this.logSecurityEvent(message.guild.id, {
                type: 'spam',
                user_id: message.author.id,
                channel_id: message.channel.id,
                description: `Spam detected: ${recentCount} messages in ${settings.antiSpam.timeWindow}ms`,
                severity: 'medium',
                action_taken: 'timeout_and_delete',
                evidence: message.content.substring(0, 500)
            });

            // Send alert to log channel
            await this.sendSecurityAlert(message.guild, 'spam', {
                user: message.author,
                channel: message.channel,
                reason: 'Excessive messaging detected'
            });

        } catch (error) {
            this.bot.logger.error('Error handling spam:', error);
        }
    }

    // Anti-Raid System
    async handleMemberJoin(member) {
        const settings = this.getSettings(member.guild.id);
        if (!settings.antiRaid.enabled) return;

        const guildId = member.guild.id;
        const key = `raid-${guildId}`;
        const now = Date.now();
        
        // Track recent joins
        if (!this.rateLimits.has(key)) {
            this.rateLimits.set(key, { joins: [] });
        }

        const guildLimits = this.rateLimits.get(key);
        
        // Clean old joins
        guildLimits.joins = guildLimits.joins.filter(
            timestamp => now - timestamp < settings.antiRaid.timeWindow
        );
        
        guildLimits.joins.push(now);

        // Check account age
        const accountAge = now - member.user.createdTimestamp;
        const isSuspicious = accountAge < settings.antiRaid.minimumAge;

        if (isSuspicious) {
            this.suspiciousUsers.set(member.id, {
                reason: 'new_account',
                joinedAt: now,
                accountAge: accountAge
            });
        }

        // Check for raid
        if (guildLimits.joins.length >= settings.antiRaid.maxJoins) {
            await this.handlePossibleRaid(member.guild, settings);
        }

        // Log suspicious join
        if (isSuspicious) {
            await this.logSecurityEvent(member.guild.id, {
                type: 'suspicious_join',
                user_id: member.user.id,
                description: `Suspicious account joined: ${Math.floor(accountAge / 86400000)} days old`,
                severity: 'low',
                evidence: JSON.stringify({
                    accountAge: accountAge,
                    createdAt: member.user.createdAt.toISOString()
                })
            });
        }
    }

    async handlePossibleRaid(guild, settings) {
        try {
            // Check if auto_action_enabled - if not, just log and alert without lockdown
            const config = await this.bot.database?.getGuildConfig(guild.id);
            const autoActionEnabled = config?.auto_action_enabled;
            
            // Log raid detection regardless
            await this.logSecurityEvent(guild.id, {
                type: 'raid',
                description: `Possible raid detected: ${this.rateLimits.get(`raid-${guild.id}`).joins.length} joins in short period`,
                severity: 'high',
                action_taken: autoActionEnabled ? 'server_lockdown' : 'alert_only'
            });

            // Send alert regardless
            await this.sendSecurityAlert(guild, 'raid', {
                reason: 'Multiple users joined rapidly',
                action: autoActionEnabled ? 'Server locked down automatically' : 'Auto-action disabled - manual intervention required'
            });
            
            // Only perform auto-lockdown if auto_action_enabled
            if (!autoActionEnabled) {
                this.bot.logger?.info(`[SecurityManager] Raid detected in ${guild.id} but auto_action_enabled=false, skipping lockdown`);
                return;
            }
            
            this.raidMode = true;
            
            // Lock down the server
            const everyone = guild.roles.everyone;
            await everyone.edit({
                permissions: everyone.permissions.remove([
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.CreatePublicThreads,
                    PermissionsBitField.Flags.CreatePrivateThreads
                ])
            });

            // Auto-unlock after timeout
            setTimeout(async () => {
                this.raidMode = false;
                await everyone.edit({
                    permissions: everyone.permissions.add([
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.CreatePublicThreads,
                        PermissionsBitField.Flags.CreatePrivateThreads
                    ])
                });
                
                await this.logSecurityEvent(guild.id, {
                    type: 'raid_end',
                    description: 'Automatic server unlock after raid protection',
                    severity: 'low'
                });
            }, settings.antiRaid.lockdownTime);

        } catch (error) {
            this.bot.logger.error('Error handling raid:', error);
        }
    }

    // Phishing Detection
    async checkSuspiciousContent(message, settings) {
        if (!settings.antiPhishing.enabled) return;

        const content = message.content.toLowerCase();
        let detected = false;

        // Check for suspicious patterns
        for (const pattern of settings.antiPhishing.suspiciousPatterns) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(content)) {
                detected = true;
                break;
            }
        }

        // Check for suspicious links
        if (settings.antiPhishing.checkLinks) {
            const linkRegex = /(https?:\/\/[^\s]+)/gi;
            const links = content.match(linkRegex);
            
            if (links) {
                for (const link of links) {
                    if (await this.isPhishingLink(link)) {
                        detected = true;
                        break;
                    }
                }
            }
        }

        if (detected) {
            await this.handlePhishing(message, settings);
        }
    }

    async isPhishingLink(url) {
        try {
            const domain = new URL(url).hostname.toLowerCase();
            
            // Common phishing domains
            const phishingDomains = [
                'discordgift.site',
                'discord-gift.com',
                'steampowerd.com',
                'steamcomunity.com'
            ];
            
            return phishingDomains.some(phishing => 
                domain.includes(phishing) || 
                domain.replace(/[0-9]/g, '').includes(phishing.replace(/[0-9]/g, ''))
            );
        } catch {
            return false;
        }
    }

    async handlePhishing(message, settings) {
        try {
            // Delete message
            await message.delete();
            
            // Timeout user
            if (settings.moderation.autoTimeout) {
                await message.member.timeout(
                    settings.moderation.timeoutDuration,
                    'Phishing/malicious content detected'
                );
            }

            // Log incident
            await this.logSecurityEvent(message.guild.id, {
                type: 'phishing',
                user_id: message.author.id,
                channel_id: message.channel.id,
                description: 'Phishing or malicious content detected',
                severity: 'high',
                action_taken: 'delete_and_timeout',
                evidence: message.content.substring(0, 500)
            });

            // Send alert
            await this.sendSecurityAlert(message.guild, 'phishing', {
                user: message.author,
                channel: message.channel,
                reason: 'Malicious content detected'
            });

        } catch (error) {
            this.bot.logger.error('Error handling phishing:', error);
        }
    }

    async canBypassSecurity(member, settings) {
        if (!member) return false;
        
        // Check if user has bypass roles
        const bypassRoles = settings.moderation.bypassRoles || [];
        if (member.roles.cache.some(role => 
            bypassRoles.includes(role.id) || 
            role.permissions.has(PermissionsBitField.Flags.ManageMessages)
        )) {
            return true;
        }

        // Database-backed whitelists
        if (this.bot?.database) {
            const guildId = member.guild.id;

            const userRow = await this.bot.database.get(
                `SELECT 1 FROM whitelists WHERE guild_id = ? AND whitelist_type = 'user' AND target_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
                [guildId, member.id]
            );
            if (userRow) return true;

            const roleIds = member.roles.cache.map(r => r.id);
            if (roleIds.length) {
                const placeholders = roleIds.map(() => '?').join(',');
                const roleRow = await this.bot.database.get(
                    `SELECT 1 FROM whitelists WHERE guild_id = ? AND whitelist_type = 'role' AND target_id IN (${placeholders}) AND active = 1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 1`,
                    [guildId, ...roleIds]
                );
                if (roleRow) return true;
            }
        }

        return false;
    }

    async logSecurityEvent(guildId, eventData) {
        try {
            // Use new Logger system instead of old security_logs table
            await this.bot.logger.logSecurityEvent({
                eventType: eventData.type,
                guildId: guildId,
                channelId: eventData.channel_id || null,
                moderatorId: null,
                moderatorTag: null,
                targetId: eventData.user_id || null,
                targetTag: null,
                reason: eventData.description,
                details: {
                    severity: eventData.severity || 'medium',
                    action_taken: eventData.action_taken || 'none',
                    evidence: eventData.evidence || null
                }
            });
        } catch (error) {
            this.bot.logger.error('Error logging security event:', error);
        }
    }

    async sendSecurityAlert(guild, type, data) {
        const settings = this.getSettings(guild.id);
        const logChannelId = settings.moderation.logChannel;
        
        if (!logChannelId) return;
        
        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor(this.getSeverityColor(type))
            .setTitle(`🛡️ Security Alert: ${type.toUpperCase()}`)
            .setTimestamp();

        switch (type) {
            case 'spam':
                embed
                    .setDescription(`Spam detected in ${data.channel}`)
                    .addFields([
                        { name: 'User', value: data.user.toString(), inline: true },
                        { name: 'Channel', value: data.channel.toString(), inline: true },
                        { name: 'Action Taken', value: 'User timed out, messages deleted', inline: false }
                    ]);
                break;
            case 'raid':
                embed
                    .setDescription('Possible raid detected - Server locked down')
                    .addFields([
                        { name: 'Reason', value: data.reason, inline: false },
                        { name: 'Action', value: data.action, inline: false }
                    ]);
                break;
            case 'phishing':
                embed
                    .setDescription(`Malicious content detected in ${data.channel}`)
                    .addFields([
                        { name: 'User', value: data.user.toString(), inline: true },
                        { name: 'Channel', value: data.channel.toString(), inline: true },
                        { name: 'Action Taken', value: 'Message deleted, user timed out', inline: false }
                    ]);
                break;
        }

        try {
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            this.bot.logger.error('Error sending security alert:', error);
        }
    }

    getSeverityColor(type) {
        switch (type) {
            case 'spam': return 0xFFA500; // Orange
            case 'raid': return 0xFF0000; // Red
            case 'phishing': return 0xFF0000; // Red
            case 'suspicious_join': return 0xFFFF00; // Yellow
            default: return 0x808080; // Gray
        }
    }

    // Clean up old data periodically
    cleanup() {
        const now = Date.now();
        const maxAge = 3600000; // 1 hour
        
        for (const [key, data] of this.rateLimits.entries()) {
            if (data.messages) {
                data.messages = data.messages.filter(timestamp => now - timestamp < maxAge);
                if (data.messages.length === 0 && data.warnings === 0) {
                    this.rateLimits.delete(key);
                }
            }
        }
        
        for (const [userId, data] of this.suspiciousUsers.entries()) {
            if (now - data.joinedAt > maxAge) {
                this.suspiciousUsers.delete(userId);
            }
        }
    }

    // Get security statistics
    async getStats(guildId, timeframe = '24h') {
        const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 24;
        
        try {
            const stats = await this.bot.database.get(`
                SELECT 
                    COUNT(*) as total_incidents,
                    COUNT(CASE WHEN incident_type = 'spam' THEN 1 END) as spam_count,
                    COUNT(CASE WHEN incident_type = 'phishing' THEN 1 END) as phishing_count,
                    COUNT(CASE WHEN incident_type = 'raid' THEN 1 END) as raid_count,
                    COUNT(CASE WHEN incident_type = 'suspicious_join' THEN 1 END) as suspicious_joins
                FROM security_logs 
                WHERE guild_id = ? AND created_at > datetime('now', '-${hours} hours')
            `, [guildId]);
            
            return {
                totalIncidents: stats.total_incidents || 0,
                spam: stats.spam_count || 0,
                phishing: stats.phishing_count || 0,
                raids: stats.raid_count || 0,
                suspiciousJoins: stats.suspicious_joins || 0,
                timeframe: timeframe
            };
        } catch (error) {
            this.bot.logger.error('Error getting security stats:', error);
            return {
                totalIncidents: 0,
                spam: 0,
                phishing: 0,
                raids: 0,
                suspiciousJoins: 0,
                timeframe: timeframe
            };
        }
    }
}

module.exports = SecurityManager;
