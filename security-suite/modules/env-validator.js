const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Environment Variable Validator
 * Ensures sensitive environment variables haven't been compromised
 */
class EnvValidator {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;
        this.requiredVars = options.requiredVars || [
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_ID',
            'DISCORD_CLIENT_SECRET'
        ];
        this.sensitiveVars = options.sensitiveVars || [
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_SECRET',
            'ADMIN_PASSWORD',
            'STRIPE_SECRET',
            'DATABASE_PASSWORD'
        ];
        this.originalValues = {};
        this.checkInterval = options.checkInterval || 30000; // 30 seconds
        this.isRunning = false;
    }

    /**
     * Validate all required environment variables exist
     */
    validateRequired() {
        const missing = [];

        for (const variable of this.requiredVars) {
            if (!process.env[variable]) {
                missing.push(variable);
            }
        }

        if (missing.length > 0) {
            this.logger.error('[Env Validator] ❌ Missing required environment variables:');
            missing.forEach(v => this.logger.error(`   - ${v}`));
            return false;
        }

        this.logger.log('[Env Validator] ✅ All required environment variables present');
        return true;
    }

    /**
     * Capture baseline of sensitive variables
     */
    captureBaseline() {
        for (const variable of this.sensitiveVars) {
            if (process.env[variable]) {
                this.originalValues[variable] = crypto
                    .createHash('sha256')
                    .update(process.env[variable])
                    .digest('hex');
            }
        }
        this.logger.log('[Env Validator] Baseline captured for', this.sensitiveVars.length, 'sensitive variables');
    }

    /**
     * Check if any sensitive variables have been modified
     */
    verifySensitiveVars() {
        const violations = [];

        for (const variable of this.sensitiveVars) {
            if (process.env[variable]) {
                const currentHash = crypto
                    .createHash('sha256')
                    .update(process.env[variable])
                    .digest('hex');

                if (this.originalValues[variable] && this.originalValues[variable] !== currentHash) {
                    violations.push({
                        variable: variable,
                        issue: 'Environment variable has been modified',
                        severity: 'critical',
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (this.originalValues[variable]) {
                violations.push({
                    variable: variable,
                    issue: 'Environment variable has been removed',
                    severity: 'critical',
                    timestamp: new Date().toISOString()
                });
            }
        }

        return violations;
    }

    /**
     * Start continuous monitoring
     */
    start() {
        if (this.isRunning || !this.enabled) return;

        this.logger.log('[Env Validator] Starting environment variable monitoring');
        this.captureBaseline();
        this.isRunning = true;

        this.intervalId = setInterval(() => {
            const violations = this.verifySensitiveVars();
            if (violations.length > 0) {
                this.logger.error('[Env Validator] 🚨 ENVIRONMENT COMPROMISE DETECTED:');
                violations.forEach(v => {
                    this.logger.error(`   Variable: ${v.variable}`);
                    this.logger.error(`   Issue: ${v.issue}`);
                    this.logger.error(`   Severity: ${v.severity}`);
                });

                if (process.env.NODE_ENV === 'production') {
                    this.logger.error('[Env Validator] CRITICAL: Shutting down');
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
            this.logger.log('[Env Validator] Stopped');
        }
    }
}

module.exports = EnvValidator;
