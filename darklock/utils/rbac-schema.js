/**
 * Darklock Admin RBAC Schema
 * 
 * Role Hierarchy: Owner > Co-Owner > Admin > Moderator > Helper
 * 
 * SECURITY:
 * - Owner is the highest role, cannot be demoted
 * - Co-Owner can manage all except Owner
 * - Users & Roles + Permissions pages are OWNER/CO-OWNER ONLY
 * - Returns 404 (not 403) for hidden pages to prevent discovery
 */

const db = require('./database');
const crypto = require('crypto');

// Role hierarchy levels (higher = more power)
const ROLE_LEVELS = {
    owner: 100,
    'co-owner': 90,
    admin: 70,
    moderator: 50,
    helper: 30
};

const ROLE_NAMES = Object.keys(ROLE_LEVELS);

/**
 * Initialize all RBAC tables
 */
async function initializeRBACTables() {
    console.log('[RBAC] Initializing RBAC tables...');

    // Roles table
    await db.run(`
        CREATE TABLE IF NOT EXISTS roles (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            rank_level INTEGER NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#6b7280',
            is_system BOOLEAN DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Permissions table
    await db.run(`
        CREATE TABLE IF NOT EXISTS permissions (
            id TEXT PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            name TEXT,
            category TEXT NOT NULL,
            description TEXT,
            is_dangerous BOOLEAN DEFAULT 0,
            min_role_level INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Role-Permission mapping
    await db.run(`
        CREATE TABLE IF NOT EXISTS role_permissions (
            id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL,
            permission_id TEXT NOT NULL,
            granted_by TEXT,
            granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(role_id, permission_id),
            FOREIGN KEY (role_id) REFERENCES roles(id),
            FOREIGN KEY (permission_id) REFERENCES permissions(id)
        )
    `);

    // Admin users table (extends base admins table)
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id TEXT PRIMARY KEY,
            admin_id TEXT UNIQUE NOT NULL,
            role_id TEXT NOT NULL,
            display_name TEXT,
            allowed_scopes TEXT DEFAULT '["*"]',
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
            requires_2fa BOOLEAN DEFAULT 0,
            ip_allowlist TEXT,
            last_activity TEXT,
            invited_by TEXT,
            invited_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES admins(id),
            FOREIGN KEY (role_id) REFERENCES roles(id)
        )
    `);

    // User-specific permission overrides
    await db.run(`
        CREATE TABLE IF NOT EXISTS user_permission_overrides (
            id TEXT PRIMARY KEY,
            admin_user_id TEXT NOT NULL,
            permission_id TEXT NOT NULL,
            override_type TEXT NOT NULL CHECK(override_type IN ('allow', 'deny')),
            reason TEXT,
            set_by TEXT,
            set_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(admin_user_id, permission_id),
            FOREIGN KEY (admin_user_id) REFERENCES admin_users(id),
            FOREIGN KEY (permission_id) REFERENCES permissions(id)
        )
    `);

    // Enhanced audit log
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_audit_log_v2 (
            id TEXT PRIMARY KEY,
            admin_user_id TEXT,
            admin_email TEXT,
            action TEXT NOT NULL,
            scope TEXT,
            target_type TEXT,
            target_id TEXT,
            before_value TEXT,
            after_value TEXT,
            ip_address TEXT,
            user_agent TEXT,
            request_id TEXT,
            trace_id TEXT,
            severity TEXT DEFAULT 'info',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Maintenance state per scope
    await db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_state (
            id TEXT PRIMARY KEY,
            scope TEXT UNIQUE NOT NULL,
            enabled BOOLEAN DEFAULT 0,
            title TEXT DEFAULT 'Scheduled Maintenance',
            subtitle TEXT DEFAULT 'We''ll be back shortly',
            scheduled_start TEXT,
            scheduled_end TEXT,
            message TEXT,
            message_markdown TEXT,
            status_updates TEXT,
            admin_bypass BOOLEAN DEFAULT 1,
            bypass_ips TEXT,
            webhook_url TEXT,
            discord_announce BOOLEAN DEFAULT 0,
            updated_by TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Migration: Add new columns to maintenance_state if they don't exist
    try {
        await db.run(`ALTER TABLE maintenance_state ADD COLUMN title TEXT DEFAULT 'Scheduled Maintenance'`);
    } catch (e) { /* Column already exists */ }
    try {
        await db.run(`ALTER TABLE maintenance_state ADD COLUMN subtitle TEXT DEFAULT 'We''ll be back shortly'`);
    } catch (e) { /* Column already exists */ }
    try {
        await db.run(`ALTER TABLE maintenance_state ADD COLUMN status_updates TEXT`);
    } catch (e) { /* Column already exists */ }
    try {
        await db.run(`ALTER TABLE maintenance_state ADD COLUMN apply_localhost BOOLEAN DEFAULT 0`);
    } catch (e) { /* Column already exists */ }

    // Maintenance history
    await db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_history (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            action TEXT NOT NULL,
            enabled BOOLEAN,
            message TEXT,
            duration_seconds INTEGER,
            admin_id TEXT,
            admin_email TEXT,
            reason TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Service status tracking
    await db.run(`
        CREATE TABLE IF NOT EXISTS service_status (
            id TEXT PRIMARY KEY,
            service_name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            status TEXT DEFAULT 'operational',
            last_check TEXT,
            latency_ms INTEGER,
            error_rate REAL DEFAULT 0,
            uptime_percent REAL DEFAULT 100,
            metadata TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Incidents/Alerts
    await db.run(`
        CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            severity TEXT DEFAULT 'low',
            status TEXT DEFAULT 'open',
            affected_services TEXT,
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT,
            resolved_by TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Admin sessions for session management
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            id TEXT PRIMARY KEY,
            admin_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            device_info TEXT,
            is_active BOOLEAN DEFAULT 1,
            last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES admins(id)
        )
    `);

    // Security events
    await db.run(`
        CREATE TABLE IF NOT EXISTS security_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            severity TEXT DEFAULT 'medium',
            ip_address TEXT,
            user_agent TEXT,
            admin_id TEXT,
            details TEXT,
            resolved BOOLEAN DEFAULT 0,
            resolved_by TEXT,
            resolved_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Theme settings
    await db.run(`
        CREATE TABLE IF NOT EXISTS theme_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            theme_name TEXT DEFAULT 'darklock',
            auto_holiday_themes BOOLEAN DEFAULT 1,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Initialize default theme settings if not exists
    const themeExists = await db.get(`SELECT id FROM theme_settings WHERE id = 1`);
    if (!themeExists) {
        await db.run(`
            INSERT INTO theme_settings (id, theme_name, auto_holiday_themes)
            VALUES (1, 'darklock', 1)
        `);
    }

    // Create indexes
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log_v2(created_at)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log_v2(action)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_scope ON admin_audit_log_v2(scope)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`);

    // Seed default roles
    await seedDefaultRoles();

    // Seed default permissions
    await seedDefaultPermissions();

    // Seed default maintenance scopes
    await seedMaintenanceScopes();

    // Seed default services
    await seedDefaultServices();

    console.log('[RBAC] ✅ RBAC tables initialized');
}

/**
 * Seed default roles
 */
async function seedDefaultRoles() {
    const defaultRoles = [
        { name: 'owner', rank_level: 100, description: 'Full system access, cannot be demoted', color: '#dc2626', is_system: 1 },
        { name: 'co-owner', rank_level: 90, description: 'Nearly full access, manages admins', color: '#ea580c', is_system: 1 },
        { name: 'admin', rank_level: 70, description: 'Manages services and configurations', color: '#7c3aed', is_system: 1 },
        { name: 'moderator', rank_level: 50, description: 'Operational management tools', color: '#2563eb', is_system: 1 },
        { name: 'helper', rank_level: 30, description: 'Limited operational access', color: '#059669', is_system: 1 }
    ];

    for (const role of defaultRoles) {
        const existing = await db.get(`SELECT id FROM roles WHERE name = ?`, [role.name]);
        if (!existing) {
            await db.run(`
                INSERT INTO roles (id, name, rank_level, description, color, is_system)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [generateId(), role.name, role.rank_level, role.description, role.color, role.is_system]);
        }
    }
}

