const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * Proactive Security Scanner
 * Scans all channels for threats when bot joins or on-demand
 */
class SecurityScanner {
    constructor(bot) {
        this.bot = bot;
        this.isScanning = false;
        this.scanResults = {
            maliciousLinks: [],
            phishingAttempts: [],
            spamMessages: [],
            toxicContent: [],
            flaggedUsers: []
        };
    }

    /**
     * Scan entire server for security threats
     */
    async scanServer(guild, options = {}) {
        if (this.isScanning) {
            return { error: 'Scan already in progress' };
        }

        this.isScanning = true;
        this.scanResults = {
            maliciousLinks: [],
            phishingAttempts: [],
            spamMessages: [],
            toxicContent: [],
            flaggedUsers: [],
            scannedMessages: 0,
            scannedChannels: 0,
            startTime: Date.now()
        };

        try {
            this.bot.logger.info(`🔍 Starting security scan of server: ${guild.name}`);

            // Get scan configuration
            const config = await this.getScanConfig(guild.id);
            const maxMessagesPerChannel = options.maxMessagesPerChannel || config.maxMessagesPerChannel || 100;

            // Get all text channels
            const channels = guild.channels.cache.filter(c => 
                c.type === 0 && // Text channels
                c.permissionsFor(guild.members.me).has(PermissionFlagsBits.ViewChannel) &&
                c.permissionsFor(guild.members.me).has(PermissionFlagsBits.ReadMessageHistory)
            );

            this.bot.logger.info(`📋 Found ${channels.size} accessible channels to scan`);

            // Scan each channel
            for (const [channelId, channel] of channels) {
                try {
                    await this.scanChannel(channel, maxMessagesPerChannel, config);
                    this.scanResults.scannedChannels++;
                } catch (error) {
                    this.bot.logger.error(`Error scanning channel ${channel.name}:`, error);
                }
            }

            this.scanResults.duration = Date.now() - this.scanResults.startTime;
            this.isScanning = false;

            // Save scan results to database
            await this.saveScanResults(guild.id);

            // Send scan report
            await this.sendScanReport(guild);

            return this.scanResults;

        } catch (error) {
            this.bot.logger.error('Error during server scan:', error);
            this.isScanning = false;
            throw error;
        }
    }

    /**
     * Scan individual channel for threats
     */
    async scanChannel(channel, maxMessages = 100, config) {
        try {
            let lastId;
            let messagesScanned = 0;
            
            while (messagesScanned < maxMessages) {
                const options = { limit: Math.min(100, maxMessages - messagesScanned) };
                if (lastId) options.before = lastId;

                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) break;

                for (const [msgId, message] of messages) {
                    if (message.author.bot) continue; // Skip bot messages

                    await this.analyzeMessage(message, config);
                    this.scanResults.scannedMessages++;
                    messagesScanned++;
                }

                lastId = messages.last().id;
                
                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            this.bot.logger.error(`Error scanning channel ${channel.name}:`, error);
        }
    }

    /**
     * Analyze individual message for threats
     */
    async analyzeMessage(message, config) {
        const threats = [];

        // Check for malicious links
        if (config.scanLinks && this.bot.antiMaliciousLinks) {
            const linkCheck = await this.bot.antiMaliciousLinks.checkMessage(message);
            if (linkCheck && linkCheck.isBlocked) {
                threats.push('malicious_link');
                this.scanResults.maliciousLinks.push({
                    messageId: message.id,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id,
                    username: message.author.tag,
                    content: message.content.substring(0, 200),
                    timestamp: message.createdAt,
                    url: linkCheck.url,
                    reason: linkCheck.reason
                });
            }
        }

        // Check for phishing
        if (config.scanPhishing && this.bot.antiPhishing) {
            const phishingCheck = await this.bot.antiPhishing.checkMessage(message);
            if (phishingCheck && phishingCheck.isPhishing) {
                threats.push('phishing');
                this.scanResults.phishingAttempts.push({
                    messageId: message.id,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id,
                    username: message.author.tag,
                    content: message.content.substring(0, 200),
                    timestamp: message.createdAt,
                    similarity: phishingCheck.similarity
                });
            }
        }

        // Check for spam patterns
        if (config.scanSpam && message.content.length > 0) {
            const isSpam = this.detectSpamPattern(message.content);
            if (isSpam) {
                threats.push('spam');
                this.scanResults.spamMessages.push({
                    messageId: message.id,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id,
                    username: message.author.tag,
                    content: message.content.substring(0, 200),
                    timestamp: message.createdAt
                });
            }
        }

        // Check for toxic content
        if (config.scanToxicity && this.bot.toxicityFilter) {
            const toxicCheck = await this.bot.toxicityFilter.checkMessage(message);
            if (toxicCheck && toxicCheck.isToxic) {
                threats.push('toxic');
                this.scanResults.toxicContent.push({
                    messageId: message.id,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id,
                    username: message.author.tag,
                    content: message.content.substring(0, 200),
                    timestamp: message.createdAt,
                    toxicityScore: toxicCheck.score
                });
            }
        }

        // Auto-delete if configured
        if (threats.length > 0 && config.autoDelete) {
            try {
                await message.delete();
                this.bot.logger.info(`🗑️ Auto-deleted flagged message from ${message.author.tag}`);
            } catch (error) {
                this.bot.logger.error('Error deleting message:', error);
            }
        }

        // Save to quarantine for manual review
        if (threats.length > 0 && !config.autoDelete) {
            await this.saveToQuarantine(message, threats);
        }

        return threats;
    }

