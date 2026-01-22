const fs = require('fs');
const path = require('path');

/**
 * Process Security Monitor
 * Detects suspicious process behavior and parent process changes
 */
class ProcessSecurityMonitor {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;
        this.originalParentPid = process.ppid;
        this.originalWorkingDir = process.cwd();
        this.checkInterval = options.checkInterval || 120000; // 2 minutes
        this.isRunning = false;
    }

    /**
     * Get system information
     */
    getSystemInfo() {
        return {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            cwd: process.cwd(),
            ppid: process.ppid,
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version
        };
    }

    /**
     * Verify process hasn't been hijacked
     */
    verifyProcessIntegrity() {
        const violations = [];

        // Check if working directory changed
        if (process.cwd() !== this.originalWorkingDir) {
            violations.push({
                type: 'working-directory-change',
                original: this.originalWorkingDir,
                current: process.cwd(),
                severity: 'high'
            });
        }

        // Check if parent process changed (potential hijacking)
        if (process.ppid !== this.originalParentPid) {
            violations.push({
                type: 'parent-process-change',
                original: this.originalParentPid,
                current: process.ppid,
                severity: 'critical'
            });
        }

        // Check memory usage for abnormalities
        const memUsage = process.memoryUsage();
        const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

        if (heapUsedPercent > 90) {
            violations.push({
                type: 'excessive-memory-usage',
                heapUsedPercent: heapUsedPercent.toFixed(2),
                severity: 'medium'
            });
        }

        return violations;
    }

    /**
     * Detect suspicious environment changes
     */
    detectEnvironmentChanges() {
        const issues = [];

        // Check for debugger attachment
        if (process.execArgv.includes('--inspect') || process.execArgv.includes('--debug')) {
            issues.push({
                type: 'debugger-attached',
                severity: 'high',
                description: 'Debugger is attached to process'
            });
        }

        // Check for unusual command line arguments
        const suspiciousArgs = ['--allow-same-origin', '--no-sandbox', '--disable-setuid-sandbox'];
        const unusualArgs = process.execArgv.filter(arg => suspiciousArgs.includes(arg));

        if (unusualArgs.length > 0) {
            issues.push({
                type: 'suspicious-arguments',
                arguments: unusualArgs,
                severity: 'medium'
            });
        }

        return issues;
    }

    /**
     * Start monitoring
     */
    start() {
        if (this.isRunning || !this.enabled) return;

        this.logger.log('[Process Monitor] Starting process security monitoring');
        this.isRunning = true;

        this.intervalId = setInterval(() => {
            const violations = this.verifyProcessIntegrity();
            const envIssues = this.detectEnvironmentChanges();

            if (violations.length > 0) {
                this.logger.error('[Process Monitor] 🚨 PROCESS INTEGRITY VIOLATIONS:');
                violations.forEach(v => {
                    this.logger.error(`   Type: ${v.type}`);
                    this.logger.error(`   Details: ${JSON.stringify(v)}`);
                });

                if (v.severity === 'critical' && process.env.NODE_ENV === 'production') {
                    this.logger.error('[Process Monitor] CRITICAL: Process hijacking detected!');
                    process.exit(1);
                }
            }

            if (envIssues.length > 0) {
                this.logger.warn('[Process Monitor] Environment changes detected');
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
            this.logger.log('[Process Monitor] Stopped');
        }
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics() {
        return {
            systemInfo: this.getSystemInfo(),
            integrityStatus: {
                workingDir: process.cwd() === this.originalWorkingDir ? 'ok' : 'compromised',
                parentProcess: process.ppid === this.originalParentPid ? 'ok' : 'compromised',
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = ProcessSecurityMonitor;