/**
 * Seed default permissions
 */
async function seedDefaultPermissions() {
    const permissions = [
        // Overview
        { key: 'dashboard.view', category: 'overview', description: 'View dashboard overview' },
        { key: 'dashboard.health', category: 'overview', description: 'View system health' },
        { key: 'dashboard.quick_actions', category: 'overview', description: 'Use quick actions', min_role_level: 50 },
        
        // Status & Monitoring
        { key: 'status.view', category: 'monitoring', description: 'View service status' },
        { key: 'status.detailed', category: 'monitoring', description: 'View detailed metrics', min_role_level: 50 },
        
        // Maintenance
        { key: 'maintenance.view', category: 'maintenance', description: 'View maintenance status' },
        { key: 'maintenance.toggle', category: 'maintenance', description: 'Toggle maintenance mode', min_role_level: 70, is_dangerous: 1 },
        { key: 'maintenance.schedule', category: 'maintenance', description: 'Schedule maintenance', min_role_level: 70 },
        
        // Users & Roles (OWNER/CO-OWNER ONLY)
        { key: 'users.view', category: 'users', description: 'View admin users', min_role_level: 90 },
        { key: 'users.invite', category: 'users', description: 'Invite new admins', min_role_level: 90, is_dangerous: 1 },
        { key: 'users.edit', category: 'users', description: 'Edit admin users', min_role_level: 90, is_dangerous: 1 },
        { key: 'users.suspend', category: 'users', description: 'Suspend admin users', min_role_level: 90, is_dangerous: 1 },
        { key: 'users.delete', category: 'users', description: 'Delete admin users', min_role_level: 100, is_dangerous: 1 },
        
        // Permissions (OWNER/CO-OWNER ONLY)
        { key: 'permissions.view', category: 'permissions', description: 'View permission settings', min_role_level: 90 },
        { key: 'permissions.edit', category: 'permissions', description: 'Edit role permissions', min_role_level: 90, is_dangerous: 1 },
        
        // Discord Bot
        { key: 'bot.view', category: 'bot', description: 'View bot status' },
        { key: 'bot.config', category: 'bot', description: 'Configure bot settings', min_role_level: 70 },
        { key: 'bot.commands', category: 'bot', description: 'Manage bot commands', min_role_level: 70 },
        { key: 'bot.shards', category: 'bot', description: 'Manage bot shards', min_role_level: 90, is_dangerous: 1 },
        { key: 'bot.restart', category: 'bot', description: 'Restart bot', min_role_level: 90, is_dangerous: 1 },
        { key: 'bot.lockdown', category: 'bot', description: 'Emergency lockdown', min_role_level: 90, is_dangerous: 1 },
        
        // Platform Control
        { key: 'platform.view', category: 'platform', description: 'View platform status' },
        { key: 'platform.features', category: 'platform', description: 'Manage feature flags', min_role_level: 70 },
        { key: 'platform.announcements', category: 'platform', description: 'Manage announcements', min_role_level: 70 },
        { key: 'platform.cache', category: 'platform', description: 'Purge cache', min_role_level: 70 },
        { key: 'platform.deploy', category: 'platform', description: 'View deploy info', min_role_level: 50 },
        
        // Logs
        { key: 'logs.view', category: 'logs', description: 'View logs' },
        { key: 'logs.export', category: 'logs', description: 'Export logs', min_role_level: 70 },
        { key: 'logs.live', category: 'logs', description: 'View live logs', min_role_level: 50 },
        
        // Audit Trail
        { key: 'audit.view', category: 'audit', description: 'View audit trail' },
        { key: 'audit.detailed', category: 'audit', description: 'View detailed audit', min_role_level: 70 },
        { key: 'audit.export', category: 'audit', description: 'Export audit logs', min_role_level: 90 },
        
        // Security Center
        { key: 'security.view', category: 'security', description: 'View security overview' },
        { key: 'security.events', category: 'security', description: 'View security events', min_role_level: 70 },
        { key: 'security.sessions', category: 'security', description: 'Manage sessions', min_role_level: 90, is_dangerous: 1 },
        { key: 'security.secrets', category: 'security', description: 'View secrets status', min_role_level: 90 },
        
        // Integrations
        { key: 'integrations.view', category: 'integrations', description: 'View integrations' },
        { key: 'integrations.webhooks', category: 'integrations', description: 'Manage webhooks', min_role_level: 70 },
        { key: 'integrations.api_keys', category: 'integrations', description: 'Manage API keys', min_role_level: 90, is_dangerous: 1 },
        
        // Settings
        { key: 'settings.view', category: 'settings', description: 'View settings' },
        { key: 'settings.edit', category: 'settings', description: 'Edit settings', min_role_level: 70 },
        { key: 'settings.branding', category: 'settings', description: 'Edit branding', min_role_level: 70 },
        
        // Services
        { key: 'services.restart', category: 'services', description: 'Restart services', min_role_level: 90, is_dangerous: 1 },
        { key: 'services.config', category: 'services', description: 'Configure services', min_role_level: 70 }
    ];

    for (const perm of permissions) {
        const existing = await db.get(`SELECT id FROM permissions WHERE key = ?`, [perm.key]);
        if (!existing) {
            // Generate a readable name from the key (e.g., "dashboard.view" -> "View Dashboard")
            const name = perm.key.split('.').reverse().join(' ').replace(/\b\w/g, l => l.toUpperCase());
            await db.run(`
                INSERT INTO permissions (id, key, name, category, description, is_dangerous, min_role_level)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                generateId(),
                perm.key,
                name,
                perm.category,
                perm.description,
                perm.is_dangerous ? 1 : 0,
                perm.min_role_level || 0
            ]);
        }
    }

    // Assign default permissions to roles
    await assignDefaultRolePermissions();
}

/**
 * Assign default permissions to each role based on min_role_level
 */
async function assignDefaultRolePermissions() {
    const roles = await db.all(`SELECT id, name, rank_level FROM roles`);
    const permissions = await db.all(`SELECT id, key, min_role_level FROM permissions`);

    for (const role of roles) {
        for (const perm of permissions) {
            // Role gets permission if their rank_level >= permission's min_role_level
            if (role.rank_level >= perm.min_role_level) {
                const existing = await db.get(`
                    SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?
                `, [role.id, perm.id]);

                if (!existing) {
                    await db.run(`
                        INSERT INTO role_permissions (id, role_id, permission_id)
                        VALUES (?, ?, ?)
                    `, [generateId(), role.id, perm.id]);
                }
            }
        }
    }
}

/**
 * Seed maintenance scopes
 */
async function seedMaintenanceScopes() {
    const scopes = ['darklock_site', 'platform', 'bot_dashboard', 'api', 'discord_bot', 'workers'];

    for (const scope of scopes) {
        const existing = await db.get(`SELECT id FROM maintenance_state WHERE scope = ?`, [scope]);
        if (!existing) {
            await db.run(`
                INSERT INTO maintenance_state (id, scope, enabled, admin_bypass)
                VALUES (?, ?, 0, 1)
            `, [generateId(), scope]);
        }
    }
}

/**
 * Seed default services for status tracking
 */
async function seedDefaultServices() {
    const services = [
        { name: 'web', displayName: 'Web Dashboard', status: 'online' },
        { name: 'api', displayName: 'API', status: 'online' },
        { name: 'auth', displayName: 'Authentication', status: 'online' },
        { name: 'bot', displayName: 'Discord Bot', status: 'online' },
        { name: 'database', displayName: 'Database', status: 'online' },
        { name: 'workers', displayName: 'Background Workers', status: 'online' },
        { name: 'gateway', displayName: 'Gateway', status: 'online' }
    ];

    for (const service of services) {
        const existing = await db.get(`SELECT id FROM service_status WHERE service_name = ?`, [service.name]);
        if (!existing) {
            await db.run(`
                INSERT INTO service_status (id, service_name, display_name, status, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `, [generateId(), service.name, service.displayName, service.status]);
        }
    }
}

/**
 * Generate UUID
 */
function generateId() {
    return crypto.randomUUID();
}

/**
 * Link existing admin to RBAC system
 */
async function linkAdminToRBAC(adminId, roleName = 'admin') {
    const role = await db.get(`SELECT id FROM roles WHERE name = ?`, [roleName]);
    if (!role) {
        throw new Error(`Role ${roleName} not found`);
    }

    const existing = await db.get(`SELECT id FROM admin_users WHERE admin_id = ?`, [adminId]);
    if (existing) {
        return existing;
    }

    const id = generateId();
    await db.run(`
        INSERT INTO admin_users (id, admin_id, role_id, status)
        VALUES (?, ?, ?, 'active')
    `, [id, adminId, role.id]);

    return { id, admin_id: adminId, role_id: role.id };
}

/**
 * Get admin user with role info
 */
async function getAdminUserWithRole(adminId) {
    return db.get(`
        SELECT 
            au.*,
            r.name as role_name,
            r.rank_level,
            r.color as role_color,
            a.email,
            a.active
        FROM admin_users au
        JOIN roles r ON au.role_id = r.id
        JOIN admins a ON au.admin_id = a.id
        WHERE au.admin_id = ?
    `, [adminId]);
}

/**
 * Check if admin has specific permission
 */
async function hasPermission(adminId, permissionKey) {
    const adminUser = await getAdminUserWithRole(adminId);
    if (!adminUser) return false;

    // Owner has all permissions
    if (adminUser.role_name === 'owner') return true;

    // Check for user-specific override
    const override = await db.get(`
        SELECT override_type FROM user_permission_overrides upo
        JOIN permissions p ON upo.permission_id = p.id
        WHERE upo.admin_user_id = ? AND p.key = ?
    `, [adminUser.id, permissionKey]);

    if (override) {
        return override.override_type === 'allow';
    }

    // Check role permission
    const rolePerm = await db.get(`
        SELECT rp.id FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = ? AND p.key = ?
    `, [adminUser.role_id, permissionKey]);

    return !!rolePerm;
}

/**
 * Check if admin meets minimum role level
 */
async function meetsRoleLevel(adminId, minLevel) {
    const adminUser = await getAdminUserWithRole(adminId);
    if (!adminUser) return false;
    return adminUser.rank_level >= minLevel;
}

/**
 * Check if admin is owner or co-owner
 */
async function isOwnerOrCoOwner(adminId) {
    const adminUser = await getAdminUserWithRole(adminId);
    if (!adminUser) return false;
    return adminUser.rank_level >= ROLE_LEVELS['co-owner'];
}

/**
 * Initialize RBAC Schema - Main entry point
 */
async function initializeRBACSchema() {
    await initializeRBACTables();
    await initializeAdditionalTables();
}

/**
 * Initialize additional tables needed for full dashboard
 */
async function initializeAdditionalTables() {
    // Admin settings table
    await db.run(`
        CREATE TABLE IF NOT EXISTS admin_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            description TEXT,
            updated_by TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Feature flags table
    await db.run(`
        CREATE TABLE IF NOT EXISTS feature_flags (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            is_enabled BOOLEAN DEFAULT 0,
            rollout_percentage INTEGER DEFAULT 100,
            allowed_users TEXT,
            metadata TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Announcements table
    await db.run(`
        CREATE TABLE IF NOT EXISTS announcements (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            type TEXT DEFAULT 'info',
            is_global BOOLEAN DEFAULT 0,
            target_scopes TEXT,
            starts_at TEXT,
            expires_at TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Webhooks table
    await db.run(`
        CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            events TEXT,
            secret TEXT,
            is_active BOOLEAN DEFAULT 1,
            last_triggered TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed some default feature flags
    await seedDefaultFeatureFlags();

    console.log('[RBAC] ✅ Additional tables initialized');
}

/**
 * Seed default feature flags
 */
async function seedDefaultFeatureFlags() {
    const flags = [
        { key: 'dark_mode', name: 'Dark Mode', description: 'Enable dark mode for users', is_enabled: 1 },
        { key: 'new_dashboard', name: 'New Dashboard', description: 'Use new dashboard design', is_enabled: 1 },
        { key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Show advanced analytics', is_enabled: 0 },
        { key: 'beta_features', name: 'Beta Features', description: 'Enable beta features', is_enabled: 0 }
    ];

    for (const flag of flags) {
        const existing = await db.get(`SELECT id FROM feature_flags WHERE key = ?`, [flag.key]);
        if (!existing) {
            await db.run(`
                INSERT INTO feature_flags (id, key, name, description, is_enabled, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [generateId(), flag.key, flag.name, flag.description, flag.is_enabled, 'system']);
        }
    }
}

module.exports = {
    initializeRBACSchema,
    initializeRBACTables,
    linkAdminToRBAC,
    getAdminUserWithRole,
    hasPermission,
    meetsRoleLevel,
    isOwnerOrCoOwner,
    ROLE_LEVELS,
    ROLE_NAMES,
    generateId
};
