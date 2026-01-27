const path = require('path');

class Watcher {
    constructor({ protectedFiles = [], validator, responder, logger = console, debounceDelay = 150 } = {}) {
        this.logger = logger;
        this.validator = validator;
        this.responder = responder;
        this.protectedFiles = protectedFiles;
        this.debounceDelay = debounceDelay;
        this.watcher = null;
        this.debounceTimers = new Map();
        this.chokidar = null;

        this.pathTierMap = new Map();
        for (const entry of protectedFiles) {
            this.pathTierMap.set(path.normalize(entry.path), entry.tier);
        }
    }

    async getChokidar() {
        if (this.chokidar) return this.chokidar;
        let mod = await import('chokidar');
        if (mod && mod.default) mod = mod.default;
        this.chokidar = mod;
        return this.chokidar;
    }

    scheduleValidate(filePath) {
        if (this.debounceTimers.has(filePath)) {
            clearTimeout(this.debounceTimers.get(filePath));
        }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(filePath);
            this.validateAndRespond(filePath);
        }, this.debounceDelay);

        this.debounceTimers.set(filePath, timer);
    }

    async validateAndRespond(filePath) {
        const normalized = path.normalize(filePath);
        const tier = this.pathTierMap.get(normalized);
        if (!tier) return;

        try {
            const result = this.validator.validateFile(normalized);
            if (!result.valid) {
                await this.responder.handleDetection({
                    ...result,
                    tier,
                    source: 'watcher'
                });
            }
        } catch (err) {
            this.logger.error(`[Watcher] Validation error for ${normalized}:`, err.message || err);
        }
    }

    async start() {
        if (!this.protectedFiles.length) {
            this.logger.warn('[Watcher] No protected files to monitor');
            return;
        }

        const chokidar = await this.getChokidar();
        this.watcher = chokidar.watch(this.protectedFiles.map(f => f.path), {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 100
            },
            atomic: true
        });

        this.watcher.on('change', (filePath) => this.scheduleValidate(filePath));
        this.watcher.on('unlink', (filePath) => this.scheduleValidate(filePath));
        this.watcher.on('error', (error) => this.logger.error('[Watcher] Error:', error));

        this.watcher.on('ready', () => {
            this.logger.log(`[Watcher] Monitoring ${this.protectedFiles.length} protected files`);
        });
    }

    async stop() {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
    }
}

module.exports = Watcher;
