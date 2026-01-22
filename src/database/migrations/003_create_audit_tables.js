/**
 * Migration 003: Create Logging & Audit Tables
 * Creates comprehensive audit logging and forensics tables
 */

module.exports = {
    description: 'Create audit logging and forensics tables',

    async up(db) {
        // Comprehensive audit log table
        await db.run(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_category TEXT,
                executor_id TEXT,
                executor_tag TEXT,
                target_type TEXT,
                target_id TEXT,
                target_name TEXT,
                changes TEXT,
                reason TEXT,
                before_state TEXT,
                after_state TEXT,
                can_replay INTEGER DEFAULT 0,
                device_fingerprint TEXT,
                ip_hash TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Incidents table for tracking security events
        await db.run(`
            CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                incident_type TEXT NOT NULL,
                severity TEXT DEFAULT 'medium',
                user_id TEXT,
                description TEXT,
                evidence TEXT,
                resolved INTEGER DEFAULT 0,
                resolved_by TEXT,
                resolved_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Verification records
        await db.run(`
            CREATE TABLE IF NOT EXISTS verification_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                verification_type TEXT,
                status TEXT DEFAULT 'pending',
                result TEXT,
                notes TEXT,
                verified_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Dashboard access control
        await db.run(`
            CREATE TABLE IF NOT EXISTS dashboard_access (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                granted_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS dashboard_role_access (
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                granted_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, role_id)
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS dashboard_access_codes (
                code TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_by TEXT,
                redeemed_by TEXT,
                redeemed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Indexes for audit tables
        await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_guild ON audit_logs(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON audit_logs(event_type)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_executor ON audit_logs(executor_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_guild ON incidents(guild_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_verification_records_guild ON verification_records(guild_id)`);
    }
};
