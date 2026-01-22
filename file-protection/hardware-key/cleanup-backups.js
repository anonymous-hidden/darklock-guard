#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Cleanup Script for Hardware Key Backups
 * Removes old backup files to free up disk space
 */

const projectRoot = path.join(__dirname, '..', '..');
const backupDir = path.join(projectRoot, 'file-protection', 'backups', 'hardware-key');

// Logger
const logger = {
    info: (...args) => console.log(`[${new Date().toISOString()}]`, ...args),
    warn: (...args) => console.warn(`[${new Date().toISOString()}]`, ...args),
    error: (...args) => console.error(`[${new Date().toISOString()}]`, ...args)
};

/**
 * Get directory size in bytes
 */
function getDirectorySize(dir) {
    let size = 0;
    
    if (!fs.existsSync(dir)) {
        return 0;
    }
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                size += getDirectorySize(itemPath);
            } else {
                size += stat.size;
            }
        }
    } catch (error) {
        // Silently skip directories we can't access
    }
    
    return size;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Count files in directory recursively
 */
function countFiles(dir) {
    let count = 0;
    
    if (!fs.existsSync(dir)) {
        return 0;
    }
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                count += countFiles(itemPath);
            } else {
                count++;
            }
        }
    } catch (error) {
        // Silently skip
    }
    
    return count;
}

/**
 * Delete directory recursively with progress
 */
function deleteDirectory(dir, progressCallback) {
    if (!fs.existsSync(dir)) {
        return;
    }
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const filePath = path.join(dir, item);
            
            try {
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    deleteDirectory(filePath, progressCallback);
                } else {
                    fs.unlinkSync(filePath);
                    if (progressCallback) {
                        progressCallback(filePath);
                    }
                }
            } catch (err) {
                // Try to force delete if first attempt fails
                try {
                    fs.chmodSync(filePath, 0o777);
                    if (fs.statSync(filePath).isDirectory()) {
                        deleteDirectory(filePath, progressCallback);
                    } else {
                        fs.unlinkSync(filePath);
                        if (progressCallback) {
                            progressCallback(filePath);
                        }
                    }
                } catch (err2) {
                    // Skip files/dirs we can't delete
                }
            }
        }
        
        // Try to remove the directory
        try {
            fs.rmdirSync(dir);
        } catch (err) {
            // Try with force
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch (err2) {
                // Directory might still have locked files, skip it
            }
        }
    } catch (error) {
        // If we can't read the directory, try to force remove it
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            // Skip directories we can't access
        }
    }
}

/**
 * Show loading spinner
 */
class LoadingSpinner {
    constructor(message) {
        this.message = message;
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.currentFrame = 0;
        this.interval = null;
        this.count = 0;
    }
    
    start() {
        this.interval = setInterval(() => {
            process.stdout.write(`\r${this.frames[this.currentFrame]} ${this.message}${this.count > 0 ? ` (${this.count} files)` : ''}`);
            this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        }, 80);
    }
    
    update(count) {
        this.count = count;
    }
    
    stop(finalMessage) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        process.stdout.write(`\r${finalMessage}\n`);
    }
}

/**
 * Main cleanup function
 */
async function cleanup() {
    console.log('🧹 Hardware Key Backup Cleanup Tool\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Check if backup directory exists
    if (!fs.existsSync(backupDir)) {
        logger.info('✨ No backups found - nothing to clean up!');
        logger.info(`   Backup directory: ${backupDir}`);
        return;
    }
    
    // Get current stats with loading indicator
    const scanSpinner = new LoadingSpinner('Scanning backup directory...');
    scanSpinner.start();
    
    const fileCount = countFiles(backupDir);
    const totalSize = getDirectorySize(backupDir);
    
    scanSpinner.stop('✓ Scan complete');
    logger.info('');
    logger.info('📊 Current Backup Statistics:');
    logger.info(`   Location: ${backupDir}`);
    logger.info(`   Files: ${fileCount.toLocaleString()}`);
    logger.info(`   Size: ${formatBytes(totalSize)}`);
    logger.info('');
    
    if (fileCount === 0) {
        logger.info('✨ Backup directory is already empty!');
        return;
    }
    
    // Confirm deletion
    logger.warn('⚠️  WARNING: This will DELETE all backup files!');
    logger.warn('   You will not be able to restore files from these backups.');
    logger.info('');
    logger.info('Press Ctrl+C now to cancel, or wait 5 seconds to continue...');
    
    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    logger.info('');
    
    try {
        const deleteSpinner = new LoadingSpinner('Deleting backups...');
        deleteSpinner.start();
        
        let deletedCount = 0;
        deleteDirectory(backupDir, (filePath) => {
            deletedCount++;
            if (deletedCount % 10 === 0) {
                deleteSpinner.update(deletedCount);
            }
        });
        
        deleteSpinner.stop(`✓ Deleted ${deletedCount.toLocaleString()} files`);
        logger.info('');
        logger.info('✅ Cleanup completed successfully!');
        logger.info(`   Freed up: ${formatBytes(totalSize)}`);
        logger.info(`   Removed: ${fileCount.toLocaleString()} files`);
    } catch (error) {
        logger.error('❌ Error during cleanup:', error.message);
        process.exit(1);
    }
}

// Run cleanup
cleanup().then(() => {
    console.log('');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
