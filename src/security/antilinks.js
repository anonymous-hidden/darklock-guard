const axios = require('axios');
const URL = require('url-parse');

class AntiMaliciousLinks {
    constructor(bot) {
        this.bot = bot;
        this.urlCache = new Map(); // url -> { threat: boolean, lastChecked: timestamp }
        this.shortenerDomains = new Set([
            'bit.ly', 'tinyurl.com', 'short.link', 'ow.ly', 'is.gd',
            't.co', 'goo.gl', 'buff.ly', 'adf.ly', 'cutt.ly',
            'tiny.cc', 'rb.gy', 'linktr.ee', 'bitly.com'
        ]);
        this.trustedDomains = new Set([
            'discord.com', 'discordapp.com', 'discord.gg', 'discord.media',
            'youtube.com', 'youtu.be', 'github.com', 'stackoverflow.com',
            'wikipedia.org', 'google.com', 'microsoft.com', 'reddit.com',
            'twitter.com', 'twitch.tv', 'spotify.com', 'imgur.com'
        ]);
        this.phishingPatterns = [
            /disc[o0]rd[\-\.]?(nitro|gift|free)/i,
            /free[\-\s]*(nitro|discord)/i,
            /steam[\-\s]*gift/i,
            /cs[\-\s]*go[\-\s]*skins/i,
            /crypto[\-\s]*giveaway/i,
            /token[\-\s]*grab/i,
            /dis[c|k|cc]ord[\-\.]/i // Common misspellings
        ];
    }

    async checkMessage(message) {
        const content = message.content;
        const guildId = message.guildId;
        
        try {
            // Feature toggle enforcement - check if anti-phishing is enabled
            const config = await this.bot.database.getGuildConfig(guildId);
            if (!config || (!config.anti_phishing_enabled && !config.antiphishing_enabled)) {
                return { isBlocked: false, disabled: true };
            }
            
            // Extract URLs from message
            const urls = this.extractUrls(content);
            if (urls.length === 0) return false;

            let maliciousDetected = false;
            let detectedThreats = [];

            for (const url of urls) {
                const threatInfo = await this.analyzeUrl(url, guildId);
                
                if (threatInfo.isThreat) {
                    maliciousDetected = true;
                    detectedThreats.push(threatInfo);
                }
            }

            if (maliciousDetected) {
                await this.handleMaliciousLink(message, detectedThreats);
                return true;
            }

            return false;

        } catch (error) {
            this.bot.logger.error(`Anti-malicious links check failed:`, error);
            return false;
        }
    }

    extractUrls(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const matches = text.match(urlRegex);
        return matches || [];
    }

    async analyzeUrl(url, guildId) {
        try {
            // Check cache first
            const cached = this.urlCache.get(url);
            if (cached && Date.now() - cached.lastChecked < 300000) { // 5 minutes cache
                return {
                    url: url,
                    isThreat: cached.threat,
                    threatType: cached.threatType || 'CACHED',
                    confidence: cached.confidence || 0.5
                };
            }

            // Parse URL
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname.toLowerCase();

            // Quick checks
            const quickResult = await this.performQuickChecks(url, domain, parsedUrl);
            if (quickResult.isThreat) {
                this.cacheResult(url, quickResult);
                return quickResult;
            }

            // Check against database
            const dbResult = await this.checkDatabase(url, domain);
            if (dbResult.isThreat) {
                return dbResult;
            }

            // Check with external APIs if enabled
            const apiResult = await this.checkExternalAPIs(url, domain);
            if (apiResult.isThreat) {
                this.cacheResult(url, apiResult);
                await this.updateDatabase(url, apiResult);
                return apiResult;
            }

            // If no threat detected, cache as safe
            this.cacheResult(url, { isThreat: false, threatType: 'SAFE' });
            
            return {
                url: url,
                isThreat: false,
                threatType: 'SAFE',
                confidence: 0.1
            };

        } catch (error) {
            this.bot.logger.error(`URL analysis failed for ${url}:`, error);
            return {
                url: url,
                isThreat: false,
                threatType: 'ERROR',
                confidence: 0
            };
        }
    }

