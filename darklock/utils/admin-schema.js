/**
 * Darklock Admin Dashboard - Database Schema
 * 
 * Tables:
 * - admins (existing)
 * - admin_audit_logs
 * - announcements
 * - feature_flags
 * - platform_settings
 * - service_status
 * - content_blocks
 * - changelogs
 */

const db = require('./database');

/**
 * Initialize all admin dashboard tables
 */
async function initializeAdminSchema() {
    console.log('[Admin Schema] Initializing admin dashboard tables...');

    // ========================================================================
    // ADMINS TABLE (extended with RBAC)
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'editor')),
            display_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login TEXT,
            last_login_ip TEXT,
            active INTEGER DEFAULT 1,
            require_2fa INTEGER DEFAULT 0
        )
    `);

    // ========================================================================
    // ADMIN AUDIT LOGS - Track every admin action
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id TEXT PRIMARY KEY,
            admin_id TEXT NOT NULL,
            admin_email TEXT,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            old_value TEXT,
            new_value TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (admin_id) REFERENCES admins(id)
        )
    `);

    // ========================================================================
    // ANNOUNCEMENTS - Global and per-app announcements
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS announcements (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('info', 'warning', 'critical')),
            scope TEXT NOT NULL DEFAULT 'global',
            app_id TEXT,
            is_active INTEGER DEFAULT 1,
            is_dismissible INTEGER DEFAULT 1,
            start_at TEXT,
            end_at TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES admins(id)
        )
    `);

    // ========================================================================
    // FEATURE FLAGS - Toggle features without redeploying
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS feature_flags (
            id TEXT PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            is_enabled INTEGER DEFAULT 0,
            is_kill_switch INTEGER DEFAULT 0,
            rollout_percentage INTEGER DEFAULT 100,
            allowed_users TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES admins(id)
        )
    `);

    // ========================================================================
    // PLATFORM SETTINGS - Key-value config store
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS platform_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            value_type TEXT NOT NULL DEFAULT 'string',
            description TEXT,
            is_public INTEGER DEFAULT 0,
            updated_by TEXT,
            updated_at TEXT NOT NULL
        )
    `);

    // ========================================================================
    // SERVICE STATUS - Per-service health tracking
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS service_status (
            id TEXT PRIMARY KEY,
            service_name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('online', 'degraded', 'offline', 'maintenance')),
            status_message TEXT,
            last_checked TEXT,
            is_visible INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            updated_by TEXT,
            updated_at TEXT NOT NULL
        )
    `);

    // ========================================================================
    // CONTENT BLOCKS - Editable homepage/page content
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS content_blocks (
            id TEXT PRIMARY KEY,
            block_key TEXT UNIQUE NOT NULL,
            title TEXT,
            content TEXT NOT NULL,
            content_type TEXT DEFAULT 'markdown',
            page TEXT DEFAULT 'home',
            is_active INTEGER DEFAULT 1,
            updated_by TEXT,
            updated_at TEXT NOT NULL
        )
    `);

    // ========================================================================
    // CHANGELOGS - Version notes and release history
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS changelogs (
            id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            release_type TEXT CHECK(release_type IN ('major', 'minor', 'patch', 'hotfix')),
            is_published INTEGER DEFAULT 0,
            published_at TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES admins(id)
        )
    `);

    // ========================================================================
    // ERROR LOGS - Track application errors
    // ========================================================================
    await db.run(`
        CREATE TABLE IF NOT EXISTS error_logs (
            id TEXT PRIMARY KEY,
            error_type TEXT NOT NULL,
            error_message TEXT NOT NULL,
            error_stack TEXT,
            source TEXT,
            user_id TEXT,
            request_url TEXT,
            request_method TEXT,
            ip_address TEXT,
            user_agent TEXT,
            severity TEXT DEFAULT 'error' CHECK(severity IN ('debug', 'info', 'warning', 'error', 'critical')),
            created_at TEXT NOT NULL
        )
    `);

    // ========================================================================
    // MIGRATIONS - Add missing columns to existing tables
    // ========================================================================
    try {
        await db.run(`ALTER TABLE announcements ADD COLUMN is_active INTEGER DEFAULT 1`);
        console.log('[Admin Schema] ✅ Added is_active column to announcements table');
    } catch (e) {
        // Column already exists, ignore
    }
    try {
        await db.run(`ALTER TABLE announcements ADD COLUMN is_dismissible INTEGER DEFAULT 1`);
        console.log('[Admin Schema] ✅ Added is_dismissible column to announcements table');
    } catch (e) {
        // Column already exists, ignore
    }
    try {
        await db.run(`ALTER TABLE announcements ADD COLUMN start_at TEXT`);
        console.log('[Admin Schema] ✅ Added start_at column to announcements table');
    } catch (e) {
        // Column already exists, ignore
    }
    try {
        await db.run(`ALTER TABLE announcements ADD COLUMN end_at TEXT`);
        console.log('[Admin Schema] ✅ Added end_at column to announcements table');
    } catch (e) {
        // Column already exists, ignore
    }

    // ========================================================================
    // INDEXES - Wrap in try/catch to handle old table schemas gracefully
    // ========================================================================
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_logs(admin_id)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_logs(action)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, start_at, end_at)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_changelogs_version ON changelogs(version)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at)`); } catch (e) { /* Ignore errors from old schemas */ }
    try { await db.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity)`); } catch (e) { /* Ignore errors from old schemas */ }

    // ========================================================================
    // DEFAULT DATA - Wrap in try/catch to handle old table schemas
    // ========================================================================
    try {
        await insertDefaultData();
    } catch (e) {
        console.log('[Admin Schema] ⚠️  Warning: Could not insert default data (old table schema)');
    }

    console.log('[Admin Schema] ✅ Admin dashboard tables initialized');
}

