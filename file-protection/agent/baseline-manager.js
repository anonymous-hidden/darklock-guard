const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { PATHS, HMAC_KEY_ENV } = require('./constants');

class BaselineManager {
    constructor(logger = console) {
        this.logger = logger;
        this.baselinePath = PATHS.baseline;
    }

    getKey() {
        const key = process.env[HMAC_KEY_ENV];
        if (!key || typeof key !== 'string' || key.trim().length === 0) {
            throw new Error(`${HMAC_KEY_ENV} is required to verify baseline integrity`);
        }
        return key;
    }

    canonicalizeHashes(hashes) {
        const ordered = {};
        Object.keys(hashes).sort().forEach((k) => {
            ordered[k] = hashes[k];
        });
        return JSON.stringify(ordered);
    }

    signHashes(hashes) {
        const key = this.getKey();
        const canonical = this.canonicalizeHashes(hashes);
        return crypto.createHmac('sha256', key).update(canonical).digest('hex');
    }

    verifySignature(baseline) {
        if (!baseline || typeof baseline !== 'object') {
            throw new Error('Baseline payload is missing or invalid');
        }
        if (!baseline.hashes || typeof baseline.hashes !== 'object') {
            throw new Error('Baseline is missing hashes');
        }
        if (!baseline.signature) {
            throw new Error('Baseline signature missing');
        }

        const expected = this.signHashes(baseline.hashes);
        if (expected !== baseline.signature) {
            throw new Error('Baseline signature mismatch');
        }

        return true;
    }

    loadBaseline() {
        if (!fs.existsSync(this.baselinePath)) {
            throw new Error(`Baseline not found at ${this.baselinePath}`);
        }

        const raw = fs.readFileSync(this.baselinePath, 'utf8');
        const baseline = JSON.parse(raw);
        this.verifySignature(baseline);

        this.logger.log('[BaselineManager] Baseline signature verified');
        return baseline;
    }

    saveBaseline(hashes) {
        const signature = this.signHashes(hashes);
        const payload = {
            generated: new Date().toISOString(),
            version: '1.0.0',
            fileCount: Object.keys(hashes).length,
            hashes,
            signature
        };

        const dir = path.dirname(this.baselinePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.baselinePath, JSON.stringify(payload, null, 2));
        this.logger.log(`[BaselineManager] Baseline saved to ${this.baselinePath}`);

        return payload;
    }
}

module.exports = BaselineManager;
