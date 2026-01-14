/**
 * Trust Score System
 * Calculates user trustworthiness based on behavior, not gamification
 * 
 * Score Range: 0-100
 *   0-25:  Untrusted (new accounts, flagged users)
 *   26-50: Low trust (limited history)
 *   51-75: Normal (established members)
 *   76-100: High trust (verified, long tenure, no incidents)
 * 
 * Key Principles:
 * - NO user-triggered increments (no gaming the system)
 * - Calculated from moderation history and behavior
 * - Used for automation: bypass thresholds, risk flags, verification
 */

class TrustScore {
    constructor(bot) {
        this.bot = bot;
        
        // Score thresholds for automated decisions
        this.thresholds = {
            UNTRUSTED: 25,      // Below this = high scrutiny
            LOW_TRUST: 50,      // Below this = standard checks
            NORMAL: 75,         // Below this = trusted member
            HIGH_TRUST: 100     // Above NORMAL = bypass some checks
        };

        // Factor weights (sum to ~100 for the positive side)
        this.weights = {
            // Positive factors (add to score)
            accountAge: 15,        // Max +15 for 1+ year accounts
            membershipDuration: 15, // Max +15 for long-term members
            verification: 10,       // +10 if verified
            roles: 10,             // Max +10 based on role count/trust roles
            
            // Negative factors (subtract from score)
            warnings: 30,          // Max -30 based on warning count
            strikes: 40,           // Max -40 based on strike count
            spamFlags: 20,         // Max -20 based on spam incidents
            recentIncidents: 25    // Max -25 based on recent issues
        };
    }

    /**
     * Calculate trust score for a user in a guild
     * @param {string} guildId 
     * @param {string} userId 
     * @returns {Promise<{score: number, factors: object, level: string}>}
     */
    async calculateScore(guildId, userId) {
        const factors = await this.gatherFactors(guildId, userId);
        let score = 50; // Base score

        // Apply positive factors
        score += this.accountAgeFactor(factors.accountAge);
        score += this.membershipFactor(factors.memberSince);
        score += this.verificationFactor(factors.isVerified);
        score += this.rolesFactor(factors.roles, factors.trustedRoles);

        // Apply negative factors
        score -= this.warningsFactor(factors.warnings);
        score -= this.strikesFactor(factors.strikes);
        score -= this.spamFlagsFactor(factors.spamFlags);
        score -= this.recentIncidentsFactor(factors.recentIncidents);

        // Clamp to 0-100
        score = Math.max(0, Math.min(100, Math.round(score)));

        // Determine trust level
        const level = this.getLevel(score);

        return {
            score,
            level,
            factors: {
                accountAge: factors.accountAge,
                memberSince: factors.memberSince,
                isVerified: factors.isVerified,
                roleCount: factors.roles,
                warnings: factors.warnings,
                strikes: factors.strikes,
                spamFlags: factors.spamFlags,
                recentIncidents: factors.recentIncidents
            }
        };
    }

