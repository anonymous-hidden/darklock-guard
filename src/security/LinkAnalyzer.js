const axios = require('axios');
const { URL } = require('url');
const TTLCache = require('../utils/TTLCache');

class LinkAnalyzer {
    constructor(bot) {
        this.bot = bot;
        this.analysisCache = new TTLCache(60 * 60 * 1000); // 1 hour cache for URL analyses
        this.expandCache = new TTLCache(60 * 60 * 1000); // 1 hour cache for shortener expansions
        this.safeBrowsingCache = new TTLCache(60 * 60 * 1000); // 1 hour cache for Safe Browsing matches

        const safeBrowsingCfg = bot?.config?.get ? bot.config.get('integrations.safeBrowsing') : null;
        this.safeBrowsingApiKey = process.env.SAFE_BROWSING_API_KEY || safeBrowsingCfg?.apiKey || null;
        this.safeBrowsingDefaultEnabled = Boolean(safeBrowsingCfg?.enabled && this.safeBrowsingApiKey);

        this.shortenerDomains = new Set([
            'bit.ly', 'tinyurl.com', 'short.link', 'ow.ly', 'is.gd',
            't.co', 'goo.gl', 'buff.ly', 'adf.ly', 'cutt.ly',
            'tiny.cc', 'rb.gy', 'linktr.ee', 'bitly.com', 'bl.ink',
            'short.io', 'u.to', 'tr.im'
        ]);

        this.ipLoggerDomains = new Set([
            'grabify.link', 'iplogger.org', 'iplogger.com', 'iplogger.ru',
            '2no.co', 'yip.su', 'cutt.us', 'blasze.tk', 'blasze.com',
            'ps3cfw.com', 'bmwforum.co', 'leancoding.co', 'quickmessage.us',
            'spottyfly.com', 'xn--spotfy-4ve.com', 'spötify.com'
        ]);

        this.phishingDomains = new Set([
            'discörd.com', 'discord-giveaway.com', 'discord-nitro.com', 'steamcommnunity.com',
            'steamscommunity.com', 'steamcommuity.com', 'githbub.com', 'paypa1.com',
            'paypal-secure.com', 'minecrafts-servers.com', 'freenitro.com', 'nitrodiscord.com'
        ]);

        this.lookalikeTargets = [
            'discord.com', 'discord.gg', 'discordapp.com',
            'steamcommunity.com', 'github.com', 'paypal.com'
        ];

        this.confusableMap = new Map(Object.entries({
            'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
            'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԍ': 'g', 'ԛ': 'q',
            '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
            '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
        }));

        // Trusted domains that skip analysis entirely
        this.trustedDomains = new Set([
            'discord.com', 'discordapp.com', 'discord.gg', 'discord.media', 'cdn.discordapp.com',
            'youtube.com', 'youtu.be', 'google.com', 'github.com', 'githubusercontent.com',
            'twitter.com', 'x.com', 'reddit.com', 'wikipedia.org', 'imgur.com',
            'twitch.tv', 'spotify.com', 'open.spotify.com', 'tenor.com', 'giphy.com',
            'steamcommunity.com', 'steampowered.com', 'microsoft.com', 'apple.com'
        ]);
    }

    extractUrls(text = '') {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        return text.match(urlRegex) || [];
    }

    normalizeDomain(hostname = '') {
        let domain = hostname.toLowerCase();
        if (domain.startsWith('www.')) domain = domain.slice(4);
        return domain;
    }

    async analyzeMessage(message) {
        const guildId = message.guildId;
        if (!guildId) return { dominated: false, score: 0, urls: [] };

        const config = await this.bot.database.getGuildConfig(guildId).catch(() => ({}));
        const featureEnabled = config.anti_links_enabled !== 0 || config.antilinks_enabled !== 0;
        if (!featureEnabled) {
            return { dominated: false, score: 0, urls: [], disabled: true };
        }

        // Check for bypass roles
        if (message.member && config.antilinks_bypass_roles) {
            const bypassRoles = (config.antilinks_bypass_roles || '').split(',').map(r => r.trim()).filter(Boolean);
            if (bypassRoles.some(roleId => message.member.roles.cache.has(roleId))) {
                return { dominated: false, score: 0, urls: [], bypassed: 'role' };
            }
        }

        // Check for bypass channels
        if (config.antilinks_bypass_channels) {
            const bypassChannels = (config.antilinks_bypass_channels || '').split(',').map(c => c.trim()).filter(Boolean);
            if (bypassChannels.includes(message.channelId)) {
                return { dominated: false, score: 0, urls: [], bypassed: 'channel' };
            }
        }

        const safeBrowsing = this.resolveSafeBrowsingConfig(config);

        const domainLists = this.resolveDomainLists(config);

        const urls = this.extractUrls(message.content || '');
        if (urls.length === 0) return { dominated: false, score: 0, urls: [] };

        const analyses = [];
        let maxScore = 0;
        for (const rawUrl of urls) {
            const result = await this.analyzeUrl(rawUrl, { safeBrowsing, domainLists });
            analyses.push(result);
            maxScore = Math.max(maxScore, result.score || 0);
        }

        const response = await this.applyResponse(message, analyses, maxScore, config);
        return { dominated: response.dominated, score: maxScore, urls: analyses };
    }

