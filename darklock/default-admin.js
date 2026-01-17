/**
 * Darklock Admin - Hardcoded Default Admin Setup
 * 
 * This file creates default admin credentials on first run.
 * The password is pre-hashed for security (not stored in plain text).
 * 
 * DEFAULT CREDENTIALS:
 * Email: admin@darklock.net
 * Password: DarkLock@Admin2025!
 * Role: owner
 * 
 * SECURITY NOTES:
 * - Change these credentials immediately after first login
 * - The password hash below was generated with bcrypt (12 rounds)
 * - Never commit actual production passwords
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./utils/database');

// ============================================================================
// HARDCODED DEFAULT ADMIN
// ============================================================================

const DEFAULT_ADMIN = {
    email: 'admin@darklock.net',
    // Password: DarkLock@Admin2025!
    // Pre-hashed with bcrypt (12 rounds) - DO NOT CHANGE THIS HASH
    passwordHash: '$2b$12$qocZQu8LaGNiPl/bZq5drOxFxpEqmZyUNV2kuCmwfLutHnmLB7TUi',
    role: 'owner'
};

// Backup admin in case primary is compromised
const BACKUP_ADMIN = {
    email: 'security@darklock.net',
    // Password: Security#Backup@2025
    passwordHash: '$2b$12$KqvVuXDXQ9V9Nfn52k4I7.OaAvSdlQLfBkNJ1FvZJ16/FEGMQC0jm',
    role: 'owner'
};

/**
 * Generate a new bcrypt hash (for creating new credentials)
 * Run: node -e "require('./default-admin').generateHash('YourNewPassword123!')"
 */
async function generateHash(password) {
    const hash = await bcrypt.hash(password, 12);
    console.log('Password hash:', hash);
    return hash;
}

/**
 * Initialize default admin accounts
 * Only creates if no admins exist in database
 */
async function initializeDefaultAdmins() {
    try {
        // Check if any admins exist
        const existingAdmins = await db.get('SELECT COUNT(*) as count FROM admins');
        
        if (existingAdmins && existingAdmins.count > 0) {
            console.log('[Default Admin] Admins already exist, skipping default creation');
            return { created: false, message: 'Admins already exist' };
        }

        const now = new Date().toISOString();
        const createdAdmins = [];

        // Create primary admin
        const primaryId = crypto.randomUUID();
        await db.run(`
            INSERT INTO admins (id, email, password_hash, role, created_at, updated_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [
            primaryId,
            DEFAULT_ADMIN.email,
            DEFAULT_ADMIN.passwordHash,
            DEFAULT_ADMIN.role,
            now,
            now
        ]);
        createdAdmins.push(DEFAULT_ADMIN.email);
        console.log(`[Default Admin] ✅ Created primary admin: ${DEFAULT_ADMIN.email}`);

        // Create backup admin
        const backupId = crypto.randomUUID();
        await db.run(`
            INSERT INTO admins (id, email, password_hash, role, created_at, updated_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [
            backupId,
            BACKUP_ADMIN.email,
            BACKUP_ADMIN.passwordHash,
            BACKUP_ADMIN.role,
            now,
            now
        ]);
        createdAdmins.push(BACKUP_ADMIN.email);
        console.log(`[Default Admin] ✅ Created backup admin: ${BACKUP_ADMIN.email}`);

        console.log('[Default Admin] ⚠️  IMPORTANT: Change default passwords immediately!');
        
        return { created: true, admins: createdAdmins };
    } catch (err) {
        // If tables don't exist yet, that's OK - they'll be created later
        if (err.message.includes('no such table')) {
            console.log('[Default Admin] Tables not ready yet, will retry on next startup');
            return { created: false, message: 'Tables not ready' };
        }
        console.error('[Default Admin] Error:', err.message);
        throw err;
    }
}

/**
 * Reset admin password to default (emergency recovery)
 */
async function resetToDefault(email) {
    const defaultData = email === BACKUP_ADMIN.email ? BACKUP_ADMIN : DEFAULT_ADMIN;
    
    await db.run(`
        UPDATE admins 
        SET password_hash = ?, updated_at = ?
        WHERE email = ?
    `, [defaultData.passwordHash, new Date().toISOString(), email]);
    
    console.log(`[Default Admin] ⚠️  Reset password for: ${email}`);
    console.log('[Default Admin] ⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
}

module.exports = {
    DEFAULT_ADMIN,
    BACKUP_ADMIN,
    generateHash,
    initializeDefaultAdmins,
    resetToDefault
};

// If run directly: node default-admin.js [command]
if (require.main === module) {
    const command = process.argv[2];
    
    (async () => {
        await db.initialize();
        
        if (command === 'create') {
            await initializeDefaultAdmins();
        } else if (command === 'hash') {
            const password = process.argv[3];
            if (!password) {
                console.log('Usage: node default-admin.js hash <password>');
                process.exit(1);
            }
            await generateHash(password);
        } else if (command === 'reset') {
            const email = process.argv[3] || DEFAULT_ADMIN.email;
            await resetToDefault(email);
        } else {
            console.log('Darklock Default Admin Utility');
            console.log('==============================');
            console.log('Commands:');
            console.log('  create       - Create default admin accounts');
            console.log('  hash <pwd>   - Generate bcrypt hash for a password');
            console.log('  reset [email] - Reset admin password to default');
            console.log('');
            console.log('Default Credentials:');
            console.log(`  Email: ${DEFAULT_ADMIN.email}`);
            console.log('  Password: DarkLock@Admin2025!');
        }
        
        process.exit(0);
    })().catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
}