    /**
     * Gather all factors needed for score calculation
     */
    async gatherFactors(guildId, userId) {
        const factors = {
            accountAge: 0,
            memberSince: 0,
            isVerified: false,
            roles: 0,
            trustedRoles: [],
            warnings: 0,
            strikes: 0,
            spamFlags: 0,
            recentIncidents: 0
        };

        try {
            // Get Discord user data
            const user = await this.bot.client.users.fetch(userId).catch(() => null);
            if (user) {
                factors.accountAge = Date.now() - user.createdTimestamp;
            }

            // Get guild member data
            const guild = this.bot.client.guilds.cache.get(guildId);
            const member = await guild?.members.fetch(userId).catch(() => null);
            if (member) {
                factors.memberSince = Date.now() - member.joinedTimestamp;
                factors.roles = member.roles.cache.size - 1; // Exclude @everyone
            }

            // Get database records
            if (this.bot.database) {
                // Check verification status
                const verification = await this.bot.database.get(
                    'SELECT verified FROM user_verifications WHERE guild_id = ? AND user_id = ?',
                    [guildId, userId]
                ).catch(() => null);
                factors.isVerified = verification?.verified === 1;

                // Count warnings
                const warnings = await this.bot.database.get(
                    'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1',
                    [guildId, userId]
                ).catch(() => null);
                factors.warnings = warnings?.count || 0;

                // Count strikes
                const strikes = await this.bot.database.get(
                    'SELECT COUNT(*) as count FROM strikes WHERE guild_id = ? AND user_id = ? AND active = 1',
                    [guildId, userId]
                ).catch(() => null);
                factors.strikes = strikes?.count || 0;

                // Get user record for flags
                const record = await this.bot.database.get(
                    'SELECT spam_flags, recent_incidents FROM user_records WHERE guild_id = ? AND user_id = ?',
                    [guildId, userId]
                ).catch(() => null);
                factors.spamFlags = record?.spam_flags || 0;
                factors.recentIncidents = record?.recent_incidents || 0;

                // Get guild config for trusted roles
                const config = await this.bot.database.getGuildConfig(guildId).catch(() => null);
                if (config?.trusted_roles) {
                    try {
                        factors.trustedRoles = JSON.parse(config.trusted_roles);
                    } catch (e) {
                        factors.trustedRoles = [];
                    }
                }
            }
        } catch (error) {
            this.bot.logger?.error('[TrustScore] Error gathering factors:', error);
        }

        return factors;
    }

    /**
     * Account age factor (+15 max)
     */
    accountAgeFactor(ageMs) {
        const days = ageMs / (1000 * 60 * 60 * 24);
        
        if (days < 1) return -15;     // Less than 1 day: suspicious
        if (days < 7) return -10;     // Less than 1 week
        if (days < 30) return 0;      // Less than 1 month
        if (days < 90) return 5;      // 1-3 months
        if (days < 180) return 8;     // 3-6 months
        if (days < 365) return 12;    // 6-12 months
        return 15;                    // 1+ year
    }

    /**
     * Membership duration factor (+15 max)
     */
    membershipFactor(memberSinceMs) {
        const days = memberSinceMs / (1000 * 60 * 60 * 24);
        
        if (days < 1) return 0;       // Just joined
        if (days < 7) return 2;       // Less than 1 week
        if (days < 30) return 5;      // Less than 1 month
        if (days < 90) return 8;      // 1-3 months
        if (days < 180) return 11;    // 3-6 months
        if (days < 365) return 13;    // 6-12 months
        return 15;                    // 1+ year member
    }

    /**
     * Verification factor (+10 if verified)
     */
    verificationFactor(isVerified) {
        return isVerified ? 10 : 0;
    }

    /**
     * Roles factor (+10 max)
     */
    rolesFactor(roleCount, trustedRoles = []) {
        // Basic role count bonus (capped at +5)
        let bonus = Math.min(5, Math.floor(roleCount / 2));
        
        // Additional bonus if user has trusted roles
        // (Would need to check if member has any of the trusted role IDs)
        // For now, just use role count
        
        return Math.min(10, bonus);
    }

    /**
     * Warnings factor (-30 max)
     */
    warningsFactor(warningCount) {
        if (warningCount === 0) return 0;
        if (warningCount === 1) return 10;
        if (warningCount === 2) return 20;
        return 30; // 3+ warnings
    }

    /**
     * Strikes factor (-40 max)
     */
    strikesFactor(strikeCount) {
        if (strikeCount === 0) return 0;
        if (strikeCount === 1) return 15;
        if (strikeCount === 2) return 30;
        return 40; // 3+ strikes
    }

    /**
     * Spam flags factor (-20 max)
     */
    spamFlagsFactor(spamFlags) {
        if (spamFlags === 0) return 0;
        if (spamFlags <= 2) return 5;
        if (spamFlags <= 5) return 10;
        if (spamFlags <= 10) return 15;
        return 20; // 10+ spam incidents
    }

    /**
     * Recent incidents factor (-25 max)
     * Looks at incidents in the last 30 days
     */
    recentIncidentsFactor(recentCount) {
        if (recentCount === 0) return 0;
        if (recentCount === 1) return 8;
        if (recentCount === 2) return 15;
        if (recentCount === 3) return 20;
        return 25; // 4+ recent incidents
    }

