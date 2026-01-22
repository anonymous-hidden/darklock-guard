const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');

/**
 * File Guard - Prevents file modifications when hardware key is not present
 */
class FileGuard extends EventEmitter {
    constructor(options = {}) {
        super();
        this.logger = options.logger || console;
        this.detector = options.detector; // PicoDetector instance
        this.projectRoot = options.projectRoot || process.cwd();
        
        // Files/folders to monitor
        this.watchPaths = options.watchPaths || [
            'src/**/*',
            'darklock/**/*',
            'file-protection/**/*',
            'scripts/**/*',
            'security-suite/**/*',
            'config.json',
            'package.json',
            '.env'
        ];
        
        // Files/folders to exclude
        this.ignorePaths = options.ignorePaths || [
            '**/node_modules/**',
            '**/logs/**',
            '**/temp/**',
            '**/backups/**',
            '**/data/**',
            '**/.git/**'
        ];
        
        this.watcher = null;
        this.enabled = false;
        this.violationCount = 0;
        this.blockedOperations = [];
    }

    /**
     * Start the file guard
     */
    async start() {
        if (!this.detector) {
            throw new Error('PicoDetector instance required');
        }

        this.logger.info('🛡️  Starting File Guard...');
        
        // Set up file watcher
        const watchPaths = this.watchPaths.map(p => 
            path.join(this.projectRoot, p)
        );
        
        this.watcher = chokidar.watch(watchPaths, {
            ignored: this.ignorePaths,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        // Monitor file system events
        this.watcher
            .on('add', (filePath) => this.handleFileEvent('add', filePath))
            .on('change', (filePath) => this.handleFileEvent('change', filePath))
            .on('unlink', (filePath) => this.handleFileEvent('delete', filePath))
            .on('error', (error) => this.logger.error('File watcher error:', error));

        this.enabled = true;
        this.logger.info('✅ File Guard is active');
        this.logStatus();
    }

    /**
     * Handle file system events
     */
    handleFileEvent(eventType, filePath) {
        const relativePath = path.relative(this.projectRoot, filePath);
        
        // Check if hardware key is connected
        if (!this.detector.isConnected) {
            this.violationCount++;
            const violation = {
                type: eventType,
                path: relativePath,
                timestamp: new Date().toISOString(),
                blocked: true
            };
            
            this.blockedOperations.push(violation);
            
            this.logger.warn('🚨 UNAUTHORIZED FILE MODIFICATION DETECTED!');
            this.logger.warn(`   Event: ${eventType.toUpperCase()}`);
            this.logger.warn(`   File: ${relativePath}`);
            this.logger.warn(`   Status: BLOCKED - Hardware key not connected`);
            
            this.emit('violation', violation);
            
            // Attempt to revert change (for modifications)
            if (eventType === 'change') {
                this.attemptRevert(filePath);
            }
        } else {
            // Hardware key is connected, allow operation
            const operation = {
                type: eventType,
                path: relativePath,
                timestamp: new Date().toISOString(),
                authorized: true
            };
            
            this.emit('authorized', operation);
        }
    }

    /**
     * Attempt to revert unauthorized file changes
     */
    attemptRevert(filePath) {
        try {
            // Check if we have a backup
            const backupPath = this.getBackupPath(filePath);
            
            if (fs.existsSync(backupPath)) {
                this.logger.info(`🔄 Attempting to restore from backup: ${path.basename(filePath)}`);
                fs.copyFileSync(backupPath, filePath);
                this.logger.info('✅ File restored from backup');
            } else {
                this.logger.warn('⚠️  No backup available for automatic restoration');
                this.logger.warn('   Manual intervention may be required');
            }
        } catch (error) {
            this.logger.error('Error reverting file:', error.message);
        }
    }

    /**
     * Get backup path for a file
     */
    getBackupPath(filePath) {
        const relativePath = path.relative(this.projectRoot, filePath);
        const backupDir = path.join(this.projectRoot, 'file-protection', 'backups', 'hardware-key');
        return path.join(backupDir, relativePath);
    }

    /**
     * Create backup of current file state
     */
    async createBackup(filePath) {
        try {
            const backupPath = this.getBackupPath(filePath);
            const backupDir = path.dirname(backupPath);
            
            // Create backup directory if it doesn't exist
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Copy file to backup location
            if (fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, backupPath);
                this.logger.info(`💾 Backup created: ${path.relative(this.projectRoot, filePath)}`);
            }
        } catch (error) {
            this.logger.error('Error creating backup:', error.message);
        }
    }

    /**
     * Create backups of all monitored files
     */
    async createAllBackups(clearOld = false) {
        if (clearOld) {
            this.logger.info('🧹 Clearing old backups...');
            await this.clearBackups();
        }
        
        this.logger.info('💾 Creating backups of all protected files...');
        
        const watchPaths = this.watchPaths.map(p => 
            path.join(this.projectRoot, p)
        );
        
        const filesToBackup = [];
        
        for (const watchPath of watchPaths) {
            if (!watchPath.includes('*')) {
                // Single file
                if (fs.existsSync(watchPath) && fs.statSync(watchPath).isFile()) {
                    filesToBackup.push(watchPath);
                }
            } else {
                // Pattern - use glob to find files
                const globPattern = watchPath;
                // For simplicity, we'll scan directories manually
                const dir = watchPath.split('*')[0];
                if (fs.existsSync(dir)) {
                    this.scanDirectory(dir, filesToBackup);
                }
            }
        }
        
        for (const file of filesToBackup) {
            await this.createBackup(file);
        }
        
        this.logger.info(`✅ Created ${filesToBackup.length} backups`);
    }

    /**
     * Clear all backups in the hardware-key backup directory
     */
    async clearBackups() {
        const backupDir = path.join(this.projectRoot, 'file-protection', 'backups', 'hardware-key');
        
        if (fs.existsSync(backupDir)) {
            try {
                // Recursively delete backup directory
                this.deleteDirectory(backupDir);
                this.logger.info('✅ Old backups cleared');
            } catch (error) {
                this.logger.error('Error clearing backups:', error.message);
            }
        }
    }

    /**
     * Recursively delete a directory
     */
    deleteDirectory(dir) {
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach((file) => {
                const filePath = path.join(dir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    this.deleteDirectory(filePath);
                } else {
                    fs.unlinkSync(filePath);
                }
            });
            fs.rmdirSync(dir);
        }
    }

