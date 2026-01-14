const { EmbedBuilder } = require('discord.js');

/**
 * Account Risk Scoring & Anti-Alt Detection System
 */
class RiskScoring {
    constructor(database, client) {
        this.db = database;
        this.client = client;
    }

    /**
     * Calculate comprehensive risk score for a user
     */
    async calculateRiskScore(guild, member) {
        const scores = {
            accountAge: await this.scoreAccountAge(member),
            hasAvatar: this.scoreAvatar(member),
            mutualServers: await this.scoreMutualServers(member),
            joinVelocity: await this.scoreJoinVelocity(guild, member),
            username: this.scoreUsername(member),
            previousFlags: await this.scorePreviousFlags(guild, member)
        };

        const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
        const avgScore = Math.round(totalScore / Object.keys(scores).length);

        const riskLevel = this.getRiskLevel(avgScore);
        const verificationRequired = avgScore > 70;

        // Store in database
        await this.db.run(`
            INSERT OR REPLACE INTO user_risk_scores (
                guild_id, user_id,
                account_age_days, has_avatar, mutual_servers,
                join_velocity_score, total_risk_score, risk_level,
                verification_required
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guild.id,
            member.id,
            this.getAccountAgeDays(member),
            member.user.avatar ? 1 : 0,
            await this.getMutualServerCount(member),
            scores.joinVelocity,
            avgScore,
            riskLevel,
            verificationRequired ? 1 : 0
        ]);

        return {
            scores,
            totalScore: avgScore,
            riskLevel,
            verificationRequired,
            details: this.getScoreDetails(scores)
        };
    }

    /**
     * Score based on account age
     */
    scoreAccountAge(member) {
        const ageInDays = this.getAccountAgeDays(member);
        
        if (ageInDays < 1) return 90; // Very new account
        if (ageInDays < 7) return 70; // Less than a week
        if (ageInDays < 30) return 50; // Less than a month
        if (ageInDays < 90) return 30; // Less than 3 months
        if (ageInDays < 365) return 20; // Less than a year
        return 10; // Old account
    }

    /**
     * Score based on avatar presence
     */
    scoreAvatar(member) {
        return member.user.avatar ? 10 : 40; // No avatar = higher risk
    }

    /**
     * Score based on mutual servers
     */
    async scoreMutualServers(member) {
        const count = await this.getMutualServerCount(member);
        
        if (count === 0) return 60; // No mutual servers
        if (count === 1) return 40;
        if (count <= 3) return 30;
        if (count <= 5) return 20;
        return 10; // Many mutual servers
    }

    /**
     * Score based on join velocity (how many servers joined recently)
     */
    async scoreJoinVelocity(guild, member) {
        // Check if user joined multiple servers in short time
        // This would require a global database or API
        // For now, we'll use a simplified version based on guild join patterns
        
        const recentJoins = await this.db.get(`
            SELECT COUNT(*) as count
            FROM join_analytics
            WHERE user_id = ? AND timestamp > datetime('now', '-1 hour')
        `, [member.id]);

        const count = recentJoins?.count || 0;
        
        if (count > 10) return 90; // Joining many servers quickly
        if (count > 5) return 60;
        if (count > 2) return 40;
        return 20;
    }

    /**
     * Score based on username patterns
     */
    scoreUsername(member) {
        const username = member.user.username.toLowerCase();
        
        // Check for common raid patterns
        const suspiciousPatterns = [
            /^[a-z]\d+$/,           // Single letter + numbers (a123)
            /^user\d+$/,            // user123
            /^discord\d+$/,         // discord123
            /^\d+$/,                // Only numbers
            /^[a-z]{1,3}\d{3,}$/,   // Very short + many numbers
            /(raid|nuke|spam|bot)/i // Suspicious keywords
        ];

        for (const pattern of suspiciousPatterns) {
            if (pattern.test(username)) {
                return 70;
            }
        }

        // Check for default Discord username patterns
        if (username.length < 4) return 50;
        if (/[^\w\s]/.test(username) && username.length > 20) return 40; // Many special chars

        return 20;
    }

    /**
     * Score based on previous flags/bans in other servers
     */
    async scorePreviousFlags(guild, member) {
        // Check local guild history
        const localRecord = await this.db.get(`
            SELECT warning_count, trust_score, flags
            FROM user_records
            WHERE guild_id = ? AND user_id = ?
        `, [guild.id, member.id]);

        if (localRecord) {
            if (localRecord.warning_count > 5) return 80;
            if (localRecord.warning_count > 2) return 60;
            if (localRecord.trust_score < 30) return 70;
        }

        // Check global threat database
        const globalThreat = await this.db.get(`
            SELECT * FROM global_threats
            WHERE target_id = ? AND active = 1
        `, [member.id]);

        if (globalThreat) {
            if (globalThreat.severity === 'critical') return 95;
            if (globalThreat.severity === 'high') return 80;
            return 60;
        }

        return 20;
    }

    /**
     * Detect potential alt accounts
     */
    async detectAlt(guild, member) {
        const detectionMethods = [];
        let confidence = 0;
        let suspectedMainAccount = null;

        // Method 1: Join time clustering (same IP/location - simulated)
        const recentMembers = await this.db.all(`
            SELECT user_id FROM join_analytics
            WHERE guild_id = ? AND timestamp > datetime('now', '-5 minutes')
        `, [guild.id]);

        if (recentMembers.length > 1) {
            detectionMethods.push('join_time_clustering');
            confidence += 30;
        }

        // Method 2: Similar username patterns
        const similarUsers = await this.findSimilarUsernames(guild, member.user.username);
        if (similarUsers.length > 0) {
            detectionMethods.push('similar_username');
            confidence += 40;
            suspectedMainAccount = similarUsers[0];
        }

        // Method 3: Account age + behavior pattern
        const accountAge = this.getAccountAgeDays(member);
        if (accountAge < 7) {
            const existingAlts = await this.db.get(`
                SELECT COUNT(*) as count FROM alt_detection
                WHERE guild_id = ? AND suspected_main_account = ?
            `, [guild.id, suspectedMainAccount]);

            if (existingAlts?.count > 0) {
                detectionMethods.push('pattern_matching');
                confidence += 30;
            }
        }

        if (confidence > 60) {
            await this.db.run(`
                INSERT INTO alt_detection (
                    guild_id, user_id, suspected_main_account,
                    detection_method, confidence, evidence
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
                guild.id,
                member.id,
                suspectedMainAccount,
                detectionMethods.join(','),
                confidence,
                JSON.stringify({ methods: detectionMethods, timestamp: new Date() })
            ]);

            return {
                isAlt: true,
                confidence,
                suspectedMainAccount,
                detectionMethods
            };
        }

