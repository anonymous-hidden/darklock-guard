'use strict';

/**
 * ScanEngine — Pure analysis layer.
 *
 * Rules:
 *  • This class NEVER calls message.delete() or any destructive Discord API.
 *  • It only reads messages and returns a ScanReport.
 *  • DecisionLayer and ActionExecutor handle all user-facing decisions and
 *    any subsequent destructive operations.
 */

const { PermissionFlagsBits } = require('discord.js');

// ── Default whitelist ────────────────────────────────────────────────────────
const DEFAULT_WHITELIST = {
    // File extensions that are NEVER flagged unless they match a malicious hash/pattern
    fileTypes: ['png', 'gif', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mp3'],
    // Roles whose messages are skipped (filled with role IDs by guild config)
    trustedRoleIds: [],
    // Channels whose messages are skipped
    trustedChannelIds: [],
};

// Suspicious file-name patterns (even for whitelisted extensions)
const MALICIOUS_FILE_PATTERNS = [
    /\.exe\.(png|gif|jpg)$/i,   // double-extension trick
    /[^\x00-\x7F]{5,}/,         // heavy non-ASCII in filename (rare legit)
];

// Spam detection heuristics
const SPAM_PHRASES = [
    'free nitro', 'click here', 'dm me', 'check dm',
    'free money', 'get rich quick', 'discord.gg/', 'steamcommunity.com/tradeoffe',
];

class ScanEngine {
    /**
     * @param {object} bot  The bot instance (for logger + sub-systems)
     */
    constructor(bot) {
        this.bot = bot;
        this._running = false;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Scan an entire guild.  Returns a ScanReport — never deletes anything.
     *
     * @param {import('discord.js').Guild} guild
     * @param {object} [opts]
     * @param {number} [opts.maxMessagesPerChannel=100]
     * @param {object} [opts.whitelist]     Override the default whitelist
     * @returns {Promise<ScanReport>}
     */
    async scan(guild, opts = {}) {
        if (this._running) {
            throw new Error('A scan is already running for this engine instance.');
        }
        this._running = true;

        const startTime = Date.now();
        const whitelist  = this._mergeWhitelist(opts.whitelist);
        const maxPerCh   = opts.maxMessagesPerChannel ?? 100;
        const config     = await this._loadConfig(guild.id);

        /** @type {FlaggedItem[]} */
        const flaggedItems = [];
        let scannedMessages = 0;
        let scannedChannels = 0;

        try {
            const channels = guild.channels.cache.filter(ch =>
                ch.type === 0 &&
                ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ViewChannel) &&
                ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ReadMessageHistory) &&
                !whitelist.trustedChannelIds.includes(ch.id)
            );

            this.bot.logger?.info(`[ScanEngine] Scanning ${channels.size} channels in "${guild.name}"`);

            for (const [, channel] of channels) {
                const items = await this._scanChannel(channel, maxPerCh, config, whitelist);
                flaggedItems.push(...items);
                scannedMessages += items._scannedCount ?? 0;
                scannedChannels++;
            }
        } finally {
            this._running = false;
        }

        const duration = Date.now() - startTime;

        /** @type {ScanReport} */
        const report = {
            guildId:  guild.id,
            guildName: guild.name,
            flaggedItems,
            stats: {
                scannedChannels,
                scannedMessages,
                duration,
                breakdown: this._breakdown(flaggedItems),
                riskLevel: this._riskLevel(flaggedItems),
            },
            whitelist,
            config,
            timestamp: new Date().toISOString(),
        };

        return report;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Scan one channel.  Returns an array of FlaggedItem with an
     * extra ._scannedCount property attached to the array itself.
     */
    async _scanChannel(channel, maxMessages, config, whitelist) {
        const items = [];
        items._scannedCount = 0;
        let lastId;
        let fetched = 0;

        while (fetched < maxMessages) {
            const limit   = Math.min(100, maxMessages - fetched);
            const fetchOpts = { limit };
            if (lastId) fetchOpts.before = lastId;

            let batch;
            try {
                batch = await channel.messages.fetch(fetchOpts);
            } catch {
                break;
            }
            if (!batch.size) break;

            for (const [, msg] of batch) {
                if (msg.author?.bot) continue;

                // Skip messages from trusted roles
                if (msg.member && whitelist.trustedRoleIds.some(rid => msg.member.roles.cache.has(rid))) {
                    continue;
                }

                const msgItems = await this._analyzeMessage(msg, config, whitelist);
                items.push(...msgItems);
                items._scannedCount++;
                fetched++;
            }

            lastId = batch.last()?.id;
            // Brief rate-limit pause
            await new Promise(r => setTimeout(r, 200));
        }

        return items;
    }

    /**
     * Analyse a single message and return all FlaggedItems found.
     * NEVER calls .delete() or any mutating API.
     */
    async _analyzeMessage(msg, config, whitelist) {
        const items = [];

        // ── Malicious links ──────────────────────────────────────────────────
        if (config.scanLinks && this.bot.antiMaliciousLinks) {
            try {
                const r = await this.bot.antiMaliciousLinks.checkMessage(msg);
                if (r?.isBlocked) {
                    items.push(this._item(msg, 'malicious_link', r.reason ?? 'Malicious URL detected', { url: r.url }));
                }
            } catch { /* non-fatal */ }
        }

        // ── Phishing ─────────────────────────────────────────────────────────
        if (config.scanPhishing && this.bot.antiPhishing) {
            try {
                const r = await this.bot.antiPhishing.checkMessage(msg, { scanMode: true });
                if (r) {
                    items.push(this._item(msg, 'phishing', 'Phishing attempt detected'));
                }
            } catch { /* non-fatal */ }
        }

        // ── Spam ─────────────────────────────────────────────────────────────
        if (config.scanSpam && msg.content) {
            const reason = this._detectSpam(msg.content);
            if (reason) {
                items.push(this._item(msg, 'spam', reason));
            }
        }

        // ── Toxicity ─────────────────────────────────────────────────────────
        if (config.scanToxicity && this.bot.toxicityFilter) {
            try {
                const r = await this.bot.toxicityFilter.checkMessage(msg);
                if (r?.isToxic) {
                    items.push(this._item(msg, 'toxic_content', `Toxicity score: ${r.score ?? '?'}`));
                }
            } catch { /* non-fatal */ }
        }

        // ── Attachments / files ──────────────────────────────────────────────
        for (const att of msg.attachments.values()) {
            const ext = (att.name ?? '').split('.').pop()?.toLowerCase();
            const isSafeType = whitelist.fileTypes.includes(ext);

            if (!isSafeType) {
                // Non-whitelisted extension → always flag
                items.push(this._item(msg, 'suspicious_file', `Non-whitelisted file type: .${ext}`, { filename: att.name, url: att.url }));
            } else if (MALICIOUS_FILE_PATTERNS.some(p => p.test(att.name ?? ''))) {
                // Whitelisted extension but suspicious filename
                items.push(this._item(msg, 'suspicious_file', `Suspicious filename for .${ext} attachment`, { filename: att.name, url: att.url }));
            }
            // Otherwise: whitelisted type + clean name → not flagged
        }

        return items;
    }

    /** Build a FlaggedItem object */
    _item(msg, type, reason, extra = {}) {
        return {
            type,
            reason,
            messageId:   msg.id,
            channelId:   msg.channel.id,
            channelName: msg.channel.name,
            userId:      msg.author.id,
            username:    msg.author.username,
            content:     msg.content?.substring(0, 300) ?? '',
            timestamp:   msg.createdAt.toISOString(),
            ...extra,
        };
    }

    /** Detect spam and return a reason string or null */
    _detectSpam(content) {
        const lower = content.toLowerCase();
        const capsRatio = content.length > 10
            ? (content.match(/[A-Z]/g) ?? []).length / content.length
            : 0;

        if (capsRatio > 0.7)                              return 'Excessive capital letters';
        if ((content.match(/[^\x00-\x7F]/gu) ?? []).length > 15) return 'Excessive emoji/special characters';
        if (/(.)\1{10,}/.test(content))                   return 'Repeated characters';

        const hit = SPAM_PHRASES.find(p => lower.includes(p));
        if (hit) return `Spam phrase: "${hit}"`;

        return null;
    }

    /** Breakdown flagged items by type */
    _breakdown(items) {
        const counts = {};
        for (const item of items) {
            counts[item.type] = (counts[item.type] ?? 0) + 1;
        }
        return counts;
    }

    /** Compute overall risk level from flagged item count + types */
    _riskLevel(items) {
        const high = ['malicious_link', 'phishing'];
        const hasHigh = items.some(i => high.includes(i.type));
        if (hasHigh || items.length >= 20) return 'high';
        if (items.length >= 5)             return 'medium';
        if (items.length > 0)              return 'low';
        return 'clean';
    }

    /** Merge caller-supplied whitelist with defaults */
    _mergeWhitelist(override) {
        return {
            fileTypes:         override?.fileTypes         ?? [...DEFAULT_WHITELIST.fileTypes],
            trustedRoleIds:    override?.trustedRoleIds    ?? [...DEFAULT_WHITELIST.trustedRoleIds],
            trustedChannelIds: override?.trustedChannelIds ?? [...DEFAULT_WHITELIST.trustedChannelIds],
        };
    }

    /** Load relevant config from DB, fallback to safe defaults */
    async _loadConfig(guildId) {
        try {
            const row = await this.bot.database?.get(
                'SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]
            );
            return {
                scanLinks:    row?.antiphishing_enabled !== 0,
                scanPhishing: row?.antiphishing_enabled !== 0,
                scanSpam:     row?.antispam_enabled     !== 0,
                scanToxicity: true,
            };
        } catch {
            return { scanLinks: true, scanPhishing: true, scanSpam: true, scanToxicity: true };
        }
    }
}

/**
 * @typedef {object} FlaggedItem
 * @property {string} type         malicious_link | phishing | spam | toxic_content | suspicious_file
 * @property {string} reason       Human-readable reason
 * @property {string} messageId
 * @property {string} channelId
 * @property {string} channelName
 * @property {string} userId
 * @property {string} username
 * @property {string} content      First 300 chars of message content
 * @property {string} timestamp
 * @property {string} [url]        For links / attachments
 * @property {string} [filename]   For attachments
 */

/**
 * @typedef {object} ScanReport
 * @property {string}        guildId
 * @property {string}        guildName
 * @property {FlaggedItem[]} flaggedItems
 * @property {object}        stats
 * @property {object}        whitelist
 * @property {object}        config
 * @property {string}        timestamp
 */

module.exports = ScanEngine;
