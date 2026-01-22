const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Runtime Code Integrity Checker
 * Verifies bot code hasn't been modified in memory during runtime
 */
class RuntimeIntegrityMonitor {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.checkInterval = options.checkInterval || 60000; // 1 minute
        this.enabled = options.enabled !== false;
        this.criticalModules = [];
        this.checksums = {};
        this.isRunning = false;
    }

    /**
     * Register modules to monitor
     * @param {string[]} modulePaths - Paths to monitor
     */
    registerModules(modulePaths) {
        this.criticalModules = modulePaths;
        this.captureBaseline();
        this.logger.log('[Runtime Monitor] Registered', modulePaths.length, 'modules for monitoring');
    }

    /**
     * Capture baseline checksums
     */
    captureBaseline() {
        for (const modulePath of this.criticalModules) {
            try {
                const content = require.cache[require.resolve(modulePath)];
                if (content) {
                    const checksum = crypto
                        .createHash('sha256')
                        .update(JSON.stringify(content.exports))
                        .digest('hex');
                    this.checksums[modulePath] = checksum;
                }
            } catch (error) {
                this.logger.warn(`[Runtime Monitor] Could not capture baseline for ${modulePath}`);
            }
        }
    }

    /**
     * Verify modules haven't been modified in memory
     */
    verifyIntegrity() {
        const violations = [];

        for (const modulePath of this.criticalModules) {
            try {
                const content = require.cache[require.resolve(modulePath)];
                if (content) {
                    const currentChecksum = crypto
                        .createHash('sha256')
                        .update(JSON.stringify(content.exports))
                        .digest('hex');

                    if (this.checksums[modulePath] !== currentChecksum) {
                        violations.push({
                            module: modulePath,
                            violation: 'Code modified in memory',
                            severity: 'critical',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } catch (error) {
                this.logger.error(`[Runtime Monitor] Verification error for ${modulePath}:`, error.message);
            }
        }

        return violations;
    }

    /**
     * Start continuous monitoring
     */
    start() {
        if (this.isRunning || !this.enabled) return;

        this.logger.log('[Runtime Monitor] Starting runtime integrity monitoring');
        this.isRunning = true;

        this.intervalId = setInterval(() => {
            const violations = this.verifyIntegrity();
            if (violations.length > 0) {
                this.logger.error('[Runtime Monitor] 🚨 INTEGRITY VIOLATIONS DETECTED:');
                violations.forEach(v => {
                    this.logger.error(`   Module: ${v.module}`);
                    this.logger.error(`   Issue: ${v.violation}`);
                    this.logger.error(`   Severity: ${v.severity}`);
                });

                // In production, consider shutting down
                if (process.env.NODE_ENV === 'production') {
                    this.logger.error('[Runtime Monitor] CRITICAL: Shutting down due to code tampering');
                    process.exit(1);
                }
            }
        }, this.checkInterval);
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.isRunning = false;
            this.logger.log('[Runtime Monitor] Stopped');
        }
    }
}

module.exports = RuntimeIntegrityMonitor;
