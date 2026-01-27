#!/usr/bin/env node

/**
 * Initialize RBAC Schema
 * Run this script to create all RBAC tables and seed default data
 */

const db = require('./darklock/utils/database');
const rbacSchema = require('./darklock/utils/rbac-schema');

console.log('[RBAC Init] Starting RBAC schema initialization...');

async function initializeRBAC() {
    try {
        // Initialize database connection first
        console.log('[RBAC Init] Connecting to database...');
        await db.initialize();
        console.log('[RBAC Init] Database connected successfully.');
        
        console.log('[RBAC Init] Creating tables and seeding data...');
        await rbacSchema.initializeRBACSchema();
        console.log('[RBAC Init] ✅ RBAC schema initialized successfully!');
        console.log('[RBAC Init] Default roles and permissions have been created.');
        console.log('[RBAC Init] You can now start the bot.');
        
        // Close database connection
        await db.close();
        process.exit(0);
    } catch (error) {
        console.error('[RBAC Init] ❌ Failed to initialize RBAC schema:', error);
        process.exit(1);
    }
}

initializeRBAC();