    /**
     * Recursively scan directory for files
     */
    scanDirectory(dir, fileList) {
        try {
            const items = fs.readdirSync(dir);
            
            for (const item of items) {
                const itemPath = path.join(dir, item);
                const stat = fs.statSync(itemPath);
                
                // Check if should be ignored
                if (this.shouldIgnore(itemPath)) continue;
                
                if (stat.isDirectory()) {
                    this.scanDirectory(itemPath, fileList);
                } else {
                    fileList.push(itemPath);
                }
            }
        } catch (error) {
            // Silently skip directories we can't access
        }
    }

    /**
     * Check if path should be ignored
     */
    shouldIgnore(filePath) {
        const relativePath = path.relative(this.projectRoot, filePath);
        
        for (const ignorePattern of this.ignorePaths) {
            const pattern = ignorePattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
            const regex = new RegExp(pattern);
            if (regex.test(relativePath)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Stop the file guard
     */
    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.enabled = false;
        this.logger.info('File Guard stopped');
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            enabled: this.enabled,
            hardwareKeyConnected: this.detector?.isConnected || false,
            violationCount: this.violationCount,
            recentViolations: this.blockedOperations.slice(-10),
            watchedPaths: this.watchPaths.length,
            protectionActive: this.enabled && !this.detector?.isConnected
        };
    }

    /**
     * Log current status
     */
    logStatus() {
        const status = this.getStatus();
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info('🔐 FILE GUARD STATUS');
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info(`Protection: ${status.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
        this.logger.info(`Hardware Key: ${status.hardwareKeyConnected ? '🔓 CONNECTED' : '🔒 DISCONNECTED'}`);
        this.logger.info(`Violations Blocked: ${status.violationCount}`);
        this.logger.info(`Monitored Paths: ${status.watchedPaths}`);
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    /**
     * Clear violation history
     */
    clearViolations() {
        this.violationCount = 0;
        this.blockedOperations = [];
        this.logger.info('Violation history cleared');
    }
}

module.exports = FileGuard;