    async performQuickChecks(url, domain, parsedUrl) {
        // Check if domain is trusted
        if (this.trustedDomains.has(domain)) {
            return {
                url: url,
                isThreat: false,
                threatType: 'TRUSTED_DOMAIN',
                confidence: 0.1
            };
        }

        // Check for phishing patterns in URL
        for (const pattern of this.phishingPatterns) {
            if (pattern.test(url)) {
                return {
                    url: url,
                    isThreat: true,
                    threatType: 'PHISHING_PATTERN',
                    confidence: 0.8
                };
            }
        }

        // Check for suspicious domain patterns
        const suspiciousDomain = this.checkSuspiciousDomain(domain);
        if (suspiciousDomain.isSuspicious) {
            return {
                url: url,
                isThreat: true,
                threatType: suspiciousDomain.reason,
                confidence: suspiciousDomain.confidence
            };
        }

        // Check for URL shorteners
        if (this.shortenerDomains.has(domain)) {
            // Try to expand the URL
            try {
                const expandedUrl = await this.expandShortUrl(url);
                if (expandedUrl && expandedUrl !== url) {
                    return await this.analyzeUrl(expandedUrl); // Recursive analysis
                }
            } catch (error) {
                // If expansion fails, treat as suspicious
                return {
                    url: url,
                    isThreat: true,
                    threatType: 'SUSPICIOUS_SHORTENER',
                    confidence: 0.6
                };
            }
        }

        // Check for suspicious URL structure
        const urlSuspicion = this.checkUrlStructure(parsedUrl);
        if (urlSuspicion.isSuspicious) {
            return {
                url: url,
                isThreat: true,
                threatType: urlSuspicion.reason,
                confidence: urlSuspicion.confidence
            };
        }

        return { isThreat: false };
    }

    checkSuspiciousDomain(domain) {
        // Check for domains with excessive subdomains
        const parts = domain.split('.');
        if (parts.length > 4) {
            return {
                isSuspicious: true,
                reason: 'EXCESSIVE_SUBDOMAINS',
                confidence: 0.7
            };
        }

        // Check for domains that look like Discord
        const discordLike = /dis[c|k|cc]ord|nitro|discord/i;
        if (discordLike.test(domain) && !domain.includes('discord.com') && !domain.includes('discordapp.com')) {
            return {
                isSuspicious: true,
                reason: 'DISCORD_LOOKALIKE',
                confidence: 0.9
            };
        }

        // Check for domains with numbers/hyphens suggesting compromise
        if (/[0-9]{3,}|[-]{2,}/.test(domain)) {
            return {
                isSuspicious: true,
                reason: 'SUSPICIOUS_PATTERN',
                confidence: 0.6
            };
        }

        // Check for very new domains (would need WHOIS API)
        // This is a placeholder - in production you'd want proper WHOIS checking

        return { isSuspicious: false };
    }

    checkUrlStructure(parsedUrl) {
        const { pathname, query } = parsedUrl;

        // Check for suspicious paths
        const suspiciousPaths = [
            /login|auth|secure|verify|account/i,
            /download|install|exe|zip/i,
            /admin|panel|control/i
        ];

        for (const pattern of suspiciousPaths) {
            if (pattern.test(pathname)) {
                return {
                    isSuspicious: true,
                    reason: 'SUSPICIOUS_PATH',
                    confidence: 0.7
                };
            }
        }

        // Check for suspicious query parameters
        if (query && /token|key|auth|pass|login/.test(query)) {
            return {
                isSuspicious: true,
                reason: 'SUSPICIOUS_PARAMETERS',
                confidence: 0.8
            };
        }

        return { isSuspicious: false };
    }

