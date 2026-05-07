/**
 * Anti-Tamper Guard
 * --------------------------------------------------------------
 * Runtime sentinel that complements the inline pre-flight in
 * `src/bot.js` and `start-bot.js`. Even if an attacker replaces
 * the file-protection system with a no-op stub of the same byte
 * length, this guard performs an independent runtime contract
 * check:
 *
 *   1. After bot startup completes, `attach(tamperProtection)` is
 *      called with the loaded TamperProtectionSystem instance.
 *   2. We assert the instance exposes the real public API
 *      (initialize, start, stop, validator, responseHandler, etc.)
 *      and that `validator.baseline` is populated.
 *   3. The TamperProtectionSystem MUST call `heartbeat()` at least
 *      once per HEARTBEAT_TIMEOUT_MS. If it doesn't, we kill the
 *      process with a loud error.
 *   4. We periodically re-hash `file-protection/index.js` against
 *      the fingerprint captured the first time it was loaded, so
 *      live file replacement after startup is also caught.
 *
 * The pre-flight in bot.js verifies THIS file's hash, so an
 * attacker can't simply delete or stub the guard either.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;     // 5 minutes
const RECHECK_INTERVAL_MS  = 2 * 60 * 1000;     // 2 minutes
const REQUIRED_API_METHODS = ['initialize', 'start', 'stop', 'attachBot'];
const REQUIRED_API_PROPS   = ['validator', 'responseHandler', 'baselineManager'];

class AntiTamperGuard {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.lastHeartbeat = 0;
        this.attached = false;
        this.timers = [];
        this.fingerprints = new Map();
    }

    _die(reason) {
        const banner = '\n\x1b[1;31m╔══════════════════════════════════════════════════════════════╗\n' +
                         '║   ANTI-TAMPER GUARD: PROTECTION COMPROMISED — KILLING BOT    ║\n' +
                         '╚══════════════════════════════════════════════════════════════╝\x1b[0m\n';
        process.stderr.write(banner);
        process.stderr.write(`  Reason: ${reason}\n`);
        process.stderr.write('  This bot will not run without a working file-integrity layer.\n\n');
        process.exit(8);
    }

    _hashFile(abs) {
        try {
            return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
        } catch (err) {
            return null;
        }
    }

    _captureFingerprint(rel) {
        const abs = path.resolve(__dirname, '..', '..', rel);
        const h = this._hashFile(abs);
        if (!h) this._die(`cannot read protected file at runtime: ${rel}`);
        this.fingerprints.set(rel, h);
    }

    _verifyFingerprints() {
        for (const [rel, expected] of this.fingerprints.entries()) {
            const abs = path.resolve(__dirname, '..', '..', rel);
            const got = this._hashFile(abs);
            if (got !== expected) {
                this._die(`runtime hash drift detected on ${rel}`);
            }
        }
    }

    /**
     * Validates that `tps` looks like a real TamperProtectionSystem
     * (not a no-op stub). Throws/exits on mismatch.
     */
    attach(tps) {
        if (this.attached) return;
        if (!tps || typeof tps !== 'object') {
            this._die('TamperProtectionSystem instance was not provided to guard');
        }

        for (const m of REQUIRED_API_METHODS) {
            if (typeof tps[m] !== 'function') {
                this._die(`TamperProtectionSystem.${m}() is missing — protection appears stubbed`);
            }
        }
        for (const p of REQUIRED_API_PROPS) {
            if (!tps[p]) {
                this._die(`TamperProtectionSystem.${p} is missing — protection appears stubbed`);
            }
        }

        // Validator must have a populated baseline after .initialize() ran.
        const baseline = tps.validator && tps.validator.baseline;
        if (!baseline || !baseline.hashes || Object.keys(baseline.hashes).length === 0) {
            this._die('validator baseline is empty — protection has no integrity manifest loaded');
        }

        // Capture runtime fingerprints of the protection module entry points.
        const protectedRel = [
            'file-protection/index.js',
            'file-protection/agent/watcher.js',
            'file-protection/agent/validator.js',
            'file-protection/agent/baseline-manager.js',
            'file-protection/agent/protector.js',
            'file-protection/agent/response-handler.js'
        ];
        for (const rel of protectedRel) this._captureFingerprint(rel);

        this.attached = true;
        this.lastHeartbeat = Date.now();

        // Periodic checks
        this.timers.push(setInterval(() => {
            this._verifyFingerprints();
            const idle = Date.now() - this.lastHeartbeat;
            if (idle > HEARTBEAT_TIMEOUT_MS) {
                this._die(`no heartbeat from TamperProtectionSystem for ${Math.round(idle / 1000)}s`);
            }
        }, RECHECK_INTERVAL_MS).unref());

        // Wire the heartbeat into the validator so a stubbed `start()`
        // alone can't keep the guard quiet — the real validator must be
        // exercised at least once per cycle by the running watcher.
        const originalValidate = tps.validator.validateFile?.bind(tps.validator);
        if (originalValidate) {
            tps.validator.validateFile = (...args) => {
                this.heartbeat();
                return originalValidate(...args);
            };
        }

        this.logger.log('[AntiTamperGuard] attached — runtime integrity active');
    }

    heartbeat() {
        this.lastHeartbeat = Date.now();
    }

    stop() {
        for (const t of this.timers) clearInterval(t);
        this.timers = [];
    }
}

module.exports = AntiTamperGuard;