        return {
            isAlt: false,
            confidence,
            suspectedMainAccount: null,
            detectionMethods
        };
    }

    /**
     * Get risk level from score
     */
    getRiskLevel(score) {
        if (score >= 80) return 'critical';
        if (score >= 60) return 'high';
        if (score >= 40) return 'medium';
        return 'low';
    }

    /**
     * Helper: Get account age in days
     */
    getAccountAgeDays(member) {
        const createdAt = member.user.createdTimestamp;
        const now = Date.now();
        return Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    }

    /**
     * Helper: Get mutual server count
     */
    async getMutualServerCount(member) {
        // Count how many guilds the bot shares with this user
        let count = 0;
        for (const guild of this.client.guilds.cache.values()) {
            if (guild.members.cache.has(member.id)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Helper: Find similar usernames
     */
    async findSimilarUsernames(guild, username) {
        const members = await guild.members.fetch();
        const similar = [];

        const base = username.toLowerCase().replace(/\d+/g, '');
        
        members.forEach(member => {
            const memberBase = member.user.username.toLowerCase().replace(/\d+/g, '');
            if (memberBase === base && member.user.username !== username) {
                similar.push(member.id);
            }
        });

        return similar;
    }

    /**
     * Helper: Get score details
     */
    getScoreDetails(scores) {
        return Object.entries(scores).map(([key, value]) => {
            let status = '✅';
            if (value > 60) status = '🔴';
            else if (value > 40) status = '🟡';
            
            return `${status} ${key}: ${value}/100`;
        }).join('\n');
    }

    /**
     * Send risk alert to staff
     */
    async sendRiskAlert(guild, member, riskData) {
        const config = await this.db.getGuildConfig(guild.id);
        if (!config?.log_channel_id) return;

        const logChannel = guild.channels.cache.get(config.log_channel_id);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ High Risk Member Detected')
            .setColor(riskData.riskLevel === 'critical' ? 0xFF0000 : 0xFFA500)
            .setDescription(`${member.user.tag} (${member.id})`)
            .addFields(
                { name: 'Risk Level', value: riskData.riskLevel.toUpperCase(), inline: true },
                { name: 'Risk Score', value: `${riskData.totalScore}/100`, inline: true },
                { name: 'Account Age', value: `${this.getAccountAgeDays(member)} days`, inline: true },
                { name: 'Score Breakdown', value: riskData.details }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

        if (riskData.verificationRequired) {
            embed.addFields({ name: '🔒 Action Required', value: 'User requires verification before full access' });
        }

        await logChannel.send({ embeds: [embed] });
    }
}

module.exports = RiskScoring;
