const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Advanced Link Detection & Analysis System
 * Detects: Unicode spoofs, lookalike domains, redirects, IP loggers, token grabbers
 */
class AdvancedLinkDetector {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        
        // Known malicious patterns
        this.ipLoggerDomains = [
            'grabify.link', 'iplogger.org', 'iplogger.com', 'iplogger.ru',
            '2no.co', 'yip.su', 'cutt.us', 'blasze.tk', 'blasze.com',
            'ps3cfw.com', 'bmwforum.co', 'leancoding.co', 'quickmessage.us',
            'spottyfly.com', 'spötify.com', 'discörd.com', 'minecräft.com'
        ];

        this.tokenGrabberIndicators = [
            '/api/webhooks/', 'discord.com/api/webhooks',
            'token', 'stealer', 'grabber', 'rat'
        ];

        this.urlShorteners = [
            'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 
            'buff.ly', 'is.gd', 'bl.ink', 'short.io', 'cutt.ly',
            'rb.gy', 'tiny.cc', 'u.to', 'tr.im'
        ];

        this.legitimateDomains = [
            'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net',
            'github.com', 'youtube.com', 'youtu.be', 'google.com',
            'twitter.com', 'reddit.com', 'imgur.com', 'gyazo.com',
            'tenor.com', 'giphy.com', 'steamcommunity.com'
        ];

