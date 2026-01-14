const fs = require('fs');
const path = require('path');
const Hasher = require('./hasher');

class Validator {
    constructor({ baseline = { hashes: {} }, logger = console } = {}) {
        this.logger = logger;
        this.setBaseline(baseline);
    }

    setBaseline(baseline) {
        this.baseline = baseline || { hashes: {} };
        this.hashes = this.baseline.hashes || {};
    }

    validateFile(filePath) {
        const normalized = path.normalize(filePath);
        const expectedHash = this.hashes[normalized];

        if (!expectedHash) {
            return {
                valid: true,
                filePath: normalized,
                reason: 'not_monitored'
            };
        }

        if (!fs.existsSync(normalized)) {
            return {
                valid: false,
                filePath: normalized,
                expectedHash,
                actualHash: null,
                reason: 'file_missing'
            };
        }

        const actualHash = Hasher.hashFile(normalized);
        if (actualHash !== expectedHash) {
            return {
                valid: false,
                filePath: normalized,
                expectedHash,
                actualHash,
                reason: 'hash_mismatch'
            };
        }

        return {
            valid: true,
            filePath: normalized,
            expectedHash,
            actualHash,
            reason: 'hash_match'
        };
    }

    validateMany(files) {
        const results = [];
        for (const file of files) {
            const result = this.validateFile(file);
            if (!result.valid) {
                results.push(result);
            }
        }
        return results;
    }

    validateAll() {
        return this.validateMany(Object.keys(this.hashes));
    }
}

module.exports = Validator;
