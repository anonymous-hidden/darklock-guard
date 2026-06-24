'use strict';

class TrustScore {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database;
        this.cacheTtlMs = 5 * 60 * 1000;
    }

    async initialize() {
        await this.ensureSchema();
        await this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_records_trust_score ON user_records(guild_id, user_id, trust_score)`).catch(() => {});
        await this.db.run(`CREATE INDEX IF NOT EXISTS idx_warnings_user_active ON warnings(guild_id, user_id, active)`).catch(() => {});
        await this.db.run(`CREATE INDEX IF NOT EXISTS idx_strikes_user_active ON strikes(guild_id, user_id, active)`).catch(() => {});
        return true;
    }

    async ensureSchema() {
        const columns = [
            ['spam_flags', 'INTEGER DEFAULT 0'],
            ['recent_incidents', 'INTEGER DEFAULT 0'],
            ['last_incident_at', 'DATETIME'],
            ['trust_score_cached', 'INTEGER'],
            ['trust_score_updated_at', 'DATETIME'],
            ['manual_override', 'INTEGER DEFAULT 0'],
            ['risk_score', 'INTEGER DEFAULT 50'],
            ['behavior_score', 'INTEGER DEFAULT 50']
        ];

        for (const [name, def] of columns) {
            await this.db.run(`ALTER TABLE user_records ADD COLUMN ${name} ${def}`).catch(err => {
                if (!/duplicate column/i.test(String(err?.message || err))) throw err;
            }).catch(() => {});
        }

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT,
                reason TEXT,
                active INTEGER DEFAULT 1,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).catch(() => {});

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS strikes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT,
                reason TEXT,
                severity INTEGER DEFAULT 1,
                active INTEGER DEFAULT 1,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).catch(() => {});

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS user_verifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                verified INTEGER DEFAULT 0,
                verified_at DATETIME,
                verified_by TEXT,
                verification_method TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )
        `).catch(() => {});
    }

    clamp(score) {
        return Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    }

    getLevel(score) {
        if (score >= 90) return 'excellent';
        if (score >= 75) return 'trusted';
        if (score >= 55) return 'neutral';
        if (score >= 35) return 'watch';
        return 'restricted';
    }

    async ensureRecord(guildId, userId) {
        await this.db.run(
            `INSERT OR IGNORE INTO user_records (guild_id, user_id, trust_score, first_seen, last_seen)
             VALUES (?, ?, 75, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [String(guildId), String(userId)]
        );
        return this.db.getUserRecord(String(guildId), String(userId));
    }

    async countActive(table, guildId, userId) {
        try {
            const row = await this.db.get(
                `SELECT COUNT(*) AS count FROM ${table}
                 WHERE guild_id = ? AND user_id = ? AND active = 1
                 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
                [String(guildId), String(userId)]
            );
            return Number(row?.count || 0);
        } catch {
            return 0;
        }
    }

    async strikeSeverity(guildId, userId) {
        try {
            const row = await this.db.get(
                `SELECT COALESCE(SUM(severity), 0) AS severity FROM strikes
                 WHERE guild_id = ? AND user_id = ? AND active = 1
                 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
                [String(guildId), String(userId)]
            );
            return Number(row?.severity || 0);
        } catch {
            return 0;
        }
    }

    daysSince(value) {
        if (!value) return 0;
        const ts = new Date(value).getTime();
        if (!Number.isFinite(ts)) return 0;
        return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
    }

    async calculateScore(guildId, userId, { force = false } = {}) {
        const record = await this.ensureRecord(guildId, userId);
        const cachedAt = record?.trust_score_updated_at ? new Date(record.trust_score_updated_at).getTime() : 0;
        if (!force && record?.trust_score_cached !== null && record?.trust_score_cached !== undefined && cachedAt && Date.now() - cachedAt < this.cacheTtlMs) {
            const score = this.clamp(record.trust_score_cached);
            return { score, level: this.getLevel(score), factors: await this.buildFactors(guildId, userId, record, score) };
        }

        const factors = await this.buildFactors(guildId, userId, record);
        let score = Number.isFinite(Number(record?.trust_score)) ? Number(record.trust_score) : 75;

        if (record?.manual_override && Number.isFinite(Number(record?.trust_score))) {
            score = Number(record.trust_score);
            factors.manualOverride = true;
        } else {
            score += Math.min(10, Math.floor((factors.accountAgeDays || 0) / 30));
            score += factors.verified ? 10 : 0;
            score -= Math.min(32, factors.warnings * 8);
            score -= Math.min(36, factors.strikeSeverity * 9);
            score -= Math.min(25, factors.spamFlags * 5);
            score -= Math.min(35, factors.recentIncidents * 7);
            if (Number.isFinite(factors.riskScore) && factors.riskScore > 50) {
                score -= Math.round((factors.riskScore - 50) * 0.35);
            }
            if (Number.isFinite(factors.behaviorScore) && factors.behaviorScore > 50) {
                score += Math.round((factors.behaviorScore - 50) * 0.2);
            }
        }

        score = this.clamp(score);
        await this.db.run(
            `UPDATE user_records
             SET trust_score = ?, trust_score_cached = ?, trust_score_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE guild_id = ? AND user_id = ?`,
            [score, score, String(guildId), String(userId)]
        ).catch(async () => {
            await this.db.run(
                `UPDATE user_records SET trust_score = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?`,
                [score, String(guildId), String(userId)]
            ).catch(() => {});
        });

        return { score, level: this.getLevel(score), factors };
    }

    async buildFactors(guildId, userId, record, score = null) {
        const warnings = await this.countActive('warnings', guildId, userId);
        const strikes = await this.countActive('strikes', guildId, userId);
        const strikeSeverity = await this.strikeSeverity(guildId, userId);
        let verified = false;
        try {
            const row = await this.db.get(
                `SELECT verified FROM user_verifications WHERE guild_id = ? AND user_id = ?`,
                [String(guildId), String(userId)]
            );
            verified = !!row?.verified;
        } catch {}

        return {
            score,
            warnings,
            strikes,
            strikeSeverity,
            verified,
            spamFlags: Number(record?.spam_flags || 0),
            recentIncidents: Number(record?.recent_incidents || 0),
            riskScore: Number(record?.risk_score ?? 50),
            behaviorScore: Number(record?.behavior_score ?? 50),
            accountAgeDays: this.daysSince(record?.first_seen || record?.created_at),
            manualOverride: !!record?.manual_override
        };
    }

    async recordIncident(guildId, userId, { spam = false, severity = 1 } = {}) {
        const amount = Math.max(1, Math.min(5, Number(severity) || 1));
        await this.ensureRecord(guildId, userId);
        await this.db.run(
            `UPDATE user_records
             SET recent_incidents = COALESCE(recent_incidents, 0) + ?,
                 spam_flags = COALESCE(spam_flags, 0) + ?,
                 last_incident_at = CURRENT_TIMESTAMP,
                 trust_score_updated_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE guild_id = ? AND user_id = ?`,
            [amount, spam ? 1 : 0, String(guildId), String(userId)]
        ).catch(() => {});
    }

    getScoreEmbed(score, level, factors = {}) {
        const colors = {
            excellent: 0x2ecc71,
            trusted: 0x57f287,
            neutral: 0x3498db,
            watch: 0xf1c40f,
            restricted: 0xe74c3c
        };
        const labels = {
            excellent: 'Excellent Trust',
            trusted: 'Trusted',
            neutral: 'Neutral',
            watch: 'Watch List',
            restricted: 'Restricted'
        };

        return {
            title: `${labels[level] || 'Trust Score'}: ${score}/100`,
            color: colors[level] || colors.neutral,
            fields: [
                { name: 'Score', value: `${score}/100`, inline: true },
                { name: 'Level', value: labels[level] || level, inline: true },
                { name: 'Verified', value: factors.verified ? 'Yes' : 'No', inline: true },
                { name: 'Active warnings', value: String(factors.warnings || 0), inline: true },
                { name: 'Active strikes', value: String(factors.strikes || 0), inline: true },
                { name: 'Recent incidents', value: String(factors.recentIncidents || 0), inline: true }
            ]
        };
    }
}

module.exports = TrustScore;
