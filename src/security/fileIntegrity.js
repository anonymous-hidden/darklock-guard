const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileIntegrityMonitor {
    constructor(options = {}) {
        this.baselinePath = options.baselinePath || path.join(process.cwd(), 'data', 'file-integrity.json');
        this.files = options.files || [];
        this.logger = options.logger || console;
    }

    hashFile(filePath) {
        const data = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    ensureDir() {
        fs.mkdirSync(path.dirname(this.baselinePath), { recursive: true });
    }

    loadBaseline() {
        if (!fs.existsSync(this.baselinePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.baselinePath, 'utf8'));
        } catch (e) {
            this.logger?.warn?.('[Integrity] Failed to parse baseline file:', e.message || e);
            return null;
        }
    }

    saveBaseline(baseline) {
        this.ensureDir();
        fs.writeFileSync(this.baselinePath, JSON.stringify(baseline, null, 2));
    }

    async verify() {
        const baseline = this.loadBaseline();
        const current = {};
        const discrepancies = [];

        for (const file of this.files) {
            if (!fs.existsSync(file)) {
                discrepancies.push({ file, error: 'missing' });
                continue;
            }
            const hash = this.hashFile(file);
            current[file] = hash;
            if (baseline && baseline[file] && baseline[file] !== hash) {
                discrepancies.push({ file, expected: baseline[file], actual: hash });
            }
        }

        if (!baseline) {
            this.logger?.warn?.('[Integrity] Baseline missing; creating new baseline for monitored files:', this.files);
            this.saveBaseline(current);
            return { ok: true, baselineCreated: true, discrepancies: [] };
        }

        if (discrepancies.length) {
            const msg = `[Integrity] Detected potential file tampering: ${discrepancies.map(d => d.file).join(', ')}`;
            this.logger?.error?.(msg, discrepancies);
            if (process.env.NODE_ENV === 'production') {
                throw new Error(msg);
            }
            return { ok: false, discrepancies };
        }

        return { ok: true, discrepancies: [] };
    }
}

module.exports = FileIntegrityMonitor;
