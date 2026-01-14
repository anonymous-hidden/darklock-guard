const os = require('os');
const path = require('path');
const https = require('https');
const { ALERT_WEBHOOK_ENV } = require('./constants');

class ResponseHandler {
    constructor({ protector, logger = console, bot = null } = {}) {
        this.protector = protector;
        this.logger = logger;
        this.bot = bot;
        this.webhookUrl = process.env[ALERT_WEBHOOK_ENV] || null;
    }

    mapTierToSeverity(tier) {
        if (tier === 'critical') return 'CRITICAL';
        if (tier === 'high') return 'HIGH';
        return 'MEDIUM';
    }

    async sendWebhook(payload) {
        if (!this.webhookUrl) {
            this.logger.warn('[TamperResponder] No webhook configured; skipping alert');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const body = JSON.stringify({
                    content: '🚨 TAMPER DETECTION ALERT',
                    embeds: [
                        {
                            title: '🚨 Tamper Detection Alert',
                            color: payload.severity === 'CRITICAL' ? 0xff0000 : payload.severity === 'HIGH' ? 0xffa500 : 0xffcc00,
                            fields: [
                                { name: 'File', value: payload.filePath || 'N/A', inline: false },
                                { name: 'Severity', value: payload.severity, inline: true },
                                { name: 'Action', value: payload.actionTaken || 'unknown', inline: true },
                                { name: 'Expected', value: payload.expectedHash || 'n/a', inline: false },
                                { name: 'Actual', value: payload.actualHash || 'n/a', inline: false },
                                { name: 'Host', value: payload.host, inline: true },
                                { name: 'Process', value: String(payload.pid), inline: true }
                            ],
                            timestamp: payload.timestamp
                        }
                    ]
                });

                const url = new URL(this.webhookUrl);
                const options = {
                    method: 'POST',
                    hostname: url.hostname,
                    path: url.pathname + (url.search || ''),
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                };

                const req = https.request(options, (res) => {
                    res.on('data', () => {});
                    res.on('end', resolve);
                });

                req.on('error', reject);
                req.write(body);
                req.end();
            } catch (err) {
                this.logger.warn('[TamperResponder] Failed to send webhook', err.message || err);
                resolve();
            }
        });
    }

    async lockdownAndShutdown(payload) {
        try {
            if (this.bot && this.bot.client) {
                this.bot.commandProcessingDisabled = true;
                const presencePayload = {
                    activities: [{ name: 'Security lockdown' }],
                    status: 'dnd'
                };
                if (this.bot.client.user) {
                    await this.bot.client.user.setPresence(presencePayload).catch(() => {});
                }
            }
        } catch (err) {
            this.logger.warn('[TamperResponder] Failed to set lockdown presence', err.message || err);
        }

        try {
            await this.sendWebhook(payload);
        } catch (_) {}

        try {
            this.logger.error('[TamperResponder] CRITICAL tamper detected. Shutting down.');
        } catch (_) {}

        setTimeout(() => process.exit(1), 500);
    }

    async handleDetection(detail) {
        const severity = this.mapTierToSeverity(detail.tier);
        const timestamp = new Date().toISOString();
        const host = os.hostname();
        const pid = process.pid;
        const expectedHash = detail.expectedHash || null;
        const actualHash = detail.actualHash || null;
        const forceShutdown = detail.forceShutdown === true;

        let actionTaken = 'alert';
        let evidencePath = null;

        if (severity === 'CRITICAL' || severity === 'HIGH' || forceShutdown) {
            evidencePath = this.protector.quarantine(detail.filePath, actualHash);
        }

        const payload = {
            filePath: detail.filePath || 'unknown',
            severity,
            expectedHash,
            actualHash,
            actionTaken,
            timestamp,
            host,
            pid,
            reason: detail.reason || 'hash_mismatch',
            source: detail.source || 'watcher',
            evidencePath
        };

        this.protector.logEvent(payload);

        if (severity === 'CRITICAL' || forceShutdown) {
            payload.actionTaken = 'shutdown';
            await this.lockdownAndShutdown(payload);
            return;
        }

        if (severity === 'HIGH') {
            const reverted = this.protector.restore(detail.filePath, expectedHash);
            payload.actionTaken = reverted ? 'auto-revert' : 'revert_failed_shutdown';
            await this.sendWebhook(payload);

            if (!reverted) {
                await this.lockdownAndShutdown(payload);
                return;
            }
            return;
        }

        await this.sendWebhook(payload);
    }

    async handleBaselineSignatureFailure(reason = 'baseline_signature_mismatch') {
        await this.handleDetection({
            filePath: path.join('file-protection', 'config', 'baseline.json'),
            expectedHash: 'signed baseline',
            actualHash: 'invalid signature',
            tier: 'critical',
            reason,
            source: 'baseline_check'
        });
    }

    async handleEnvironmentViolation(violations) {
        await this.handleDetection({
            filePath: 'ENVIRONMENT',
            expectedHash: 'secure environment',
            actualHash: violations.join('; '),
            tier: 'high',
            reason: 'environment_violation',
            source: 'startup',
            forceShutdown: true
        });
    }
}

module.exports = ResponseHandler;
