/**
 * Setup team management database tables
 */

const db = require('./darklock/utils/database');

const ROLE_PRESETS = {
    'helper': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: false,
        canBanUsers: false,
        canManageRoles: false,
        canManageServer: false,
        canAccessDashboard: true,
        canViewAnalytics: false,
        canManageBot: false
    },
    'mod': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: false,
        canManageServer: false,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: false
    },
    'admin': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: false
    },
    'co-owner': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: true
    },
    'owner': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: true
    }
};

async function setup() {
    try {
        console.log('[Setup] Initializing database connection...');
        await db.initialize();
        
        console.log('[Setup] Creating team management tables...');
        
        // Drop existing tables
        try {
            await db.run('DROP TABLE IF EXISTS team_members');
            await db.run('DROP TABLE IF EXISTS role_permissions');
            console.log('[Setup] Dropped existing tables');
        } catch (err) {
            console.log('[Setup] No existing tables to drop');
        }

        // Team members table
        await db.run(`
            CREATE TABLE team_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                discord_id TEXT,
                added_by TEXT NOT NULL,
                added_at TEXT NOT NULL,
                last_active TEXT,
                is_active INTEGER DEFAULT 1,
                CONSTRAINT valid_role CHECK (role IN ('helper', 'mod', 'admin', 'co-owner', 'owner'))
            )
        `);
        console.log('[Setup] Created team_members table');

        // Wait a moment for table creation to complete await new Promise(resolve => setTimeout(resolve, 100));
        
        // Drop old conflicting table if it exists
        try {
            await db.run('DROP TABLE IF EXISTS role_permissions');
            console.log('[Setup] Dropped conflicting role_permissions table');
        } catch (err) {
            // Ignore
        }

        // Team permissions table (renamed to avoid conflict with RBAC)
        await db.run(`
            CREATE TABLE team_role_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT UNIQUE NOT NULL,
                permissions TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CONSTRAINT valid_role CHECK (role IN ('helper', 'mod', 'admin', 'co-owner', 'owner'))
            )
        `);
        console.log('[Setup] Created team_role_permissions table');

        // Initialize default permissions
        for (const [role, perms] of Object.entries(ROLE_PRESETS)) {
            await db.run(
                'INSERT INTO team_role_permissions (role, permissions, updated_by, updated_at) VALUES (?, ?, ?, ?)',
                [role, JSON.stringify(perms), 'system', new Date().toISOString()]
            );
            console.log(`[Setup] Initialized permissions for ${role}`);
        }

        console.log('\n✅ Team management database setup complete!');
        console.log('You can now start the bot and use the team management features.\n');
        
        process.exit(0);
    } catch (error) {
        console.error('[Setup] Error:', error);
        process.exit(1);
    }
}

setup();
