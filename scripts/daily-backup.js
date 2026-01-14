/**
 * Daily Database Backup Script
 * 
 * Features:
 * - Creates encrypted backups of SQLite database
 * - Keeps last 14 backups (2 weeks retention)
 * - AES-256 encryption for security
 * - Automated cleanup of old backups
 * - Can be run via cron or node-cron
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

class DatabaseBackupService {
    constructor(options = {}) {
        this.dbPath = options.dbPath || path.join(__dirname, '../data/discord_bot.db');
        this.backupDir = options.backupDir || path.join(__dirname, '../backups/database');
        this.encryptionKey = options.encryptionKey || process.env.BACKUP_ENCRYPTION_KEY;
        this.retentionDays = options.retentionDays || 14;
        this.compress = options.compress !== false; // Enable by default
        
        // Create backup directory if it doesn't exist
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    /**
     * Create a timestamped backup of the database
     */
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `db-backup-${timestamp}.db`;
        const backupPath = path.join(this.backupDir, backupName);

        try {
            console.log(`[Backup] Starting database backup...`);
            console.log(`[Backup] Source: ${this.dbPath}`);
            console.log(`[Backup] Destination: ${backupPath}`);

            // Check if source database exists
            if (!fs.existsSync(this.dbPath)) {
                throw new Error(`Database file not found: ${this.dbPath}`);
            }

            // Copy database file
            await copyFile(this.dbPath, backupPath);
            console.log(`[Backup] ✅ Database copied successfully`);

            // Get file size
            const stats = await stat(backupPath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`[Backup] File size: ${fileSizeMB} MB`);

            // Encrypt if encryption key is provided
            if (this.encryptionKey) {
                const encryptedPath = await this.encryptBackup(backupPath);
                
                // Delete unencrypted backup
                await unlink(backupPath);
                console.log(`[Backup] ✅ Backup encrypted and original deleted`);
                
                return {
                    success: true,
                    path: encryptedPath,
                    size: fileSizeMB,
                    encrypted: true,
                    timestamp: new Date().toISOString()
                };
            }

            return {
                success: true,
                path: backupPath,
                size: fileSizeMB,
                encrypted: false,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error(`[Backup] ❌ Backup failed:`, error.message);
            throw error;
        }
    }

    /**
     * Encrypt a backup file using AES-256
     */
    async encryptBackup(filePath) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not provided');
        }

        const encryptedPath = `${filePath}.enc`;
        
        try {
            // Read the backup file
            const data = await readFile(filePath);

            // Generate encryption key and IV
            const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
            const iv = crypto.randomBytes(16);

            // Create cipher
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            
            // Encrypt the data
            const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

            // Prepend IV to encrypted data (needed for decryption)
            const result = Buffer.concat([iv, encrypted]);

            // Write encrypted file
            await writeFile(encryptedPath, result);

            console.log(`[Backup] Encrypted backup created: ${encryptedPath}`);
            return encryptedPath;

        } catch (error) {
            console.error(`[Backup] Encryption failed:`, error.message);
            throw error;
        }
    }

    /**
     * Decrypt a backup file
     */
    async decryptBackup(encryptedPath, outputPath) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not provided');
        }

        try {
            // Read encrypted file
            const data = await readFile(encryptedPath);

            // Extract IV (first 16 bytes)
            const iv = data.slice(0, 16);
            const encrypted = data.slice(16);

            // Generate key
            const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);

            // Create decipher
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

            // Decrypt
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

            // Write decrypted file
            await writeFile(outputPath, decrypted);

            console.log(`[Backup] Decrypted backup created: ${outputPath}`);
            return outputPath;

        } catch (error) {
            console.error(`[Backup] Decryption failed:`, error.message);
            throw error;
        }
    }

    /**
     * Clean up old backups (keep only last N days)
     */
    async cleanupOldBackups() {
        try {
            console.log(`[Backup] Cleaning up backups older than ${this.retentionDays} days...`);

            const files = await readdir(this.backupDir);
            const backupFiles = files.filter(f => f.startsWith('db-backup-'));

            if (backupFiles.length === 0) {
                console.log(`[Backup] No backup files found`);
                return { deleted: 0 };
            }

            const now = Date.now();
            const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
            let deletedCount = 0;

            for (const file of backupFiles) {
                const filePath = path.join(this.backupDir, file);
                const stats = await stat(filePath);
                const age = now - stats.mtimeMs;

                if (age > retentionMs) {
                    await unlink(filePath);
                    console.log(`[Backup] 🗑️  Deleted old backup: ${file}`);
                    deletedCount++;
                }
            }

            console.log(`[Backup] ✅ Cleanup complete. Deleted ${deletedCount} old backup(s)`);
            return { deleted: deletedCount };

        } catch (error) {
            console.error(`[Backup] Cleanup failed:`, error.message);
            throw error;
        }
    }

    /**
     * List all available backups
     */
    async listBackups() {
        try {
            const files = await readdir(this.backupDir);
            const backupFiles = files.filter(f => f.startsWith('db-backup-'));

            const backups = [];
            for (const file of backupFiles) {
                const filePath = path.join(this.backupDir, file);
                const stats = await stat(filePath);
                
                backups.push({
                    name: file,
                    path: filePath,
                    size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                    created: stats.mtime,
                    encrypted: file.endsWith('.enc')
                });
            }

            // Sort by creation date (newest first)
            backups.sort((a, b) => b.created - a.created);

            return backups;

        } catch (error) {
            console.error(`[Backup] Failed to list backups:`, error.message);
            throw error;
        }
    }

    /**
     * Restore a backup
     */
    async restoreBackup(backupPath) {
        try {
            console.log(`[Backup] Restoring backup from: ${backupPath}`);

            // Check if backup exists
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Backup file not found: ${backupPath}`);
            }

            // If encrypted, decrypt first
            let sourceFile = backupPath;
            if (backupPath.endsWith('.enc')) {
                const tempPath = backupPath.replace('.enc', '.temp.db');
                await this.decryptBackup(backupPath, tempPath);
                sourceFile = tempPath;
            }

            // Create backup of current database before restoring
            const currentBackupPath = this.dbPath + '.before-restore.' + Date.now();
            if (fs.existsSync(this.dbPath)) {
                await copyFile(this.dbPath, currentBackupPath);
                console.log(`[Backup] Current database backed up to: ${currentBackupPath}`);
            }

            // Restore the backup
            await copyFile(sourceFile, this.dbPath);
            console.log(`[Backup] ✅ Backup restored successfully`);

            // Clean up temp file if we decrypted
            if (sourceFile !== backupPath) {
                await unlink(sourceFile);
            }

            return { success: true, restoredFrom: backupPath };

        } catch (error) {
            console.error(`[Backup] Restore failed:`, error.message);
            throw error;
        }
    }

    /**
     * Run backup with cleanup
     */
    async run() {
        try {
            console.log('\n' + '='.repeat(60));
            console.log('🔄 Starting Daily Backup Job');
            console.log('='.repeat(60));

            // Create backup
            const result = await this.createBackup();
            console.log(`[Backup] ✅ Backup created successfully`);
            console.log(`[Backup] Path: ${result.path}`);
            console.log(`[Backup] Size: ${result.size} MB`);
            console.log(`[Backup] Encrypted: ${result.encrypted}`);

            // Cleanup old backups
            await this.cleanupOldBackups();

            // List remaining backups
            const backups = await this.listBackups();
            console.log(`[Backup] Total backups retained: ${backups.length}`);

            console.log('='.repeat(60));
            console.log('✅ Backup Job Complete');
            console.log('='.repeat(60) + '\n');

            return { success: true, backup: result, totalBackups: backups.length };

        } catch (error) {
            console.error('❌ Backup job failed:', error);
            return { success: false, error: error.message };
        }
    }
}

// ============================================================================
// CLI Usage
// ============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];

    const backup = new DatabaseBackupService({
        encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || 'default-key-change-this'
    });

    (async () => {
        try {
            switch (command) {
                case 'create':
                    await backup.run();
                    break;

                case 'list':
                    const backups = await backup.listBackups();
                    console.log('\n📁 Available Backups:');
                    backups.forEach((b, i) => {
                        console.log(`  ${i + 1}. ${b.name}`);
                        console.log(`     Size: ${b.size}, Created: ${b.created.toLocaleString()}`);
                        console.log(`     Encrypted: ${b.encrypted ? 'Yes' : 'No'}`);
                    });
                    break;

                case 'cleanup':
                    await backup.cleanupOldBackups();
                    break;

                case 'restore':
                    const backupPath = args[1];
                    if (!backupPath) {
                        console.error('Usage: node daily-backup.js restore <backup-file-path>');
                        process.exit(1);
                    }
                    await backup.restoreBackup(backupPath);
                    break;

                default:
                    console.log('Usage:');
                    console.log('  node daily-backup.js create   - Create a new backup');
                    console.log('  node daily-backup.js list     - List all backups');
                    console.log('  node daily-backup.js cleanup  - Clean up old backups');
                    console.log('  node daily-backup.js restore <path> - Restore a backup');
                    process.exit(0);
            }
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = DatabaseBackupService;
