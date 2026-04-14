/**
 * Log Rotation & Cleanup Utility
 * ================================
 * Automatically cleans old log files and trims the database log tables.
 * Runs on startup and then every INTERVAL_HOURS.
 *
 * Config (environment variables):
 *   LOG_RETENTION_DAYS  — Delete .log files older than this (default: 7)
 *   DB_LOG_RETENTION_DAYS — Prune database log rows older than this (default: 30)
 *   LOG_CLEANUP_INTERVAL_HOURS — How often to run (default: 24)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

const DEFAULTS = {
    LOG_RETENTION_DAYS: 7,
    DB_LOG_RETENTION_DAYS: 30,
    BACKUP_RETENTION_DAYS: 30,
    INTERVAL_HOURS: 24,
};

class LogRotation {
    constructor(bot) {
        this.bot = bot;
        this.db = bot?.database ?? null;
        this.timer = null;

        this.logRetentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || DEFAULTS.LOG_RETENTION_DAYS;
        this.dbLogRetentionDays = parseInt(process.env.DB_LOG_RETENTION_DAYS) || DEFAULTS.DB_LOG_RETENTION_DAYS;
        this.backupRetentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || DEFAULTS.BACKUP_RETENTION_DAYS;
        this.intervalHours = parseInt(process.env.LOG_CLEANUP_INTERVAL_HOURS) || DEFAULTS.INTERVAL_HOURS;
    }

    /**
     * Start the rotation scheduler. Runs cleanup immediately, then on interval.
     */
    start() {
        console.log(`[LogRotation] Started — retention: ${this.logRetentionDays}d logs, ${this.dbLogRetentionDays}d db rows, interval: ${this.intervalHours}h`);
        this.runCleanup();
        this.timer = setInterval(() => this.runCleanup(), this.intervalHours * 3600 * 1000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Run all cleanup tasks
     */
    async runCleanup() {
        const stats = { logsDeleted: 0, logsCompressed: 0, dbRowsPruned: 0, backupsDeleted: 0, bytesFreed: 0 };

        try {
            this._cleanLogFiles(stats);
            this._cleanBackups(stats);
            await this._pruneDbLogs(stats);

            if (stats.logsDeleted || stats.logsCompressed || stats.dbRowsPruned || stats.backupsDeleted) {
                const freedMB = (stats.bytesFreed / (1024 * 1024)).toFixed(2);
                console.log(`[LogRotation] Cleanup: ${stats.logsDeleted} logs deleted, ${stats.logsCompressed} compressed, ${stats.dbRowsPruned} db rows pruned, ${stats.backupsDeleted} backups deleted (${freedMB} MB freed)`);
            }
        } catch (err) {
            console.error('[LogRotation] Cleanup error:', err.message);
        }

        return stats;
    }

    /**
     * Delete or compress old .log files
     */
    _cleanLogFiles(stats) {
        if (!fs.existsSync(LOGS_DIR)) return;

        const now = Date.now();
        const retentionMs = this.logRetentionDays * 86400 * 1000;
        const compressThresholdMs = Math.max(86400 * 1000, retentionMs - 3 * 86400 * 1000);

        for (const file of fs.readdirSync(LOGS_DIR)) {
            const filePath = path.join(LOGS_DIR, file);
            if (!fs.statSync(filePath).isFile()) continue;
            if (!file.endsWith('.log') && !file.endsWith('.log.gz')) continue;

            const age = now - fs.statSync(filePath).mtimeMs;

            if (age > retentionMs) {
                const size = fs.statSync(filePath).size;
                fs.unlinkSync(filePath);
                stats.logsDeleted++;
                stats.bytesFreed += size;
            } else if (age > compressThresholdMs && file.endsWith('.log')) {
                this._gzipFile(filePath);
                stats.logsCompressed++;
            }
        }
    }

    /**
     * Delete old backup files
     */
    _cleanBackups(stats) {
        if (!fs.existsSync(BACKUPS_DIR)) return;

        const now = Date.now();
        const jsonRetentionMs = this.backupRetentionDays * 86400 * 1000;
        const dbRetentionMs = 60 * 86400 * 1000; // 60 days for .db.gz

        for (const file of fs.readdirSync(BACKUPS_DIR)) {
            const filePath = path.join(BACKUPS_DIR, file);
            if (!fs.statSync(filePath).isFile()) continue;

            const age = now - fs.statSync(filePath).mtimeMs;
            let shouldDelete = false;

            if (file.endsWith('.json') && age > jsonRetentionMs) shouldDelete = true;
            if (file.endsWith('.db.gz') && age > dbRetentionMs) shouldDelete = true;

            if (shouldDelete) {
                const size = fs.statSync(filePath).size;
                fs.unlinkSync(filePath);
                stats.backupsDeleted++;
                stats.bytesFreed += size;
            }
        }
    }

    /**
     * Prune old rows from bot_logs and dashboard_audit tables
     */
    async _pruneDbLogs(stats) {
        if (!this.db) return;

        const cutoff = new Date(Date.now() - this.dbLogRetentionDays * 86400 * 1000).toISOString();

        try {
            const r1 = await this.db.run('DELETE FROM bot_logs WHERE created_at < ?', [cutoff]);
            const r2 = await this.db.run('DELETE FROM dashboard_audit WHERE created_at < ?', [cutoff]);
            stats.dbRowsPruned = (r1?.changes ?? 0) + (r2?.changes ?? 0);
        } catch (err) {
            // Tables might not exist yet
            if (!err.message.includes('no such table')) {
                console.error('[LogRotation] DB prune error:', err.message);
            }
        }
    }

    /**
     * Compress a file with gzip
     */
    _gzipFile(filePath) {
        try {
            const input = fs.readFileSync(filePath);
            const compressed = zlib.gzipSync(input);
            fs.writeFileSync(filePath + '.gz', compressed);
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error(`[LogRotation] Failed to compress ${path.basename(filePath)}:`, err.message);
        }
    }
}

module.exports = LogRotation;