    async analyzeUrl(rawUrl, options = {}) {
        if (!rawUrl) return { url: rawUrl, score: 0, reasons: [] };

        const cacheKey = this.buildCacheKey(rawUrl, options);
        const cached = this.analysisCache.get(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        let urlObj;
        try {
            urlObj = new URL(rawUrl);
        } catch (_) {
            return { url: rawUrl, score: 0, reasons: ['invalid_url'] };
        }

        let domain = this.normalizeDomain(urlObj.hostname);
        let path = urlObj.pathname || '/';
        let redirectCount = 0;
        let finalUrl = rawUrl;
        const reasons = [];
        let score = 0;
        let safeBrowsing = null;

        // Shortener handling
        if (this.shortenerDomains.has(domain)) {
            const expansion = await this.expandShortUrl(rawUrl);
            redirectCount = expansion.redirects;
            if (expansion.url) {
                finalUrl = expansion.url;
                try {
                    urlObj = new URL(finalUrl);
                    domain = this.normalizeDomain(urlObj.hostname);
                    path = urlObj.pathname || '/';
                } catch (_) {
                    // Keep original parse if expansion fails silently
                }
            } else {
                score += 40; // Shortener could not be expanded
                reasons.push('shortener_unresolved');
            }
        }

        // Allow/block lists (per-guild overrides)
        const allowedDomains = options.domainLists?.allowed || new Set();
        if (this.trustedDomains.has(domain) || allowedDomains.has(domain)) {
            const reason = this.trustedDomains.has(domain) ? 'trusted_domain' : 'custom_allowed_domain';
            const safeResult = { url: rawUrl, finalUrl, domain, score: 0, reasons: [reason], trusted: true };
            this.analysisCache.set(cacheKey, safeResult, 60 * 60 * 1000);
            return safeResult;
        }

        if (options.domainLists?.blocked?.has(domain)) {
            score += 90;
            reasons.push('custom_blocked_domain');
        }

        if (options.domainLists?.phishing?.has(domain)) {
            score += 85;
            reasons.push('custom_phishing_domain');
        }

        if (options.domainLists?.ipLogger?.has(domain)) {
            score += 90;
            reasons.push('custom_ip_logger');
        }

        // Known IP logger
        if (this.ipLoggerDomains.has(domain)) {
            score += 90;
            reasons.push('ip_logger');
        }

        // Known phishing domain
        if (this.phishingDomains.has(domain)) {
            score += 85;
            reasons.push('phishing_domain');
        }

        // Unicode spoofing
        const spoof = this.detectUnicodeSpoof(domain);
        if (spoof.spoofed) {
            score += 70;
            reasons.push('unicode_spoof');
        }

        // Lookalike domains
        const lookalike = this.detectLookalike(domain);
        if (lookalike.detected) {
            score += 65;
            reasons.push('lookalike_domain');
        }

        // Suspicious paths / payloads
        if (this.isSuspiciousPath(path, urlObj.search)) {
            score += 50;
            reasons.push('suspicious_path');
        }

        // Multiple redirects
        if (redirectCount >= 3) {
            score += 30;
            reasons.push('redirect_chain');
        }

        // Optional Safe Browsing check (opt-in, cached)
        if (options.safeBrowsing?.enabled && options.safeBrowsing.apiKey && finalUrl) {
            safeBrowsing = await this.checkSafeBrowsing(finalUrl, options.safeBrowsing.apiKey);
            if (safeBrowsing.flagged) {
                score = Math.max(score, 95);
                reasons.push('safe_browsing_match');
            }
        }

        score = Math.min(score, 100);

        const result = {
            url: rawUrl,
            finalUrl,
            domain,
            score,
            reasons,
            redirectCount,
            spoof,
            lookalike,
            safeBrowsing
        };

        this.analysisCache.set(cacheKey, result, 60 * 60 * 1000);
        return result;
    }

    async expandShortUrl(url) {
        const cached = this.expandCache.get(url);
        if (cached) return cached;

        try {
            const response = await axios.head(url, {
                timeout: 5000,
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400
            });
            const finalUrl = response.request?.res?.responseUrl || url;
            const redirects = response.request?._redirectable?._redirectCount || 0;
            const payload = { url: finalUrl, redirects };
            this.expandCache.set(url, payload, 60 * 60 * 1000);
            return payload;
        } catch (_) {
            const fallback = { url: null, redirects: 0 };
            this.expandCache.set(url, fallback, 60 * 60 * 1000);
            return fallback;
        }
    }

    detectUnicodeSpoof(domain) {
        let spoofed = false;
        let normalized = domain;
        for (const [char, replacement] of this.confusableMap.entries()) {
            if (domain.includes(char)) {
                spoofed = true;
                normalized = normalized.split(char).join(replacement);
            }
        }
        return { spoofed, normalized };
    }

    detectLookalike(domain) {
        const patterns = [/d[i1]sc[o0]rd/, /payp[a4]l/, /gith[uü]b/, /stea[mrn]/];
        if (patterns.some((p) => p.test(domain))) {
            return { detected: true, target: 'known_brand' };
        }

        for (const target of this.lookalikeTargets) {
            if (domain === target) continue;
            const distance = this.levenshtein(domain, target);
            if (distance <= 2) {
                return { detected: true, target };
            }
        }
        return { detected: false };
    }

    isSuspiciousPath(path, query = '') {
        const lowerPath = (path || '').toLowerCase();
        const lowerQuery = (query || '').toLowerCase();
        if (lowerPath.includes('/api/webhooks')) return true;
        if (/\.(exe|scr|bat|cmd|ps1)$/i.test(lowerPath)) return true;
        if (lowerQuery.includes('token') || lowerQuery.includes('auth')) return true;
        return false;
    }

    levenshtein(a, b) {
        const matrix = Array.from({ length: b.length + 1 }, () => []);
        for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        return matrix[b.length][a.length];
    }

    buildCacheKey(rawUrl, options = {}) {
        const sbFlag = options.safeBrowsing?.enabled ? 'sb1' : 'sb0';
        const domainsKey = options.domainLists?.fingerprint || 'dom0';
        return `${rawUrl}|${sbFlag}|${domainsKey}`;
    }

    resolveDomainLists(config = {}) {
        const allowed = this.parseDomainList(config.antilinks_allowed_domains);
        const blocked = this.parseDomainList(config.antilinks_blocked_domains);
        const phishing = this.parseDomainList(config.antilinks_phishing_domains);
        const ipLogger = this.parseDomainList(config.antilinks_iplogger_domains);

        const hasCustom = allowed.size > 0 || blocked.size > 0 || phishing.size > 0 || ipLogger.size > 0;
        const fingerprint = hasCustom
            ? [
                [...allowed].sort().join(','),
                [...blocked].sort().join(','),
                [...phishing].sort().join(','),
                [...ipLogger].sort().join(',')
            ].join('|')
            : '';

        return { allowed, blocked, phishing, ipLogger, hasCustom, fingerprint };
    }

    parseDomainList(rawValue) {
        if (!rawValue) return new Set();

        let arr = [];
        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        arr = parsed;
                    }
                } catch (_) {
                    arr = trimmed.split(',');
                }
            } else {
                arr = trimmed.split(',');
            }
        } else if (Array.isArray(rawValue)) {
            arr = rawValue;
        }

        return new Set(arr.map((d) => this.normalizeDomain(String(d || '')).trim()).filter(Boolean));
    }

    resolveSafeBrowsingConfig(config = {}) {
        const guildFlag = config.safe_browsing_enabled;
        const guildExplicitDisable = guildFlag === 0 || guildFlag === false || guildFlag === '0';
        const guildExplicitEnable = guildFlag === 1 || guildFlag === true || guildFlag === '1';

        const apiKey = config.safe_browsing_api_key || this.safeBrowsingApiKey;
        const enabled = !!apiKey && (guildExplicitEnable || (!guildExplicitDisable && this.safeBrowsingDefaultEnabled));

        return { enabled, apiKey };
    }

    async checkSafeBrowsing(url, apiKey) {
        const cacheKey = `${apiKey}:${url}`;
        const cached = this.safeBrowsingCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const body = {
            client: { clientId: 'discord-security-bot', clientVersion: '1.0.0' },
            threatInfo: {
                threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                platformTypes: ['ANY_PLATFORM'],
                threatEntryTypes: ['URL'],
                threatEntries: [{ url }]
            }
        };

        try {
            const { data } = await axios.post(
                `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
                body,
                { timeout: 5000 }
            );

            const matches = Array.isArray(data?.matches) ? data.matches : [];
            const result = { flagged: matches.length > 0, matches };
            const ttl = result.flagged ? 60 * 60 * 1000 : 15 * 60 * 1000;
            this.safeBrowsingCache.set(cacheKey, result, ttl);
            return result;
        } catch (err) {
            const fallback = { flagged: false, matches: [], error: true };
            this.safeBrowsingCache.set(cacheKey, fallback, 5 * 60 * 1000);
            this.bot.logger?.warn && this.bot.logger.warn(`LinkAnalyzer: Safe Browsing lookup failed: ${err?.message || err}`);
            return fallback;
        }
    }

    async applyResponse(message, analyses, maxScore, config) {
        const guildId = message.guildId;
        const userId = message.author.id;
        let dominated = false;

        if (maxScore < 30) {
            return { dominated: false };
        }

        // 30-50: log only
        if (maxScore < 50) {
            await this.logIncident(message, analyses, maxScore, 'LOG');
            return { dominated: false };
        }

        // 50-70: delete + warn + notify
        if (maxScore < 70) {
            await this.deleteMessageSafe(message);
            await this.warnUser(message);
            await this.logIncident(message, analyses, maxScore, 'WARN');
            await this.notifyModerators(message, analyses, maxScore, 'WARN', config);
            dominated = true;
            return { dominated };
        }

        // 70+: delete + timeout + notify
        await this.deleteMessageSafe(message);
        await this.warnUser(message);
        if (config.auto_action_enabled && message.member?.moderatable) {
            const durationMs = 30 * 60 * 1000;
            try {
                await message.member.timeout(durationMs, 'LinkAnalyzer: high-risk link');
            } catch (err) {
                this.bot.logger?.warn && this.bot.logger.warn(`LinkAnalyzer timeout failed: ${err?.message || err}`);
            }
        }
        await this.logIncident(message, analyses, maxScore, 'TIMEOUT');
        await this.notifyModerators(message, analyses, maxScore, 'TIMEOUT', config);

        // Emit to dashboard
        if (this.bot.eventEmitter) {
            await this.bot.eventEmitter.emitSecurityEvent(guildId, 'link_threat_detected', {
                executorId: userId,
                targetId: message.id,
                targetType: 'message',
                score: maxScore,
                action: 'TIMEOUT',
                urls: analyses.map(a => ({ url: a.url, score: a.score, reasons: a.reasons }))
            }).catch(() => {});
        }

        dominated = true;
        return { dominated };
    }

    async deleteMessageSafe(message) {
        try {
            await message.delete();
        } catch (err) {
            this.bot.logger?.warn && this.bot.logger.warn(`LinkAnalyzer: failed to delete message ${message.id}: ${err?.message || err}`);
        }
    }

    async warnUser(message) {
        try {
            await message.channel.send({
                content: `${message.author}, your link was removed because it looks unsafe.`
            });
        } catch (err) {
            this.bot.logger?.debug && this.bot.logger.debug(`LinkAnalyzer: failed to warn user: ${err?.message || err}`);
        }
    }

    async logIncident(message, analyses, maxScore, action) {
        try {
            await this.bot.database.logSecurityIncident(
                message.guildId,
                'MALICIOUS_LINK',
                maxScore >= 70 ? 'CRITICAL' : 'HIGH',
                {
                    userId: message.author.id,
                    channelId: message.channelId,
                    score: maxScore,
                    action,
                    urls: analyses
                }
            );
        } catch (err) {
            this.bot.logger?.warn && this.bot.logger.warn(`LinkAnalyzer: failed to log incident: ${err?.message || err}`);
        }
    }

    async notifyModerators(message, analyses, maxScore, action, config) {
        try {
            // Use the new security notifications system if available
            if (this.bot.securityNotifications) {
                const topAnalysis = analyses?.[0] || {};
                const threatType = maxScore >= 70 ? 'phishing' : 'blocked';
                await this.bot.securityNotifications.sendLinkNotification(message.guild, {
                    user: message.author,
                    userId: message.author.id,
                    channelId: message.channelId,
                    link: topAnalysis.finalUrl || topAnalysis.url,
                    threatType,
                    action,
                    domain: topAnalysis.domain || this.extractDomain(topAnalysis.url)
                });
                return;
            }

            // Fallback: original notification (no buttons)
            const logChannel = config?.log_channel_id
                ? message.guild.channels.cache.get(config.log_channel_id)
                : message.guild.channels.cache.find((c) => c.name.includes('log') && c.isTextBased());
            if (!logChannel) return;

            const embed = {
                title: '🚫 Suspicious Link Detected',
                description: `${message.author} posted a risky link.` ,
                color: maxScore >= 70 ? 0xff0000 : 0xffa500,
                fields: [
                    { name: 'Top Score', value: `${maxScore}`, inline: true },
                    { name: 'Action', value: action, inline: true },
                    { name: 'URLs', value: analyses.map((a) => a.finalUrl || a.url).slice(0, 3).join('\n') || 'n/a' }
                ],
                timestamp: new Date().toISOString()
            };

            await logChannel.send({ embeds: [embed] });
        } catch (err) {
            this.bot.logger?.debug && this.bot.logger.debug(`LinkAnalyzer: notify failed: ${err?.message || err}`);
        }
    }

    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return url?.split('/')[2] || 'unknown';
        }
    }
}

module.exports = LinkAnalyzer;
