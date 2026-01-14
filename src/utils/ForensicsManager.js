const crypto = require('crypto');

/**
 * ForensicsManager
 * Centralized, optionally encrypted audit logging with replay support.
 * Uses the existing `audit_logs` table for full-fidelity change capture.
 */
class ForensicsManager {
    constructor(bot) {
        this.bot = bot;
        this.secret = process.env.AUDIT_ENCRYPTION_KEY || process.env.AUDIT_LOG_SECRET || null;
        this.encryptionEnabled = !!this.secret;
    }

    hashIP(ip) {
        if (!ip) return null;
        return crypto.createHash('sha256').update(`${ip}:${this.secret || 'forensics_salt'}`).digest('hex');
    }

    fingerprint(userId, guildId, extra = '') {
        const source = `${userId}:${guildId}:${extra}:${this.secret || 'fp_salt'}`;
        return crypto.createHash('sha256').update(source).digest('hex');
    }

    encryptPayload(payload) {
        if (!payload) return null;
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!this.encryptionEnabled) return serialized;

        const iv = crypto.randomBytes(12);
        const key = crypto.createHash('sha256').update(this.secret).digest();
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(serialized, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag().toString('base64');

        return JSON.stringify({
            iv: iv.toString('base64'),
            tag,
            data: encrypted
        });
    }

    decryptPayload(serialized) {
        if (!serialized) return null;
        try {
            const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
            if (!parsed?.data || !parsed?.iv || !parsed?.tag) {
                return typeof parsed === 'string' ? parsed : parsed;
            }

            const key = crypto.createHash('sha256').update(this.secret || '').digest();
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                key,
                Buffer.from(parsed.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
            let decrypted = decipher.update(parsed.data, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (err) {
            this.bot.logger?.warn('[Forensics] Failed to decrypt payload, returning raw value', err.message);
            return serialized;
        }
    }

    /**
     * Write an audit log entry with optional encryption and replay metadata.
     */
    async logAuditEvent({
        guildId,
        eventType,
        eventCategory,
        executor = {},
        target = {},
        changes = {},
        reason = null,
        beforeState = null,
        afterState = null,
        canReplay = false,
        ip = null,
        deviceFingerprint = null,
        timestamp = new Date().toISOString()
    }) {
        if (!this.bot?.database) return;

        try {
            await this.bot.database.run(
                `
                INSERT INTO audit_logs (
                    guild_id, event_type, event_category,
                    executor_id, executor_tag,
                    target_type, target_id, target_name,
                    changes, reason, before_state, after_state,
                    can_replay, replayed, ip_hash, device_fingerprint, timestamp, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, CURRENT_TIMESTAMP)
            `,
                [
                    guildId,
                    eventType,
                    eventCategory,
                    executor.id || executor.userId || null,
                    executor.tag || executor.username || null,
                    target.type || null,
                    target.id || null,
                    target.name || null,
                    this.encryptPayload(changes),
                    reason || null,
                    this.encryptPayload(beforeState),
                    this.encryptPayload(afterState),
                    canReplay ? 1 : 0,
                    this.hashIP(ip),
                    deviceFingerprint || null,
                    timestamp
                ]
            );
        } catch (error) {
            this.bot.logger?.error('[Forensics] Failed to persist audit event', error);
        }
    }

    /**
     * Return decrypted audit events for the last N minutes to support replay reconstruction.
     */
    async getRecentEvents(guildId, minutes = 10) {
        if (!this.bot?.database) return [];
        const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const rows = await this.bot.database.all(
            `
            SELECT * FROM audit_logs
            WHERE guild_id = ? AND timestamp >= ?
            ORDER BY timestamp DESC
        `,
            [guildId, since]
        );

        return rows.map((row) => ({
            ...row,
            changes: this.decryptPayload(row.changes),
            before_state: this.decryptPayload(row.before_state),
            after_state: this.decryptPayload(row.after_state)
        }));
    }
}

module.exports = ForensicsManager;
