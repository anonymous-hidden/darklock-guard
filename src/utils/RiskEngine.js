/**
 * RiskEngine
 * Lightweight, explainable risk scoring for new joins and alt detection.
 * Stores scores in `user_risk_scores` and can flag suspected alts in `alt_detection`.
 */
class RiskEngine {
    constructor(bot) {
        this.bot = bot;
        this.joinWindows = new Map();
    }

    trackJoinVelocity(guildId, windowMs = 60000) {
        const key = guildId;
        const now = Date.now();
        if (!this.joinWindows.has(key)) {
            this.joinWindows.set(key, []);
        }
        const entries = this.joinWindows.get(key).filter((ts) => now - ts < windowMs);
        entries.push(now);
        this.joinWindows.set(key, entries);
        return entries.length;
    }

    scoreMember(member) {
        const now = Date.now();
        const accountAgeMs = now - member.user.createdTimestamp;
        const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
        const hasAvatar = !!member.user.avatar;
        const mutuals = this.bot?.client?.mutualGuilds?.size || 0;
        const joinVelocity = this.trackJoinVelocity(member.guild.id);

        let score = 30;
        const reasons = [];

        if (accountAgeDays < 1) {
            score += 30;
            reasons.push('very_new_account');
        } else if (accountAgeDays < 7) {
            score += 15;
            reasons.push('new_account');
        }

        if (!hasAvatar) {
            score += 10;
            reasons.push('no_avatar');
        }

        if (mutuals === 0) {
            score += 5;
            reasons.push('no_mutuals');
        }

        if (joinVelocity >= 5) {
            score += 20;
            reasons.push('join_velocity');
        } else if (joinVelocity >= 3) {
            score += 10;
            reasons.push('elevated_join_velocity');
        }

        const riskLevel = score >= 80 ? 'high' : score >= 60 ? 'medium' : score >= 40 ? 'elevated' : 'low';

        return {
            score: Math.min(100, score),
            riskLevel,
            accountAgeDays,
            hasAvatar,
            mutuals,
            joinVelocity,
            reasons
        };
    }

    async persistScore(guildId, userId, scoreData) {
        if (!this.bot?.database) return;
        const {
            score,
            riskLevel,
            accountAgeDays,
            hasAvatar,
            mutuals,
            joinVelocity,
            reasons = []
        } = scoreData;

        await this.bot.database.run(
            `
            INSERT INTO user_risk_scores (
                guild_id, user_id, account_age_days, has_avatar, mutual_servers,
                join_velocity_score, total_risk_score, risk_level, flag_reasons, last_calculated, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                account_age_days = excluded.account_age_days,
                has_avatar = excluded.has_avatar,
                mutual_servers = excluded.mutual_servers,
                join_velocity_score = excluded.join_velocity_score,
                total_risk_score = excluded.total_risk_score,
                risk_level = excluded.risk_level,
                flag_reasons = excluded.flag_reasons,
                last_calculated = CURRENT_TIMESTAMP
        `,
            [
                guildId,
                userId,
                accountAgeDays,
                hasAvatar ? 1 : 0,
                mutuals,
                joinVelocity,
                score,
                riskLevel,
                JSON.stringify(reasons)
            ]
        );
    }

    async flagAlt(guildId, userId, detectionMethod, confidence = 0.5, evidence = {}) {
        if (!this.bot?.database) return;
        await this.bot.database.run(
            `
            INSERT INTO alt_detection (
                guild_id, user_id, detection_method, confidence, evidence
            ) VALUES (?, ?, ?, ?, ?)
        `,
            [guildId, userId, detectionMethod, confidence, JSON.stringify(evidence)]
        );
    }
}

module.exports = RiskEngine;