    async expandShortUrl(url) {
        try {
            const response = await axios.head(url, {
                timeout: 5000,
                maxRedirects: 5
            });
            return response.request.res.responseUrl || url;
        } catch (error) {
            // If we can't expand it, it's suspicious
            return null;
        }
    }

    async checkDatabase(url, domain) {
        try {
            const result = await this.bot.database.get(`
                SELECT * FROM malicious_links 
                WHERE url = ? OR url LIKE ?
                ORDER BY last_checked DESC 
                LIMIT 1
            `, [url, `%${domain}%`]);

            if (result) {
                const ageHours = (Date.now() - new Date(result.last_checked).getTime()) / (1000 * 60 * 60);
                
                // If record is recent (less than 24 hours) and verified
                if (ageHours < 24 && result.verified) {
                    return {
                        url: url,
                        isThreat: !result.whitelisted,
                        threatType: result.threat_type || 'DATABASE',
                        confidence: 0.9
                    };
                }
            }

            return { isThreat: false };

        } catch (error) {
            this.bot.logger.error(`Database check failed for ${url}:`, error);
            return { isThreat: false };
        }
    }

    async checkExternalAPIs(url, domain) {
        const integrations = this.bot.config.getIntegrationsConfig();
        
        try {
            // VirusTotal API check
            if (integrations.virusTotal?.enabled && integrations.virusTotal?.apiKey) {
                const vtResult = await this.checkVirusTotal(url, integrations.virusTotal.apiKey);
                if (vtResult.isThreat) return vtResult;
            }

            // URLVoid API check
            if (integrations.urlVoid?.enabled && integrations.urlVoid?.apiKey) {
                const uvResult = await this.checkURLVoid(domain, integrations.urlVoid.apiKey);
                if (uvResult.isThreat) return uvResult;
            }

            // Google Safe Browsing check
            if (integrations.safeBrowsing?.enabled && integrations.safeBrowsing?.apiKey) {
                const sbResult = await this.checkSafeBrowsing(url, integrations.safeBrowsing.apiKey);
                if (sbResult.isThreat) return sbResult;
            }

            return { isThreat: false };

        } catch (error) {
            this.bot.logger.error(`External API checks failed for ${url}:`, error);
            return { isThreat: false };
        }
    }

