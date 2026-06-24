/**
 * Darklock Admin - First-Run Admin Bootstrap
 *
 * Creates the initial admin account on first run.
 *
 * Credential sources (in order of precedence):
 *   1. RENDER_ADMIN_EMAIL / RENDER_ADMIN_PASSWORD (or ADMIN_USERNAME / ADMIN_PASSWORD)
 *      - ADMIN_PASSWORD may be plain text (hashed automatically) or a bcrypt hash
 *   2. A cryptographically random password generated at first run and printed
 *      ONCE to the console. Save it immediately and change it after login.
 *
 * No credentials are committed to source control.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./utils/database');

const DEFAULT_ADMIN = {
    email: 'owner@darklock.net',
    username: 'owner',
    role: 'owner'
};

/**
 * Generate a strong random password (URL-safe, ~128 bits of entropy).
 */
function generateRandomPassword() {
    return crypto.randomBytes(24).toString('base64url');
}

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
 * 
 * Checks environment variables first (RENDER_ADMIN_EMAIL, RENDER_ADMIN_PASSWORD)
 * Falls back to hardcoded defaults if not provided
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

        // Check for environment-provided admin credentials
        const envEmail = process.env.RENDER_ADMIN_EMAIL || process.env.ADMIN_USERNAME;
        const envPassword = process.env.RENDER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

        let primaryEmail = DEFAULT_ADMIN.email;
        let primaryHash;
        let generatedPassword = null;

        if (envEmail && envPassword) {
            primaryEmail = envEmail;
            // Check if it's already a hash (starts with $2b$ or $2a$)
            if (envPassword.startsWith('$2')) {
                primaryHash = envPassword;
                console.log('[Default Admin] Using environment-provided admin hash');
            } else {
                // Plain text password - hash it
                primaryHash = await bcrypt.hash(envPassword, 12);
                console.log('[Default Admin] Hashing environment-provided password');
            }
        } else {
            // No env credentials: generate a one-time random password.
            generatedPassword = generateRandomPassword();
            primaryHash = await bcrypt.hash(generatedPassword, 12);
        }

        // Create primary admin
        const primaryId = crypto.randomUUID();
        await db.run(`
            INSERT INTO admins (id, email, username, password_hash, role, created_at, updated_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            primaryId,
            primaryEmail,
            DEFAULT_ADMIN.username || null,
            primaryHash,
            DEFAULT_ADMIN.role,
            now,
            now
        ]);
        createdAdmins.push(primaryEmail);
        console.log(`[Default Admin] ✅ Created primary admin: ${primaryEmail} (username: ${DEFAULT_ADMIN.username || 'none'})`);

        if (generatedPassword) {
            console.log('[Default Admin] ============================================================');
            console.log('[Default Admin] ⚠️  ONE-TIME GENERATED ADMIN PASSWORD (will not be shown again):');
            console.log(`[Default Admin]     Email:    ${primaryEmail}`);
            console.log(`[Default Admin]     Password: ${generatedPassword}`);
            console.log('[Default Admin] Save it now and change it after first login.');
            console.log('[Default Admin] ============================================================');
        } else if (envPassword && !envPassword.startsWith('$2')) {
            console.log('[Default Admin] ⚠️  Environment password was provided in plain text and has been hashed.');
            console.log('[Default Admin] ⚠️  Consider using a pre-hashed password in environment variables.');
        }

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
 * Reset an admin's password to a fresh random one (emergency recovery).
 * Prints the new password ONCE to the console.
 */
async function resetToDefault(email) {
    const newPassword = generateRandomPassword();
    const newHash = await bcrypt.hash(newPassword, 12);

    await db.run(`
        UPDATE admins 
        SET password_hash = ?, updated_at = ?
        WHERE email = ?
    `, [newHash, new Date().toISOString(), email]);

    console.log(`[Default Admin] ⚠️  Reset password for: ${email}`);
    console.log(`[Default Admin] ⚠️  New one-time password: ${newPassword}`);
    console.log('[Default Admin] ⚠️  CHANGE THIS PASSWORD IMMEDIATELY AFTER LOGIN!');
}

module.exports = {
    DEFAULT_ADMIN,
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
            console.log('  create        - Create the first-run admin account');
            console.log('  hash <pwd>    - Generate bcrypt hash for a password');
            console.log('  reset [email] - Reset an admin password to a fresh random one');
        }
        
        process.exit(0);
    })().catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
}
