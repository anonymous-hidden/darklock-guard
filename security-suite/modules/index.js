const RuntimeIntegrityMonitor = require('./runtime-monitor');
const EnvValidator = require('./env-validator');
const ProcessSecurityMonitor = require('./process-monitor');
const NetworkSecurityMonitor = require('./network-monitor');
const AuthenticationAuditor = require('./auth-auditor');

/**
 * SecuritySuite - Orchestrates all security modules
 * Provides unified interface for monitoring and control
 */
class SecuritySuite {
    constructor(options = {}) {
        this.options = options;
        this.modules = {};
        this.initialized = false;
        this.violations = [];
    }

    /**
     * Initialize all security modules
     */
    async initialize() {
        console.log('\n🔒 Initializing Security Suite...\n');

        // Runtime Integrity Monitor
        this.modules.runtime = new RuntimeIntegrityMonitor({
            enabled: this.options.enableRuntime !== false,
            checkInterval: this.options.runtimeCheckInterval || 60000
        });

        // Environment Validator
        this.modules.env = new EnvValidator({
            enabled: this.options.enableEnv !== false,
            checkInterval: this.options.envCheckInterval || 30000
        });

        // Process Security Monitor
        this.modules.process = new ProcessSecurityMonitor({
            enabled: this.options.enableProcess !== false,
            checkInterval: this.options.processCheckInterval || 120000
        });

        // Network Security Monitor
        this.modules.network = new NetworkSecurityMonitor({
            enabled: this.options.enableNetwork !== false,
            whitelist: this.options.networkWhitelist,
            blacklist: this.options.networkBlacklist
        });

        // Authentication Auditor
        this.modules.auth = new AuthenticationAuditor({
            enabled: this.options.enableAuth !== false,
            maxFailedAttempts: this.options.maxFailedAttempts || 5,
            lockoutDuration: this.options.lockoutDuration || 900000
        });

        this.initialized = true;
        console.log('✅ Security Suite initialized\n');
        return true;
    }

    /**
     * Start all security modules
     */
    async start() {
        if (!this.initialized) {
            await this.initialize();
        }

        console.log('🚀 Starting Security Suite Monitors...\n');

        Object.entries(this.modules).forEach(([name, module]) => {
            if (module.start) {
                module.start();
                console.log(`   ✅ ${name} monitor started`);
            }
        });

        console.log('\n✨ All security monitors active\n');
    }

    /**
     * Stop all security modules
     */
    stop() {
        console.log('\n🛑 Stopping Security Suite Monitors...');

        Object.entries(this.modules).forEach(([name, module]) => {
            if (module.stop) {
                module.stop();
                console.log(`   ✅ ${name} monitor stopped`);
            }
        });

        console.log('✨ All security monitors stopped\n');
    }

    /**
     * Log authentication event
     */
    logAuthAttempt(attempt) {
        this.modules.auth.logAuthAttempt(attempt);
    }

    /**
     * Log permission change
     */
    logPermissionChange(change) {
        this.modules.auth.logPermissionChange(change);
    }

    /**
     * Log network request
     */
    logNetworkRequest(request) {
        this.modules.network.logRequest(request);
    }

    /**
     * Get comprehensive security report
     */
    getSecurityReport() {
        const reports = {};

        Object.entries(this.modules).forEach(([name, module]) => {
            if (module.getReport) {
                reports[name] = module.getReport();
            }
        });

        const totalViolations = Object.values(reports).reduce((sum, report) => {
            return sum + (report.violations || 0);
        }, 0);

        return {
            timestamp: new Date(),
            initialized: this.initialized,
            modules: reports,
            totalViolations,
            overallStatus: totalViolations === 0 ? '✅ SECURE' : '🚨 VIOLATIONS DETECTED',
            summary: this._generateSummary(reports)
        };
    }

    /**
     * Print security dashboard
     */
    printDashboard() {
        const report = this.getSecurityReport();

        console.log('\n' + '='.repeat(60));
        console.log('        🔐 SECURITY SUITE DASHBOARD 🔐');
        console.log('='.repeat(60));

        console.log(`\n📊 Overall Status: ${report.overallStatus}`);
        console.log(`Total Violations: ${report.totalViolations}`);
        console.log(`Timestamp: ${report.timestamp.toISOString()}\n`);

        Object.entries(report.modules).forEach(([name, module]) => {
            const icon = module.violations === 0 ? '✅' : '⚠️ ';
            console.log(`${icon} ${module.name}`);
            console.log(`   Status: ${module.status}`);
            console.log(`   Violations: ${module.violations || 0}`);
        });

        console.log('\n' + '='.repeat(60) + '\n');
    }

    /**
     * Generate summary of security posture
     */
    _generateSummary(reports) {
        const summary = {
            runtime: reports.runtime?.status,
            environment: reports.env?.status,
            process: reports.process?.status,
            network: reports.network?.status,
            authentication: reports.auth?.status
        };

        const issues = Object.entries(summary)
            .filter(([_, status]) => status !== 'secure' && status !== 'normal')
            .map(([module, status]) => `${module}: ${status}`);

        return {
            healthyModules: Object.values(summary).filter(s => s === 'secure' || s === 'normal').length,
            totalModules: Object.keys(summary).length,
            issues: issues.length > 0 ? issues : ['None']
        };
    }
}

module.exports = SecuritySuite;
