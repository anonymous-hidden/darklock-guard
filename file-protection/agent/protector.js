const fs = require('fs');
const path = require('path');
const Hasher = require('./hasher');
const { PATHS } = require('./constants');

class Protector {
    constructor(logger = console) {
        this.logger = logger;
        this.backupDir = PATHS.backups;
        this.quarantineDir = PATHS.quarantine;
        this.logDir = PATHS.logs;
        this.ensureDirectories();
    }

    ensureDirectories() {
        [this.backupDir, this.quarantineDir, this.logDir].forEach((dir) => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    createBackup(filePath) {
        if (!fs.existsSync(filePath)) return null;
        const name = path.basename(filePath);
        const backupName = `${name}.${Date.now()}.backup`;
        const backupPath = path.join(this.backupDir, backupName);
        fs.copyFileSync(filePath, backupPath);
        return backupPath;
    }

    getLatestBackup(filePath) {
        const name = path.basename(filePath);
        if (!fs.existsSync(this.backupDir)) return null;
        const backups = fs.readdirSync(this.backupDir)
            .filter(f => f.startsWith(name) && f.endsWith('.backup'))
            .map(f => ({
                path: path.join(this.backupDir, f),
                timestamp: parseInt(f.split('.').slice(-2)[0], 10)
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
        return backups.length > 0 ? backups[0].path : null;
    }

    quarantine(filePath, actualHash) {
        try {
            const name = path.basename(filePath || 'unknown');
            const quarantineName = `${name}.${Date.now()}.evidence`;
            const dest = path.join(this.quarantineDir, quarantineName);

            if (filePath && fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, dest);
            } else {
                fs.writeFileSync(dest, `Evidence placeholder for missing file. Actual hash: ${actualHash || 'n/a'}`);
            }
            this.logger.error(`[Protector] Quarantined evidence at ${dest}`);
            return dest;
        } catch (err) {
            this.logger.error('[Protector] Failed to quarantine file', err.message || err);
            return null;
        }
    }

    restore(filePath, expectedHash) {
        try {
            const backup = this.getLatestBackup(filePath);
            if (!backup) {
                this.logger.error(`[Protector] No backup available for ${filePath}`);
                return false;
            }

            fs.copyFileSync(backup, filePath);
            const restoredHash = Hasher.hashFile(filePath);
            if (expectedHash && restoredHash !== expectedHash) {
                this.logger.error(`[Protector] Backup hash mismatch after restore for ${filePath}`);
                return false;
            }

            this.logger.log(`[Protector] Restored ${filePath} from backup`);
            return true;
        } catch (err) {
            this.logger.error(`[Protector] Restore failed for ${filePath}:`, err.message || err);
            return false;
        }
    }

    logEvent(payload) {
        try {
            const fileName = `tamper-${new Date().toISOString().split('T')[0]}.log`;
            const logFile = path.join(this.logDir, fileName);
            const line = JSON.stringify({
                ...payload,
                recordedAt: new Date().toISOString()
            });
            fs.appendFileSync(logFile, `${line}\n`);
        } catch (err) {
            this.logger.error('[Protector] Failed to log tamper event', err.message || err);
        }
    }
}

module.exports = Protector;