    async checkVirusTotal(url, apiKey) {
        try {
            const urlId = Buffer.from(url).toString('base64url');
            
            const response = await axios.get(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
                headers: {
                    'X-Apikey': apiKey
                },
                timeout: 10000
            });

            const stats = response.data.data.attributes.last_analysis_stats;
            const maliciousCount = stats.malicious || 0;
            const suspiciousCount = stats.suspicious || 0;

            if (maliciousCount > 2 || (maliciousCount + suspiciousCount) > 5) {
                return {
                    url: url,
                    isThreat: true,
                    threatType: 'VIRUSTOTAL_DETECTED',
                    confidence: Math.min(0.9, (maliciousCount + suspiciousCount * 0.5) / 10)
                };
            }

            return { isThreat: false };

        } catch (error) {
            if (error.response?.status === 404) {
                // URL not found in VT database, not necessarily a threat
                return { isThreat: false };
            }
            throw error;
        }
    }

    async checkURLVoid(domain, apiKey) {
        try {
            const response = await axios.get(`http://www.urlvoid.com/api1000/${apiKey}/host/${domain}/`, {
                timeout: 10000
            });

            // URLVoid returns XML, would need proper XML parsing
            // This is a simplified check
            if (response.data.includes('<detections>') && 
                !response.data.includes('<detections>0</detections>')) {
                return {
                    url: domain,
                    isThreat: true,
                    threatType: 'URLVOID_DETECTED',
                    confidence: 0.8
                };
            }

            return { isThreat: false };

        } catch (error) {
            throw error;
        }
    }

    async checkSafeBrowsing(url, apiKey) {
        try {
            const response = await axios.post(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
                client: {
                    clientId: 'discord-security-bot',
                    clientVersion: '1.0.0'
                },
                threatInfo: {
                    threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                    platformTypes: ['ANY_PLATFORM'],
                    threatEntryTypes: ['URL']
                },
                threatEntries: [{ url: url }]
            }, {
                timeout: 10000
            });

            if (response.data.matches && response.data.matches.length > 0) {
                return {
                    url: url,
                    isThreat: true,
                    threatType: 'SAFE_BROWSING_DETECTED',
                    confidence: 0.95
                };
            }

            return { isThreat: false };

        } catch (error) {
            throw error;
        }
    }

    async updateDatabase(url, threatInfo) {
        try {
            await this.bot.database.run(`
                INSERT OR REPLACE INTO malicious_links 
                (url, threat_type, severity, source, verified, last_checked)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                url,
                threatInfo.threatType,
                Math.round(threatInfo.confidence * 10),
                'AUTO_SCAN',
                threatInfo.confidence > 0.8 ? 1 : 0,
                new Date().toISOString()
            ]);
        } catch (error) {
            this.bot.logger.error(`Failed to update database with threat info:`, error);
        }
    }

    cacheResult(url, result) {
        this.urlCache.set(url, {
            threat: result.isThreat,
            threatType: result.threatType,
            confidence: result.confidence,
            lastChecked: Date.now()
        });

        // Limit cache size
        if (this.urlCache.size > 1000) {
            const entries = Array.from(this.urlCache.entries());
            entries.sort((a, b) => a[1].lastChecked - b[1].lastChecked);
            
            // Remove oldest 200 entries
            for (let i = 0; i < 200; i++) {
                this.urlCache.delete(entries[i][0]);
            }
        }
    }

    async handleMaliciousLink(message, detectedThreats) {
        const guildId = message.guildId;
        const userId = message.author.id;

        try {
            // Log the incident
            await this.bot.database.logSecurityIncident(guildId, 'MALICIOUS_LINK', 'HIGH', {
                userId: userId,
                channelId: message.channelId,
                threats: detectedThreats,
                messageContent: message.content
            });

            // Delete the message immediately
            try {
                await message.delete();
            } catch (error) {
                this.bot.logger.error(`Failed to delete malicious link message:`, error);
            }

            // Update user record
            await this.bot.database.createOrUpdateUserRecord(guildId, userId, {
                trust_score: Math.max(0, 20), // Very low trust score
                flags: JSON.stringify({ 
                    maliciousLinks: true, 
                    threats: detectedThreats.map(t => t.threatType) 
                })
            });

            // Apply punishment
            await this.applyPunishment(message, detectedThreats);

            // Send warning
            await this.sendLinkWarning(message, detectedThreats);

            // Notify moderators
            await this.notifyModerators(message, detectedThreats);

            this.bot.logger.security(`🚨 Malicious link blocked from ${message.author.tag}: ${detectedThreats.map(t => t.threatType).join(', ')}`);

        } catch (error) {
            this.bot.logger.error(`Failed to handle malicious link:`, error);
        }
    }

    async applyPunishment(message, detectedThreats) {
        const highThreatTypes = ['PHISHING_PATTERN', 'DISCORD_LOOKALIKE', 'VIRUSTOTAL_DETECTED', 'SAFE_BROWSING_DETECTED'];
        const hasHighThreat = detectedThreats.some(t => highThreatTypes.includes(t.threatType));
        const maxConfidence = Math.max(...detectedThreats.map(t => t.confidence));

        try {
            if (hasHighThreat || maxConfidence > 0.8) {
                // Immediate timeout for high-confidence threats
                await message.member.timeout(24 * 60 * 60 * 1000, `Malicious link detected: ${detectedThreats[0].threatType}`);
                
                await this.bot.database.run(`
                    INSERT INTO mod_actions 
                    (guild_id, action_type, target_user_id, moderator_id, reason, duration, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    message.guildId,
                    'TIMEOUT',
                    message.author.id,
                    this.bot.client.user.id,
                    `Auto-timeout: malicious link (${detectedThreats[0].threatType})`,
                    24 * 60 * 60 * 1000,
                    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                ]);
            }
        } catch (error) {
            this.bot.logger.error(`Failed to apply punishment for malicious link:`, error);
        }
    }

    async sendLinkWarning(message, detectedThreats) {
        try {
            const warningEmbed = {
                title: '🚨 Malicious Link Blocked',
                description: 'Your message contained a potentially dangerous link and has been removed for your safety and the safety of others.',
                fields: [
                    {
                        name: 'Threat Type',
                        value: detectedThreats.map(t => t.threatType.replace('_', ' ')).join('\n'),
                        inline: true
                    },
                    {
                        name: 'Risk Level',
                        value: detectedThreats.some(t => t.confidence > 0.8) ? 'HIGH' : 'MEDIUM',
                        inline: true
                    }
                ],
                color: 0xff0000,
                footer: { text: 'If you believe this was an error, please contact a moderator.' }
            };

            try {
                await message.author.send({ embeds: [warningEmbed] });
            } catch {
                // Fallback to channel message
                const warningMsg = await message.channel.send({
                    content: `${message.author}`,
                    embeds: [warningEmbed]
                });
                setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
            }

        } catch (error) {
            this.bot.logger.error(`Failed to send link warning:`, error);
        }
    }

    async notifyModerators(message, detectedThreats) {
        try {
            const config = await this.bot.database.getGuildConfig(message.guildId);
            const logChannel = config.log_channel_id ? 
                message.guild.channels.cache.get(config.log_channel_id) : 
                message.guild.channels.cache.find(c => c.name.includes('log') || c.name.includes('security'));

            if (logChannel) {
                const alertEmbed = {
                    title: '🚨 Malicious Link Detected',
                    description: `**${message.author.tag}** posted a dangerous link`,
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
                            name: 'Threats Detected',
                            value: detectedThreats.map(t => 
                                `• ${t.threatType.replace('_', ' ')} (${(t.confidence * 100).toFixed(0)}%)`
                            ).join('\n'),
                            inline: false
                        },
                        {
                            name: 'Actions Taken',
                            value: '✅ Message deleted\n✅ User warned\n✅ Link added to database',
                            inline: true
                        }
                    ],
                    color: 0xff0000,
                    timestamp: new Date().toISOString()
                };

                await logChannel.send({ embeds: [alertEmbed] });
            }

        } catch (error) {
            this.bot.logger.error(`Failed to notify moderators about malicious link:`, error);
        }
    }

    // Utility method for manual URL scanning
    async scanRecentMessages(guild, hours = 1) {
        try {
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);
            
            const messages = await this.bot.database.all(`
                SELECT * FROM message_logs 
                WHERE guild_id = ? AND created_at > ? AND content LIKE '%http%'
                ORDER BY created_at DESC
            `, [guild.id, since.toISOString()]);

            let scannedCount = 0;
            let threatsFound = 0;

            for (const msgData of messages) {
                const urls = this.extractUrls(msgData.content);
                
                for (const url of urls) {
                    scannedCount++;
                    const result = await this.analyzeUrl(url, guild.id);
                    
                    if (result.isThreat) {
                        threatsFound++;
                        
                        // Log retrospective threat
                        await this.bot.database.logSecurityIncident(guild.id, 'RETROSPECTIVE_THREAT', 'MEDIUM', {
                            messageId: msgData.message_id,
                            userId: msgData.user_id,
                            url: url,
                            threatType: result.threatType
                        });
                    }
                }
            }

            return { scannedCount, threatsFound };

        } catch (error) {
            this.bot.logger.error(`Failed to scan recent messages:`, error);
            return { scannedCount: 0, threatsFound: 0 };
        }
    }
}

module.exports = AntiMaliciousLinks;