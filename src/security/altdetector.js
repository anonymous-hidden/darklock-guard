/**
 * Alt Account Detection System
 * Detects potential alt accounts of banned users based on patterns
 * Factors: Account age, join timing, avatar, username patterns, behavior
 */

const { EmbedBuilder } = require('discord.js');

class AltDetector {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        // Cache of recent joins for pattern analysis
        this.recentJoins = new Map(); // guildId -> [{ userId, timestamp, data }]
        this.suspiciousPatterns = new Map(); // guildId -> Map of pattern -> count
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('AltDetector system initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Alt detection config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS alt_detector_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        log_channel_id TEXT,
                        min_account_age_days INTEGER DEFAULT 7,
                        auto_action TEXT DEFAULT 'alert',
                        quarantine_role_id TEXT,
                        check_avatar_hash INTEGER DEFAULT 1,
                        check_username_patterns INTEGER DEFAULT 1,
                        check_join_timing INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Store fingerprints of banned users
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS banned_fingerprints (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        original_user_id TEXT NOT NULL,
                        username_pattern TEXT,
                        display_name_pattern TEXT,
                        avatar_hash TEXT,
                        account_created_range TEXT,
                        ban_reason TEXT,
                        banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, original_user_id)
                    )
                `);

                // Track detected alts
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS detected_alts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        alt_user_id TEXT NOT NULL,
                        linked_to_user_id TEXT NOT NULL,
                        confidence_score REAL DEFAULT 0,
                        detection_reasons TEXT,
                        action_taken TEXT,
                        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        reviewed INTEGER DEFAULT 0,
                        reviewer_id TEXT,
                        UNIQUE(guild_id, alt_user_id, linked_to_user_id)
                    )
                `);

                // User behavior patterns for fingerprinting
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS user_behavior_patterns (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        typing_speed_avg REAL,
                        message_length_avg REAL,
                        active_hours TEXT,
                        common_channels TEXT,
                        emoji_usage TEXT,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, user_id)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_banned_fingerprints_guild ON banned_fingerprints(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_detected_alts_guild ON detected_alts(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_detected_alts_alt ON detected_alts(alt_user_id)`);
            });
        });
    }

    // Get config for a guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM alt_detector_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Enable/disable detection
    async setEnabled(guildId, enabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO alt_detector_config (guild_id, enabled)
                 VALUES (?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET enabled = ?`,
                [guildId, enabled ? 1 : 0, enabled ? 1 : 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update config
    async updateConfig(guildId, settings) {
        const fields = [];
        const values = [];

        for (const [key, value] of Object.entries(settings)) {
            if (['log_channel_id', 'min_account_age_days', 'auto_action', 'quarantine_role_id',
                 'check_avatar_hash', 'check_username_patterns', 'check_join_timing'].includes(key)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (fields.length === 0) return false;

        values.push(guildId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE alt_detector_config SET ${fields.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Store fingerprint when user is banned
    async storeBannedFingerprint(guildId, user, reason = null) {
        const usernamePattern = this.extractPattern(user.username);
        const displayNamePattern = user.displayName ? this.extractPattern(user.displayName) : null;
        const avatarHash = user.avatar || null;
        
        // Store account creation date range (within same day)
        const createdDate = new Date(user.createdTimestamp);
        const dateRange = createdDate.toISOString().split('T')[0];

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO banned_fingerprints 
                 (guild_id, original_user_id, username_pattern, display_name_pattern, avatar_hash, account_created_range, ban_reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, original_user_id) DO UPDATE SET
                    username_pattern = ?,
                    display_name_pattern = ?,
                    avatar_hash = ?,
                    account_created_range = ?,
                    ban_reason = ?,
                    banned_at = CURRENT_TIMESTAMP`,
                [guildId, user.id, usernamePattern, displayNamePattern, avatarHash, dateRange, reason,
                 usernamePattern, displayNamePattern, avatarHash, dateRange, reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Extract pattern from username (letters only, lowercased)
    extractPattern(username) {
        if (!username) return null;
        // Remove numbers and special chars, keep letters
        const letters = username.toLowerCase().replace(/[^a-z]/g, '');
        // Also store common number patterns
        const numbers = username.replace(/[^0-9]/g, '');
        return `${letters}|${numbers}`;
    }

    // Calculate pattern similarity
    calculatePatternSimilarity(pattern1, pattern2) {
        if (!pattern1 || !pattern2) return 0;
        
        const [letters1, nums1] = pattern1.split('|');
        const [letters2, nums2] = pattern2.split('|');

        let score = 0;

        // Letter pattern similarity (Levenshtein-like)
        if (letters1 && letters2) {
            const maxLen = Math.max(letters1.length, letters2.length);
            if (maxLen > 0) {
                let matches = 0;
                for (let i = 0; i < Math.min(letters1.length, letters2.length); i++) {
                    if (letters1[i] === letters2[i]) matches++;
                }
                score += (matches / maxLen) * 0.5;
            }
            
            // Check for substring match
            if (letters1.includes(letters2) || letters2.includes(letters1)) {
                score += 0.2;
            }
        }

        // Number pattern similarity
        if (nums1 && nums2 && nums1 === nums2) {
            score += 0.3;
        }

        return Math.min(score, 1);
    }

    // Check if a new member might be an alt
    async checkNewMember(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config?.enabled) return null;

        const scores = [];
        const reasons = [];

        // 1. Account age check
        const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        if (accountAgeDays < config.min_account_age_days) {
            scores.push(0.3);
            reasons.push(`New account (${accountAgeDays} days old)`);
        }

        // 2. Get banned fingerprints
        const fingerprints = await this.getBannedFingerprints(member.guild.id);
        
        for (const fp of fingerprints) {
            let matchScore = 0;
            const matchReasons = [];

            // Avatar hash match
            if (config.check_avatar_hash && fp.avatar_hash && member.user.avatar === fp.avatar_hash) {
                matchScore += 0.4;
                matchReasons.push('Same avatar as banned user');
            }

            // Username pattern match
            if (config.check_username_patterns) {
                const userPattern = this.extractPattern(member.user.username);
                const similarity = this.calculatePatternSimilarity(userPattern, fp.username_pattern);
                if (similarity > 0.5) {
                    matchScore += similarity * 0.3;
                    matchReasons.push(`Similar username pattern (${Math.round(similarity * 100)}% match)`);
                }

                // Display name check
                if (member.displayName && fp.display_name_pattern) {
                    const displaySimilarity = this.calculatePatternSimilarity(
                        this.extractPattern(member.displayName),
                        fp.display_name_pattern
                    );
                    if (displaySimilarity > 0.5) {
                        matchScore += displaySimilarity * 0.2;
                        matchReasons.push(`Similar display name pattern`);
                    }
                }
            }

            // Account creation date proximity
            if (fp.account_created_range) {
                const memberCreated = new Date(member.user.createdTimestamp).toISOString().split('T')[0];
                if (memberCreated === fp.account_created_range) {
                    matchScore += 0.2;
                    matchReasons.push('Created same day as banned account');
                }
            }

            if (matchScore > 0 && matchReasons.length > 0) {
                scores.push(matchScore);
                reasons.push(`Matches banned user <@${fp.original_user_id}>: ${matchReasons.join(', ')}`);
            }
        }

        // 3. Join timing analysis
        if (config.check_join_timing) {
            const recentJoins = this.recentJoins.get(member.guild.id) || [];
            const veryRecent = recentJoins.filter(j => Date.now() - j.timestamp < 60000); // Last minute
            
            if (veryRecent.length >= 3) {
                scores.push(0.2);
                reasons.push(`Joined with ${veryRecent.length} others in last minute`);
            }
        }

        // Track this join
        if (!this.recentJoins.has(member.guild.id)) {
            this.recentJoins.set(member.guild.id, []);
        }
        const guildJoins = this.recentJoins.get(member.guild.id);
        guildJoins.push({
            userId: member.id,
            timestamp: Date.now(),
            data: {
                username: member.user.username,
                avatar: member.user.avatar,
                createdAt: member.user.createdTimestamp
            }
        });
        // Keep only last 10 minutes
        this.recentJoins.set(
            member.guild.id,
            guildJoins.filter(j => Date.now() - j.timestamp < 600000)
        );

        // Calculate final confidence score
        const confidence = scores.length > 0 ? 
            Math.min(scores.reduce((a, b) => a + b, 0), 1) : 0;

        if (confidence >= 0.3) { // Threshold for alert
            await this.handleSuspiciousJoin(member, confidence, reasons, config);
            return { confidence, reasons, flagged: true };
        }

        return { confidence, reasons, flagged: false };
    }

    // Get all banned fingerprints for a guild
    async getBannedFingerprints(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM banned_fingerprints WHERE guild_id = ?',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Handle suspicious join
    async handleSuspiciousJoin(member, confidence, reasons, config) {
        // Log detection
        await this.logDetection(member.guild.id, member.id, reasons, confidence);

        // Take action based on config
        const action = config.auto_action || 'alert';

        switch (action) {
            case 'quarantine':
                if (config.quarantine_role_id) {
                    try {
                        await member.roles.add(config.quarantine_role_id, 'Alt account detected');
                    } catch (e) {
                        this.bot.logger.error('Failed to add quarantine role:', e);
                    }
                }
                break;
            case 'kick':
                try {
                    await member.kick('Suspected alt account');
                } catch (e) {
                    this.bot.logger.error('Failed to kick suspected alt:', e);
                }
                break;
            case 'ban':
                try {
                    await member.ban({ reason: 'Suspected alt account', deleteMessageDays: 1 });
                } catch (e) {
                    this.bot.logger.error('Failed to ban suspected alt:', e);
                }
                break;
            // 'alert' - just log, no action
        }

        // Send alert to log channel
        await this.sendAlert(member, confidence, reasons, action, config);
    }

    // Log detection to database
    async logDetection(guildId, userId, reasons, confidence, linkedTo = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO detected_alts 
                 (guild_id, alt_user_id, linked_to_user_id, confidence_score, detection_reasons, action_taken)
                 VALUES (?, ?, ?, ?, ?, 'alert')
                 ON CONFLICT(guild_id, alt_user_id, linked_to_user_id) DO UPDATE SET
                    confidence_score = ?,
                    detection_reasons = ?,
                    detected_at = CURRENT_TIMESTAMP`,
                [guildId, userId, linkedTo || 'unknown', confidence, JSON.stringify(reasons),
                 confidence, JSON.stringify(reasons)],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Send alert to log channel
    async sendAlert(member, confidence, reasons, action, config) {
        if (!config?.log_channel_id) return;

        const channel = await member.guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const actionEmoji = {
            'alert': '⚠️',
            'quarantine': '🔒',
            'kick': '👢',
            'ban': '🔨'
        };

        const embed = new EmbedBuilder()
            .setTitle(`${actionEmoji[action] || '⚠️'} Potential Alt Account Detected`)
            .setColor(confidence >= 0.7 ? 0xFF0000 : confidence >= 0.5 ? 0xFFA500 : 0xFFFF00)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: `${member.user.tag}\n${member.user.id}`, inline: true },
                { name: 'Confidence', value: `${Math.round(confidence * 100)}%`, inline: true },
                { name: 'Action Taken', value: action.charAt(0).toUpperCase() + action.slice(1), inline: true },
                { name: 'Account Age', value: `${Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24))} days`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setDescription(`**Detection Reasons:**\n${reasons.map(r => `• ${r}`).join('\n')}`)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Get detected alts for a guild
    async getDetectedAlts(guildId, limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM detected_alts WHERE guild_id = ? ORDER BY detected_at DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Mark detection as reviewed
    async markReviewed(guildId, altUserId, reviewerId, isAlt = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE detected_alts SET reviewed = 1, reviewer_id = ? WHERE guild_id = ? AND alt_user_id = ?`,
                [reviewerId, guildId, altUserId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Manual link two accounts
    async linkAccounts(guildId, userId1, userId2, linkedBy) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO detected_alts 
                 (guild_id, alt_user_id, linked_to_user_id, confidence_score, detection_reasons, action_taken, reviewed, reviewer_id)
                 VALUES (?, ?, ?, 1.0, '["Manually linked"]', 'manual', 1, ?)`,
                [guildId, userId1, userId2, linkedBy],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get all known alts of a user
    async getKnownAlts(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM detected_alts 
                 WHERE guild_id = ? AND (alt_user_id = ? OR linked_to_user_id = ?)
                 AND reviewed = 1`,
                [guildId, userId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Remove fingerprint (e.g., when unbanned)
    async removeFingerprint(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM banned_fingerprints WHERE guild_id = ? AND original_user_id = ?`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Store behavior pattern for fingerprinting
    async updateBehaviorPattern(guildId, userId, patterns) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_behavior_patterns 
                 (guild_id, user_id, typing_speed_avg, message_length_avg, active_hours, common_channels, emoji_usage)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    typing_speed_avg = ?,
                    message_length_avg = ?,
                    active_hours = ?,
                    common_channels = ?,
                    emoji_usage = ?,
                    updated_at = CURRENT_TIMESTAMP`,
                [guildId, userId, 
                 patterns.typingSpeed, patterns.messageLength, 
                 JSON.stringify(patterns.activeHours || []), 
                 JSON.stringify(patterns.channels || []),
                 JSON.stringify(patterns.emojis || []),
                 patterns.typingSpeed, patterns.messageLength,
                 JSON.stringify(patterns.activeHours || []),
                 JSON.stringify(patterns.channels || []),
                 JSON.stringify(patterns.emojis || [])],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }
}

module.exports = AltDetector;
