const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Network Request Logger & Validator
 * Monitors outgoing network requests for suspicious activity
 */
class NetworkSecurityMonitor {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;
        this.whitelist = options.whitelist || [
            'discord.com',
            'discord.gg',
            'discordapp.com',
            'stripe.com',
            'api.stripe.com'
        ];
        this.blacklist = options.blacklist || [];
        this.requestLog = [];
        this.suspiciousPatterns = [];
        this.maxLogEntries = 1000;
    }

    /**
     * Extract domain from URL
     */
    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return null;
        }
    }

    /**
     * Check if domain is whitelisted
     */
    isWhitelisted(domain) {
        return this.whitelist.some(d => domain.includes(d) || domain === d);
    }

    /**
     * Check if domain is blacklisted
     */
    isBlacklisted(domain) {
        return this.blacklist.some(d => domain.includes(d) || domain === d);
    }

    /**
     * Log network request
     */
    logRequest(url, method = 'GET', options = {}) {
        const domain = this.extractDomain(url);

        if (!domain) {
            this.logger.warn('[Network Monitor] Invalid URL:', url);
            return;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            url: url,
            domain: domain,
            method: method,
            whitelisted: this.isWhitelisted(domain),
            blacklisted: this.isBlacklisted(domain),
            suspicious: false,
            flags: []
        };

        // Check for suspicious patterns
        if (this.isBlacklisted(domain)) {
            logEntry.suspicious = true;
            logEntry.flags.push('blacklisted-domain');
        }

        if (!this.isWhitelisted(domain)) {
            logEntry.flags.push('non-whitelisted-domain');
        }

        // Check for data exfiltration patterns
        if (options.body) {
            const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);

            // Detect potential token patterns without referencing actual secrets
            // Discord bot tokens match: base64.base64.base64 pattern
            if (/[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/.test(bodyStr)) {
                logEntry.suspicious = true;
                logEntry.flags.push('possible-token-in-body');
            }

            // Detect common credential patterns without comparing raw secrets
            if (/password["'\s:=]+[^"'\s]{8,}/i.test(bodyStr)) {
                logEntry.suspicious = true;
                logEntry.flags.push('possible-credential-in-body');
            }

            // Check for excessive data transmission
            if (bodyStr.length > 1000000) {
                logEntry.flags.push('large-payload');
            }
        }

        this.requestLog.push(logEntry);

        // Keep only recent entries
        if (this.requestLog.length > this.maxLogEntries) {
            this.requestLog.shift();
        }

        // Log suspicious requests
        if (logEntry.suspicious) {
            this.logger.error('[Network Monitor] 🚨 SUSPICIOUS REQUEST DETECTED:');
            this.logger.error(`   URL: ${url}`);
            this.logger.error(`   Flags: ${logEntry.flags.join(', ')}`);
        }

        return logEntry;
    }

    /**
     * Detect exfiltration attempts
     */
    detectExfiltration() {
        const suspiciousRequests = this.requestLog.filter(r => r.suspicious);

        if (suspiciousRequests.length > 0) {
            this.logger.error('[Network Monitor] ⚠️ Potential data exfiltration detected');
            return suspiciousRequests;
        }

        return [];
    }

    /**
     * Get network report
     */
    getReport() {
        return {
            totalRequests: this.requestLog.length,
            suspiciousRequests: this.requestLog.filter(r => r.suspicious).length,
            whitelistedDomains: this.requestLog.filter(r => r.whitelisted).length,
            nonWhitelistedDomains: this.requestLog.filter(r => !r.whitelisted).length,
            uniqueDomains: [...new Set(this.requestLog.map(r => r.domain))],
            recentRequests: this.requestLog.slice(-20)
        };
    }
}

module.exports = NetworkSecurityMonitor;