/**
 * Insert default platform settings and services
 */
async function insertDefaultData() {
    const now = new Date().toISOString();

    // Default platform settings
    const defaultSettings = [
        { key: 'maintenance_mode', value: 'false', value_type: 'boolean', description: 'Enable maintenance mode', is_public: 1 },
        { key: 'maintenance_message', value: 'We are currently performing maintenance. Please check back soon.', value_type: 'string', description: 'Maintenance mode message', is_public: 1 },
        { key: 'platform_name', value: 'Darklock', value_type: 'string', description: 'Platform display name', is_public: 1 },
        { key: 'platform_version', value: '1.0.0', value_type: 'string', description: 'Current platform version', is_public: 1 },
        { key: 'registration_enabled', value: 'true', value_type: 'boolean', description: 'Allow new user registrations', is_public: 0 },
        { key: 'max_sessions_per_user', value: '5', value_type: 'number', description: 'Maximum concurrent sessions per user', is_public: 0 },
    ];

    for (const setting of defaultSettings) {
        await db.run(`
            INSERT OR IGNORE INTO platform_settings (key, value, value_type, description, is_public, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [setting.key, setting.value, setting.value_type, setting.description, setting.is_public, now]);
    }

    // Default services for status page
    const defaultServices = [
        { name: 'api', display_name: 'API', status: 'online', sort_order: 1 },
        { name: 'dashboard', display_name: 'Dashboard', status: 'online', sort_order: 2 },
        { name: 'authentication', display_name: 'Authentication', status: 'online', sort_order: 3 },
        { name: 'database', display_name: 'Database', status: 'online', sort_order: 4 },
        { name: 'darklock_guard', display_name: 'Darklock Guard', status: 'online', sort_order: 5 },
    ];

    for (const service of defaultServices) {
        const id = require('crypto').randomUUID();
        await db.run(`
            INSERT OR IGNORE INTO service_status (id, service_name, display_name, status, sort_order, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, service.name, service.display_name, service.status, service.sort_order, now]);
    }

    // Default feature flags
    const defaultFlags = [
        { key: 'new_dashboard', name: 'New Dashboard UI', description: 'Enable redesigned dashboard', is_enabled: 0 },
        { key: 'beta_features', name: 'Beta Features', description: 'Show beta features to users', is_enabled: 0 },
        { key: 'advanced_security', name: 'Advanced Security', description: 'Enable advanced security features', is_enabled: 1 },
        { key: 'api_v2', name: 'API v2', description: 'Enable API version 2 endpoints', is_enabled: 0 },
        { key: 'emergency_lockdown', name: 'Emergency Lockdown', description: 'KILL SWITCH: Disable all non-essential features', is_enabled: 0, is_kill_switch: 1 },
    ];

    for (const flag of defaultFlags) {
        const id = require('crypto').randomUUID();
        await db.run(`
            INSERT OR IGNORE INTO feature_flags (id, key, name, description, is_enabled, is_kill_switch, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'system', ?, ?)
        `, [id, flag.key, flag.name, flag.description, flag.is_enabled ? 1 : 0, flag.is_kill_switch ? 1 : 0, now, now]);
    }
}

module.exports = {
    initializeAdminSchema
};
