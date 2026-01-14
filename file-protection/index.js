require('dotenv').config();

const path = require('path');
const FileEnumerator = require('./agent/file-enumerator');
const BaselineManager = require('./agent/baseline-manager');
const EnvironmentGuard = require('./agent/environment-guard');
const Protector = require('./agent/protector');
const Validator = require('./agent/validator');
const Watcher = require('./agent/watcher');
const ResponseHandler = require('./agent/response-handler');
const BaselineGenerator = require('./agent/baseline-generator');
const { PATHS, RESCAN_INTERVAL_MS } = require('./agent/constants');

class TamperProtectionSystem {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.bot = options.bot || null;

        this.enumerator = new FileEnumerator(this.logger);
        this.baselineManager = new BaselineManager(this.logger);
        this.envGuard = new EnvironmentGuard(this.logger);
        this.protector = new Protector(this.logger);
        this.responseHandler = new ResponseHandler({ protector: this.protector, logger: this.logger, bot: this.bot });

        this.validator = new Validator({ baseline: { hashes: {} }, logger: this.logger });
        this.protectedFiles = [];
        this.tierMap = {};
        this.watcher = null;
        this.periodicTimer = null;
    }

    attachBot(bot) {
        this.bot = bot;
        this.responseHandler.bot = bot;
    }

    buildProtectedSet() {
        const { files, map } = this.enumerator.buildProtectedMap();
        this.protectedFiles = files;
        this.tierMap = map;
    }

    getTierForFile(filePath) {
        const normalized = path.normalize(filePath);
        return this.tierMap[normalized] || this.tierMap[filePath] || 'medium';
    }

    async runEnvironmentChecks() {
        const violations = this.envGuard.validate();
        if (violations.length > 0) {
            this.logger.error('[TamperProtection] Environment validation failed:', violations.join('; '));
            await this.responseHandler.handleEnvironmentViolation(violations);
            throw new Error('Environment validation failed');
        }
        return null;
    }

    loadBaseline() {
        const baseline = this.baselineManager.loadBaseline();
        this.validator.setBaseline(baseline);
        return baseline;
    }

    async verifyBaselineSignature() {
        try {
            this.baselineManager.loadBaseline();
            return true;
        } catch (err) {
            this.logger.error('[TamperProtection] Baseline signature invalid:', err.message || err);
            await this.responseHandler.handleBaselineSignatureFailure();
            return false;
        }
    }

    async startupValidation() {
        const issues = this.validator.validateAll();
        if (issues.length === 0) {
            this.logger.log('[TamperProtection] Startup baseline validation passed');
            return;
        }

        this.logger.error(`[TamperProtection] Startup validation found ${issues.length} issues`);
        for (const issue of issues) {
            await this.responseHandler.handleDetection({
                ...issue,
                tier: this.getTierForFile(issue.filePath),
                source: 'startup'
            });
        }
    }

    async initialize(bot = null) {
        if (bot) {
            this.attachBot(bot);
        }

        try {
            this.buildProtectedSet();
            await this.runEnvironmentChecks();
            try {
                this.loadBaseline();
            } catch (err) {
                await this.responseHandler.handleBaselineSignatureFailure(err.message || 'baseline_load_failed');
                throw err;
            }
            await this.startupValidation();
            this.logger.log('[TamperProtection] Initialized');
            return true;
        } catch (err) {
            this.logger.error('[TamperProtection] Initialization failed:', err.message || err);
            throw err;
        }
    }

    async startWatcher() {
        this.watcher = new Watcher({
            protectedFiles: this.protectedFiles,
            validator: this.validator,
            responder: this.responseHandler,
            logger: this.logger
        });
        await this.watcher.start();
    }

    async runCriticalRescan() {
        const criticalFiles = this.protectedFiles.filter(f => f.tier === 'critical');
        for (const file of criticalFiles) {
            const result = this.validator.validateFile(file.path);
            if (!result.valid) {
                await this.responseHandler.handleDetection({
                    ...result,
                    tier: 'critical',
                    source: 'periodic'
                });
            }
        }
    }

    async startPeriodicValidation() {
        this.periodicTimer = setInterval(async () => {
            const ok = await this.verifyBaselineSignature();
            if (!ok) return;
            await this.runCriticalRescan();
        }, RESCAN_INTERVAL_MS);
    }

    async start(bot = null) {
        if (bot) this.attachBot(bot);
        if (!this.protectedFiles.length) {
            this.buildProtectedSet();
        }

        await this.startWatcher();
        await this.startPeriodicValidation();
        this.logger.log('[TamperProtection] Real-time monitoring active');
    }

    async stop() {
        if (this.watcher) {
            await this.watcher.stop();
            this.watcher = null;
        }
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = null;
        }
    }

    async regenerateBaseline(triggeredBy = 'system') {
        const generator = new BaselineGenerator(this.logger);
        const baseline = generator.run();
        this.buildProtectedSet();
        this.validator.setBaseline(baseline);
        if (this.watcher) {
            await this.watcher.stop();
            await this.startWatcher();
        }
        await this.verifyBaselineSignature();
        this.logger.log(`[TamperProtection] Baseline regenerated by ${triggeredBy}`);
        return baseline;
    }
}

module.exports = TamperProtectionSystem;
