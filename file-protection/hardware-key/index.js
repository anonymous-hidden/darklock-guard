const PicoDetector = require('./pico-detector');
const FileGuard = require('./file-guard');
const path = require('path');

/**
 * Hardware Key Protection System
 * Main entry point for Raspberry Pi Pico-based file protection
 */
class HardwareKeyProtection {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.projectRoot = options.projectRoot || process.cwd();
        
        // Initialize Pico detector
        this.detector = new PicoDetector({
            logger: this.logger,
            checkInterval: options.checkInterval || 2000,
            customIdentifier: options.customIdentifier
        });
        
        // Initialize file guard
        this.fileGuard = new FileGuard({
            logger: this.logger,
            detector: this.detector,
            projectRoot: this.projectRoot,
            watchPaths: options.watchPaths,
            ignorePaths: options.ignorePaths
        });
        
        this.setupEventHandlers();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Hardware key events
        this.detector.on('connected', (port) => {
            this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.info('🔓 HARDWARE KEY CONNECTED');
            this.logger.info(`   Port: ${port.path}`);
            this.logger.info(`   Manufacturer: ${port.manufacturer || 'N/A'}`);
            this.logger.info('   File modifications are now ALLOWED');
            this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        this.detector.on('disconnected', () => {
            this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.warn('🔒 HARDWARE KEY DISCONNECTED');
            this.logger.warn('   All file modifications are now BLOCKED');
            this.logger.warn('   Insert hardware key to enable editing');
            this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        // File guard events
        this.fileGuard.on('violation', (violation) => {
            // Could trigger additional alerts here
            // (e.g., Discord notification, email, etc.)
        });

        this.fileGuard.on('authorized', (operation) => {
            this.logger.info(`✅ Authorized ${operation.type}: ${operation.path}`);
        });
    }

    /**
     * Start the protection system
     */
    async start(options = {}) {
        this.logger.info('🚀 Starting Hardware Key Protection System...');
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Start hardware key detector
        await this.detector.start();
        
        // Create initial backups
        this.logger.info('');
        const clearOldBackups = options.clearOldBackups !== undefined ? options.clearOldBackups : true;
        await this.fileGuard.createAllBackups(clearOldBackups);
        
        // Start file guard
        this.logger.info('');
        await this.fileGuard.start();
        
        this.logger.info('');
        this.logger.info('🎉 Hardware Key Protection System is now active!');
        this.logger.info('');
        
        // Show initial status
        this.showStatus();
    }

    /**
     * Stop the protection system
     */
    async stop() {
        this.logger.info('Stopping Hardware Key Protection System...');
        
        this.detector.stop();
        await this.fileGuard.stop();
        
        this.logger.info('Protection system stopped');
    }

    /**
     * Show current status
     */
    showStatus() {
        const detectorStatus = this.detector.getStatus();
        const guardStatus = this.fileGuard.getStatus();
        
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info('📊 SYSTEM STATUS');
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info(`Hardware Key: ${detectorStatus.connected ? '🔓 Connected' : '🔒 Disconnected'}`);
        if (detectorStatus.port) {
            this.logger.info(`   Port: ${detectorStatus.port.path}`);
        }
        this.logger.info(`File Guard: ${guardStatus.enabled ? '✅ Active' : '❌ Inactive'}`);
        this.logger.info(`Protection Level: ${guardStatus.protectionActive ? '🛡️  ENFORCED' : '⚠️  Monitoring Only'}`);
        this.logger.info(`Violations Blocked: ${guardStatus.violationCount}`);
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    /**
     * List all available serial ports (debugging)
     */
    async listPorts() {
        return await this.detector.listAllPorts();
    }

    /**
     * Wait for hardware key connection
     */
    async waitForKey(timeout = 30000) {
        return await this.detector.waitForConnection(timeout);
    }

    /**
     * Get current status object
     */
    getStatus() {
        return {
            detector: this.detector.getStatus(),
            fileGuard: this.fileGuard.getStatus()
        };
    }
}

module.exports = HardwareKeyProtection;