        // Lookalike character mappings
        this.lookalikeMappings = {
            'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
            'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԍ': 'g', 'ԛ': 'q',
            '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', 
            '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
        };
    }

    /**
     * Analyze a URL for all threat types
     */
    async analyzeURL(url, guildId = null) {
        const analysis = {
            url,
            isSafe: true,
            threatScore: 0,
            threats: [],
            details: {}
        };

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname.toLowerCase();

            // Check if whitelisted
            if (this.legitimateDomains.some(d => domain.includes(d))) {
                const dbEntry = await this.getOrCreateURLAnalysis(url, domain);
                if (dbEntry.whitelisted) {
                    return { ...analysis, isSafe: true, threatScore: 0 };
                }
            }

            // Run all detection methods
            const checks = await Promise.all([
                this.checkIPLogger(domain),
                this.checkTokenGrabber(url, urlObj),
                this.checkUnicodeSpoofing(domain),
                this.checkLookalikeD omain(domain),
                this.checkURLShortener(domain),
                this.checkRedirectChain(url)
            ]);

            // Aggregate results
            checks.forEach(check => {
                if (check.detected) {
                    analysis.threats.push(check.type);
                    analysis.threatScore += check.score;
                    analysis.details[check.type] = check.details;
                }
            });

            analysis.threatScore = Math.min(analysis.threatScore, 100);
            analysis.isSafe = analysis.threatScore < 60;

            // Store analysis in database
            await this.storeURLAnalysis(url, domain, analysis);

            return analysis;
        } catch (error) {
            console.error('URL analysis error:', error);
            return { ...analysis, error: error.message };
        }
    }

    /**
     * Check if domain is a known IP logger
     */
    async checkIPLogger(domain) {
        const detected = this.ipLoggerDomains.some(ipLogger => 
            domain.includes(ipLogger.toLowerCase())
        );

        return {
            detected,
            type: 'ip_logger',
            score: detected ? 80 : 0,
            details: detected ? 'Known IP logging service' : null
        };
    }

    /**
     * Check for token grabber indicators
     */
    async checkTokenGrabber(url, urlObj) {
        const fullURL = url.toLowerCase();
        const detected = this.tokenGrabberIndicators.some(indicator => 
            fullURL.includes(indicator.toLowerCase())
        );

        // Additional check: suspicious Discord webhook
        const isDiscordWebhook = fullURL.includes('discord.com/api/webhooks/');
        const hasEmbeddedFile = urlObj.pathname.includes('.exe') || 
                                 urlObj.pathname.includes('.scr') ||
                                 urlObj.pathname.includes('.bat');

        return {
            detected: detected || hasEmbeddedFile,
            type: 'token_grabber',
            score: detected ? 95 : (hasEmbeddedFile ? 70 : 0),
            details: detected ? 'Potential token stealer detected' : null
        };
    }

    /**
     * Check for Unicode spoofing
     */
    async checkUnicodeSpoofing(domain) {
        let hasSpoofed = false;
        let normalizedDomain = domain;

        // Check each character
        for (const [unicode, latin] of Object.entries(this.lookalikeMappings)) {
            if (domain.includes(unicode)) {
                hasSpoofed = true;
                normalizedDomain = normalizedDomain.replace(new RegExp(unicode, 'g'), latin);
            }
        }

        // Check if normalized domain matches a legitimate domain
        const isSpoofingLegit = hasSpoofed && this.legitimateDomains.some(d => 
            normalizedDomain.includes(d)
        );

        return {
            detected: hasSpoofed,
            type: 'unicode_spoof',
            score: isSpoofingLegit ? 90 : (hasSpoofed ? 60 : 0),
            details: hasSpoofed ? {
                original: domain,
                normalized: normalizedDomain,
                spoofingLegitimate: isSpoofingLegit
            } : null
        };
    }

    /**
     * Check for lookalike domains
     */
    async checkLookalikeD omain(domain) {
        const lookalikePatterns = [
            { real: 'discord.com', fakes: ['discordapp.com', 'discörd.com', 'disc0rd.com', 'discоrd.com', 'disсord.com'] },
            { real: 'steam.com', fakes: ['steаm.com', 'steamcommunity.ru', 'steamcоmmunity.com'] },
            { real: 'github.com', fakes: ['githüb.com', 'gith ub.com', 'github.io'] },
            { real: 'paypal.com', fakes: ['paypаl.com', 'paypa1.com', 'paypal-secure.com'] }
        ];

        for (const pattern of lookalikePatterns) {
            // Skip if it's the real domain
            if (domain.includes(pattern.real)) continue;

            for (const fake of pattern.fakes) {
                if (domain.includes(fake)) {
                    return {
                        detected: true,
                        type: 'lookalike_domain',
                        score: 85,
                        details: {
                            attempting: pattern.real,
                            using: fake
                        }
                    };
                }
            }

            // Check Levenshtein distance
            const distance = this.levenshteinDistance(domain, pattern.real);
            if (distance <= 2 && domain !== pattern.real) {
                return {
                    detected: true,
                    type: 'lookalike_domain',
                    score: 75,
                    details: {
                        attempting: pattern.real,
                        similarity: Math.round((1 - distance / pattern.real.length) * 100) + '%'
                    }
                };
            }
        }

        return { detected: false, type: 'lookalike_domain', score: 0, details: null };
    }

    /**
     * Check if URL shortener and expand it
     */
    async checkURLShortener(domain) {
        const isShortener = this.urlShorteners.some(shortener => 
            domain.includes(shortener)
        );

        return {
            detected: isShortener,
            type: 'url_shortener',
            score: isShortener ? 30 : 0,
            details: isShortener ? 'URL shortener - destination unknown' : null
        };
    }

    /**
     * Check redirect chain (max 5 hops)
     */
    async checkRedirectChain(url, maxHops = 5) {
        const chain = [];
        let currentURL = url;
        let redirectCount = 0;

        try {
            for (let i = 0; i < maxHops; i++) {
                const redirect = await this.followRedirect(currentURL);
                if (!redirect || redirect === currentURL) break;

                chain.push(redirect);
                currentURL = redirect;
                redirectCount++;
            }

            const hasMultipleRedirects = redirectCount > 2;

            return {
                detected: hasMultipleRedirects,
                type: 'redirect_chain',
                score: hasMultipleRedirects ? 50 : 0,
                details: hasMultipleRedirects ? {
                    redirectCount,
                    chain: chain.slice(0, 3)
                } : null
            };
        } catch (error) {
            return { detected: false, type: 'redirect_chain', score: 0, details: null };
        }
    }

    /**
     * Follow a single redirect
     */
    followRedirect(url) {
        return new Promise((resolve) => {
            try {
                const urlObj = new URL(url);
                const protocol = urlObj.protocol === 'https:' ? https : http;

                const req = protocol.request(url, {
                    method: 'HEAD',
                    timeout: 3000
                }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        resolve(res.headers.location);
                    } else {
                        resolve(null);
                    }
                });

                req.on('error', () => resolve(null));
                req.on('timeout', () => {
                    req.destroy();
                    resolve(null);
                });
                req.end();
            } catch (error) {
                resolve(null);
            }
        });
    }

    /**
     * Store URL analysis in database
     */
    async storeURLAnalysis(url, domain, analysis) {
        await this.db.run(`
            INSERT OR REPLACE INTO link_analysis (
                url, domain, is_spoofed, is_lookalike, is_ip_logger,
                is_token_grabber, is_shortener, threat_score, threat_types,
                expanded_url, redirect_chain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            url,
            domain,
            analysis.threats.includes('unicode_spoof') ? 1 : 0,
            analysis.threats.includes('lookalike_domain') ? 1 : 0,
            analysis.threats.includes('ip_logger') ? 1 : 0,
            analysis.threats.includes('token_grabber') ? 1 : 0,
            analysis.threats.includes('url_shortener') ? 1 : 0,
            analysis.threatScore,
            JSON.stringify(analysis.threats),
            analysis.details.redirect_chain?.chain?.[analysis.details.redirect_chain.chain.length - 1] || null,
            JSON.stringify(analysis.details.redirect_chain?.chain || [])
        ]);
    }

    /**
     * Get or create URL analysis from DB (cache)
     */
    async getOrCreateURLAnalysis(url, domain) {
        const existing = await this.db.get(`
            SELECT * FROM link_analysis
            WHERE url = ? AND last_checked > datetime('now', '-7 days')
        `, [url]);

        return existing || { url, domain, whitelisted: false };
    }

    /**
     * Whitelist a URL
     */
    async whitelistURL(url) {
        await this.db.run(`
            UPDATE link_analysis SET whitelisted = 1 WHERE url = ?
        `, [url]);
    }

    /**
     * Blacklist a URL
     */
    async blacklistURL(url) {
        await this.db.run(`
            UPDATE link_analysis SET blacklisted = 1, threat_score = 100 WHERE url = ?
        `, [url]);
    }

    /**
     * Calculate Levenshtein distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Extract all URLs from text
     */
    extractURLs(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        return text.match(urlRegex) || [];
    }

    /**
     * Scan message for malicious links
     */
    async scanMessage(message) {
        const urls = this.extractURLs(message.content);
        if (urls.length === 0) return { safe: true, urls: [] };

        const results = [];
        for (const url of urls) {
            const analysis = await this.analyzeURL(url, message.guild.id);
            results.push({ url, analysis });
        }

        const hasDangerousLinks = results.some(r => !r.analysis.isSafe);
        const maxThreatScore = Math.max(...results.map(r => r.analysis.threatScore));

        return {
            safe: !hasDangerousLinks,
            maxThreatScore,
            urls: results,
            shouldDelete: maxThreatScore > 80,
            shouldWarn: maxThreatScore > 60
        };
    }
}

module.exports = AdvancedLinkDetector;
