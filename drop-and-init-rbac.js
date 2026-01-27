#!/usr/bin/env node

/**
 * Drop existing RBAC tables and reinitialize
 * WARNING: This will delete all RBAC data!
 */

const db = require('./darklock/utils/database');
const rbacSchema = require('./darklock/utils/rbac-schema');

console.log('[RBAC Drop & Init] Starting...');

async function dropAndInitRBAC() {
    try {
        // Initialize database connection first
        console.log('[RBAC Drop & Init] Connecting to database...');
        await db.initialize();
        console.log('[RBAC Drop & Init] Database connected.');
        
        // Drop all RBAC tables
        console.log('[RBAC Drop & Init] Dropping existing RBAC tables...');
        const tables = [
            'webhooks',
            'announcements',
            'feature_flags',
            'admin_settings',
            'security_events',
            'admin_sessions',
            'incidents',
            'service_status',
            'maintenance_history',
            'maintenance_state',
            'admin_audit_log_v2',
            'user_permission_overrides',
            'admin_users',
            'role_permissions',
            'permissions',
            'roles'
        ];
        
        for (const table of tables) {
            try {
                await db.run(`DROP TABLE IF EXISTS ${table}`);
                console.log(`[RBAC Drop & Init] Dropped table: ${table}`);
            } catch (err) {
                console.log(`[RBAC Drop & Init] Note: ${table} didn't exist or couldn't be dropped`);
            }
        }
        
        console.log('[RBAC Drop & Init] Creating fresh RBAC tables...');
        await rbacSchema.initializeRBACSchema();
        console.log('[RBAC Drop & Init] ✅ RBAC schema initialized successfully!');
        console.log('[RBAC Drop & Init] All tables created and seeded with defaults.');
        console.log('[RBAC Drop & Init] You can now start the bot.');
        
        // Close database connection
        await db.close();
        process.exit(0);
    } catch (error) {
        console.error('[RBAC Drop & Init] ❌ Failed:', error);
        process.exit(1);
    }
}

dropAndInitRBAC();