    /**
     * Detect spam patterns
     */
    detectSpamPattern(content) {
        // Check for excessive caps
        const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
        if (capsRatio > 0.7 && content.length > 10) return true;

        // Check for excessive emojis
        const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
        if (emojiCount > 15) return true;

        // Check for repeated characters
        if (/(.)\1{10,}/.test(content)) return true;

        // Check for common spam phrases
        const spamPhrases = ['free nitro', 'click here', 'dm me', 'check dm', 'free money', 'get rich quick'];
        const lowerContent = content.toLowerCase();
        if (spamPhrases.some(phrase => lowerContent.includes(phrase))) return true;

        return false;
    }

    /**
     * Save flagged message to quarantine
     */
    async saveToQuarantine(message, threats) {
        try {
            await this.bot.database.run(`
                INSERT INTO quarantined_messages 
                (guild_id, message_id, channel_id, user_id, content, threats, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            `, [
                message.guild.id,
                message.id,
                message.channel.id,
                message.author.id,
                message.content,
                JSON.stringify(threats),
                message.createdAt.toISOString()
            ]);
        } catch (error) {
            this.bot.logger.error('Error saving to quarantine:', error);
        }
    }

    /**
     * Get scan configuration
     */
    async getScanConfig(guildId) {
        try {
            const config = await this.bot.database.get(`
                SELECT * FROM guild_configs WHERE guild_id = ?
            `, [guildId]);

            return {
                scanLinks: config?.antiphishing_enabled !== 0,
                scanPhishing: config?.antiphishing_enabled !== 0,
                scanSpam: config?.antispam_enabled !== 0,
                scanToxicity: true,
                autoDelete: config?.auto_delete_threats !== 0,
                maxMessagesPerChannel: 100
            };
        } catch (error) {
            return {
                scanLinks: true,
                scanPhishing: true,
                scanSpam: true,
                scanToxicity: true,
                autoDelete: false,
                maxMessagesPerChannel: 100
            };
        }
    }

    /**
     * Save scan results to database
     */
    async saveScanResults(guildId) {
        try {
            await this.bot.database.run(`
                INSERT INTO scan_history 
                (guild_id, scanned_messages, scanned_channels, threats_found, duration, scan_date)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                this.scanResults.scannedMessages,
                this.scanResults.scannedChannels,
                this.scanResults.maliciousLinks.length + 
                this.scanResults.phishingAttempts.length + 
                this.scanResults.spamMessages.length + 
                this.scanResults.toxicContent.length,
                this.scanResults.duration,
                new Date().toISOString()
            ]);
        } catch (error) {
            this.bot.logger.error('Error saving scan results:', error);
        }
    }

    /**
     * Send scan report to guild owner/admins
     */
    async sendScanReport(guild) {
        try {
            const totalThreats = 
                this.scanResults.maliciousLinks.length +
                this.scanResults.phishingAttempts.length +
                this.scanResults.spamMessages.length +
                this.scanResults.toxicContent.length;

            const embed = new EmbedBuilder()
                .setTitle('🔍 Security Scan Complete')
                .setDescription(`Completed scan of **${guild.name}**`)
                .setColor(totalThreats > 0 ? '#ff6b6b' : '#51cf66')
                .addFields(
                    { name: '📊 Channels Scanned', value: this.scanResults.scannedChannels.toString(), inline: true },
                    { name: '💬 Messages Scanned', value: this.scanResults.scannedMessages.toString(), inline: true },
                    { name: '⚠️ Threats Found', value: totalThreats.toString(), inline: true },
                    { name: '🔗 Malicious Links', value: this.scanResults.maliciousLinks.length.toString(), inline: true },
                    { name: '🎣 Phishing Attempts', value: this.scanResults.phishingAttempts.length.toString(), inline: true },
                    { name: '📢 Spam Messages', value: this.scanResults.spamMessages.length.toString(), inline: true },
                    { name: '☠️ Toxic Content', value: this.scanResults.toxicContent.length.toString(), inline: true },
                    { name: '⏱️ Duration', value: `${(this.scanResults.duration / 1000).toFixed(1)}s`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: true }
                )
                .setFooter({ text: 'View detailed results on the web dashboard' })
                .setTimestamp();

            // Get alert channel
            const config = await this.bot.database.get(`
                SELECT alert_channel FROM guild_configs WHERE guild_id = ?
            `, [guild.id]);

            let alertChannel;
            if (config?.alert_channel) {
                alertChannel = guild.channels.cache.get(config.alert_channel);
            }

            // Fallback to first text channel
            if (!alertChannel) {
                alertChannel = guild.channels.cache.find(c => 
                    c.type === 0 && 
                    c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
                );
            }

            if (alertChannel) {
                await alertChannel.send({ embeds: [embed] });
            }

        } catch (error) {
            this.bot.logger.error('Error sending scan report:', error);
        }
    }
}

module.exports = SecurityScanner;
