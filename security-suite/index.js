const RuntimeIntegrityMonitor = require('./modules/runtime-monitor');
const EnvValidator = require('./modules/env-validator');
const ProcessSecurityMonitor = require('./modules/process-monitor');
const NetworkSecurityMonitor = require('./modules/network-monitor');
const AuthenticationAuditor = require('./modules/auth-auditor');

/**
 * Comprehensive Security Suite
 * Multi-layered protection for your Discord bot
 */
class SecuritySuite {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;

        // Initialize all security modules
        this.runtime = new RuntimeIntegrityMonitor({
            logger: this.logger,
            enabled: options.runtime !== false
        });

        this.env = new EnvValidator({
            logger: this.logger,
            enabled: options.env !== false,
            requiredVars: options.requiredVars
        });

        this.process = new ProcessSecurityMonitor({
            logger: this.logger,
            enabled: options.process !== false
        });

        this.network = new NetworkSecurityMonitor({
            logger: this.logger,
            enabled: options.network !== false,
            whitelist: options.whitelist
        });

        this.auth = new AuthenticationAuditor({
            logger: this.logger,
            enabled: options.auth !== false
        });

        this.isInitialized = false;
    }

    /**
     * Initialize security suite
     */
    async initialize() {
        if (this.isInitialized) {
            this.logger.warn('[Security Suite] Already initialized');
            return;
        }

        this.logger.log('\n╔════════════════════════════════════════════╗');
        this.logger.log('║        SECURITY SUITE v1.0.0             ║');
        this.logger.log('║   Multi-Layer Protection Initialized     ║');
        this.logger.log('╚════════════════════════════════════════════╝\n');

        // Validate environment
        const envValid = this.env.validateRequired();
        if (!envValid) {
            this.logger.error('[Security Suite] Environment validation failed');
            return false;
        }

        this.isInitialized = true;
        return true;
    }

    /**
     * Start all security monitors
     */
    async start() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        this.logger.log('[Security Suite] 🚀 Starting all security monitors...\n');

        // Start environment monitoring
        this.env.start();

        // Start runtime integrity monitoring
        this.runtime.start();

        // Start process monitoring
        this.process.start();

        this.logger.log('[Security Suite] ✅ All security monitors active\n');
    }

    /**
     * Stop all monitors
     */
    async stop() {
        this.logger.log('[Security Suite] 🛑 Stopping security monitors...');

        this.env.stop();
        this.runtime.stop();
        this.process.stop();

        this.logger.log('[Security Suite] ✅ All monitors stopped');
    }

    /**
     * Log authentication attempt
     */
    logAuthAttempt(userId, username, ip, success, method) {
        return this.auth.logAuthAttempt(userId, username, ip, success, method);
    }

    /**
     * Log permission change
     */
    logPermissionChange(adminId, targetUser, permission, action, reason) {
        return this.auth.logPermissionChange(adminId, targetUser, permission, action, reason);
    }

    /**
     * Log network request
     */
    logNetworkRequest(url, method, options) {
        return this.network.logRequest(url, method, options);
    }

    /**
     * Get comprehensive security report
     */
    getSecurityReport() {
        return {
            status: 'active',
            timestamp: new Date().toISOString(),
            modules: {
                runtime: {
                    running: this.runtime.isRunning,
                    status: 'monitoring code integrity'
                },
                environment: {
                    running: this.env.isRunning,
                    status: 'monitoring env variables'
                },
                process: {
                    running: this.process.isRunning,
                    status: 'monitoring process integrity',
                    diagnostics: this.process.getDiagnostics()
                },
                network: {
                    status: 'monitoring network requests',
                    report: this.network.getReport()
                },
                auth: {
                    status: 'monitoring authentication',
                    report: this.auth.getSecurityReport()
                }
            }
        };
    }

    /**
     * Print security dashboard
     */
    printDashboard() {
        const report = this.getSecurityReport();

        this.logger.log('\n╔════════════════════════════════════════════╗');
        this.logger.log('║        SECURITY SUITE DASHBOARD          ║');
        this.logger.log('╚════════════════════════════════════════════╝\n');

        this.logger.log('🔒 Runtime Monitor:', this.runtime.isRunning ? '✅ Active' : '❌ Inactive');
        this.logger.log('🔒 Environment Validator:', this.env.isRunning ? '✅ Active' : '❌ Inactive');
        this.logger.log('🔒 Process Monitor:', this.process.isRunning ? '✅ Active' : '❌ Inactive');
        this.logger.log('🔒 Network Monitor: ✅ Active (Passive)');
        this.logger.log('🔒 Authentication Auditor: ✅ Active (Passive)\n');

        // Show auth stats
        const authReport = this.auth.getSecurityReport();
        this.logger.log('📊 Authentication Stats:');
        this.logger.log(`   • Total Attempts: ${authReport.totalAuthAttempts}`);
        this.logger.log(`   • Successful: ${authReport.successfulLogins}`);
        this.logger.log(`   • Failed: ${authReport.failedAttempts}`);
        this.logger.log(`   • Brute Force Attacks: ${authReport.bruteForceAttacks.length}`);
        this.logger.log(`   • Locked IPs: ${authReport.lockedIPs.length}\n`);

        // Show network stats
        const networkReport = this.network.getReport();
        this.logger.log('🌐 Network Stats:');
        this.logger.log(`   • Total Requests: ${networkReport.totalRequests}`);
        this.logger.log(`   • Suspicious: ${networkReport.suspiciousRequests}`);
        this.logger.log(`   • Unique Domains: ${networkReport.uniqueDomains.length}\n`);

        this.logger.log('═════════════════════════════════════════════\n');
    }
}

module.exports = SecuritySuite;