    /**
     * Get trust level label from score
     */
    getLevel(score) {
        if (score <= this.thresholds.UNTRUSTED) return 'untrusted';
        if (score <= this.thresholds.LOW_TRUST) return 'low';
        if (score <= this.thresholds.NORMAL) return 'normal';
        return 'high';
    }

    /**
     * Check if user meets minimum trust threshold
     */
    async meetsThreshold(guildId, userId, minimumLevel = 'low') {
        const { score, level } = await this.calculateScore(guildId, userId);
        
        const levelOrder = ['untrusted', 'low', 'normal', 'high'];
        const currentIndex = levelOrder.indexOf(level);
        const requiredIndex = levelOrder.indexOf(minimumLevel);
        
        return currentIndex >= requiredIndex;
    }

    /**
     * Record an incident that affects trust score
     * Called by moderation systems when taking action
     */
    async recordIncident(guildId, userId, incidentType) {
        if (!this.bot.database) return;

        try {
            // Update recent_incidents count in user_records
            await this.bot.database.run(`
                INSERT INTO user_records (guild_id, user_id, recent_incidents, last_incident_at)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    recent_incidents = recent_incidents + 1,
                    last_incident_at = CURRENT_TIMESTAMP
            `, [guildId, userId]);

            // Update spam_flags specifically for spam-related incidents
            if (['spam', 'flood', 'mention_spam', 'link_spam'].includes(incidentType)) {
                await this.bot.database.run(`
                    UPDATE user_records 
                    SET spam_flags = spam_flags + 1 
                    WHERE guild_id = ? AND user_id = ?
                `, [guildId, userId]);
            }

            this.bot.logger?.debug(`[TrustScore] Recorded ${incidentType} incident for ${userId} in ${guildId}`);
        } catch (error) {
            this.bot.logger?.error('[TrustScore] Failed to record incident:', error);
        }
    }

    /**
     * Decay old incidents (run daily via cron)
     * Reduces recent_incidents count for entries older than 30 days
     */
    async decayOldIncidents() {
        if (!this.bot.database) return;

        try {
            // Reset recent_incidents for users who haven't had incidents in 30 days
            await this.bot.database.run(`
                UPDATE user_records 
                SET recent_incidents = CASE 
                    WHEN recent_incidents > 0 THEN recent_incidents - 1 
                    ELSE 0 
                END
                WHERE last_incident_at < datetime('now', '-30 days')
                AND recent_incidents > 0
            `);

            this.bot.logger?.debug('[TrustScore] Decayed old incidents');
        } catch (error) {
            this.bot.logger?.error('[TrustScore] Failed to decay incidents:', error);
        }
    }

    /**
     * Get trust score display for embed
     */
    getScoreEmbed(score, level, factors) {
        const emoji = {
            untrusted: '🔴',
            low: '🟠',
            normal: '🟢',
            high: '💎'
        };

        const color = {
            untrusted: 0xff0000,
            low: 0xff8800,
            normal: 0x00ff00,
            high: 0x00ffff
        };

        return {
            title: `${emoji[level]} Trust Score: ${score}/100`,
            color: color[level],
            fields: [
                { name: 'Level', value: level.charAt(0).toUpperCase() + level.slice(1), inline: true },
                { name: 'Account Age', value: this.formatDuration(factors.accountAge), inline: true },
                { name: 'Member Since', value: this.formatDuration(factors.memberSince), inline: true },
                { name: 'Verified', value: factors.isVerified ? '✅ Yes' : '❌ No', inline: true },
                { name: 'Warnings', value: String(factors.warnings), inline: true },
                { name: 'Strikes', value: String(factors.strikes), inline: true }
            ]
        };
    }

    /**
     * Format milliseconds to human readable duration
     */
    formatDuration(ms) {
        const days = Math.floor(ms / (1000 * 60 * 60 * 24));
        if (days < 1) return 'Less than a day';
        if (days < 7) return `${days} day${days > 1 ? 's' : ''}`;
        if (days < 30) return `${Math.floor(days / 7)} week${days >= 14 ? 's' : ''}`;
        if (days < 365) return `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''}`;
        return `${Math.floor(days / 365)} year${days >= 730 ? 's' : ''}`;
    }
}

module.exports = TrustScore;
