/**
 * Darklock Platform - Database Migration
 * Migrates from JSON file storage to SQLite for persistent storage on Render
 * 
 * CRITICAL: This must run BEFORE Darklock server starts on first deploy
 * 
 * What this does:
 * 1. Creates SQLite database at /data/darklock.db
 * 2. Migrates existing users from users.json
 * 3. Migrates existing sessions from sessions.json
 * 4. Creates backup of JSON files
 * 5. Updates DATA_PATH to use SQLite
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Paths
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../darklock/data');
const DB_PATH = process.env.DARKLOCK_DB_PATH || '/data/darklock.db';
const USERS_JSON = path.join(DATA_DIR, 'users.json');
const SESSIONS_JSON = path.join(DATA_DIR, 'sessions.json');

console.log('🔄 Starting Darklock Database Migration');
console.log(`📁 Data directory: ${DATA_DIR}`);
console.log(`💾 Target database: ${DB_PATH}`);

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✅ Created database directory: ${dbDir}`);
}

// Connect to SQLite
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Failed to connect to database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to SQLite database');
});

/**
 * Create tables
 */
function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Users table
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    display_name TEXT,
                    role TEXT DEFAULT 'user',
                    avatar TEXT,
                    two_factor_enabled INTEGER DEFAULT 0,
                    two_factor_secret TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login TEXT,
                    last_login_ip TEXT,
                    password_changed_at TEXT,
                    settings TEXT,
                    active INTEGER DEFAULT 1
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Failed to create users table:', err);
                    reject(err);
                } else {
                    console.log('✅ Created users table');
                }
            });

            // Sessions table
            db.run(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    jti TEXT UNIQUE NOT NULL,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_active TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    ip TEXT,
                    user_agent TEXT,
                    device TEXT,
                    revoked_at TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Failed to create sessions table:', err);
                    reject(err);
                } else {
                    console.log('✅ Created sessions table');
                }
            });

            // User settings table (for additional settings)
            db.run(`
                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id TEXT PRIMARY KEY,
                    notifications_enabled INTEGER DEFAULT 1,
                    email_alerts_enabled INTEGER DEFAULT 1,
                    security_alerts_enabled INTEGER DEFAULT 1,
                    session_timeout_minutes INTEGER DEFAULT 1440,
                    ui_compact_mode INTEGER DEFAULT 0,
                    show_quick_actions INTEGER DEFAULT 1,
                    theme TEXT DEFAULT 'dark',
                    language TEXT DEFAULT 'en',
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Failed to create user_settings table:', err);
                    reject(err);
                } else {
                    console.log('✅ Created user_settings table');
                    resolve();
                }
            });

            // Create indexes
            db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
        });
    });
}

/**
 * Migrate users from JSON
 */
function migrateUsers() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(USERS_JSON)) {
            console.log('ℹ️  No users.json found, skipping user migration');
            resolve(0);
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(USERS_JSON, 'utf8'));
            const users = data.users || [];

            if (users.length === 0) {
                console.log('ℹ️  No users to migrate');
                resolve(0);
                return;
            }

            console.log(`📦 Migrating ${users.length} users...`);

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO users (
                    id, username, email, password, display_name, role, avatar,
                    two_factor_enabled, two_factor_secret,
                    created_at, updated_at, last_login, last_login_ip,
                    password_changed_at, settings, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let migrated = 0;
            users.forEach(user => {
                stmt.run([
                    user.id,
                    user.username,
                    user.email,
                    user.password,
                    user.displayName || user.username, // Set default displayName
                    user.role || 'user',
                    user.avatar || null,
                    user.twoFactorEnabled ? 1 : 0,
                    user.twoFactorSecret || null,
                    user.createdAt || new Date().toISOString(),
                    user.updatedAt || new Date().toISOString(),
                    user.lastLogin || null,
                    user.lastLoginIp || null,
                    user.passwordChangedAt || user.createdAt || new Date().toISOString(),
                    JSON.stringify(user.settings || {}),
                    1
                ], (err) => {
                    if (err) {
                        console.error(`❌ Failed to migrate user ${user.username}:`, err.message);
                    } else {
                        migrated++;
                    }
                });
            });

            stmt.finalize((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✅ Migrated ${migrated} users`);
                    resolve(migrated);
                }
            });

        } catch (error) {
            console.error('❌ Error reading users.json:', error);
            reject(error);
        }
    });
}

/**
 * Migrate sessions from JSON
 */
function migrateSessions() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(SESSIONS_JSON)) {
            console.log('ℹ️  No sessions.json found, skipping session migration');
            resolve(0);
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8'));
            const sessions = data.sessions || [];

            // Filter out expired sessions
            const now = new Date().toISOString();
            const validSessions = sessions.filter(s => !s.expiresAt || s.expiresAt > now);

            if (validSessions.length === 0) {
                console.log('ℹ️  No valid sessions to migrate');
                resolve(0);
                return;
            }

            console.log(`📦 Migrating ${validSessions.length} sessions...`);

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO sessions (
                    id, jti, user_id, created_at, last_active, expires_at,
                    ip, user_agent, device, revoked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let migrated = 0;
            validSessions.forEach(session => {
                // Calculate expires_at if not present (7 days from creation)
                const expiresAt = session.expiresAt || 
                    new Date(new Date(session.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

                stmt.run([
                    session.id,
                    session.jti,
                    session.userId,
                    session.createdAt,
                    session.lastActive || session.createdAt,
                    expiresAt,
                    session.ip || null,
                    session.userAgent || null,
                    session.device || null,
                    session.revokedAt || null
                ], (err) => {
                    if (err) {
                        console.error(`❌ Failed to migrate session ${session.id}:`, err.message);
                    } else {
                        migrated++;
                    }
                });
            });

            stmt.finalize((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✅ Migrated ${migrated} sessions`);
                    resolve(migrated);
                }
            });

        } catch (error) {
            console.error('❌ Error reading sessions.json:', error);
            reject(error);
        }
    });
}

/**
 * Backup JSON files
 */
function backupJSON() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(DATA_DIR, 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    if (fs.existsSync(USERS_JSON)) {
        const backup = path.join(backupDir, `users-${timestamp}.json`);
        fs.copyFileSync(USERS_JSON, backup);
        console.log(`✅ Backed up users.json to ${backup}`);
    }

    if (fs.existsSync(SESSIONS_JSON)) {
        const backup = path.join(backupDir, `sessions-${timestamp}.json`);
        fs.copyFileSync(SESSIONS_JSON, backup);
        console.log(`✅ Backed up sessions.json to ${backup}`);
    }
}

/**
 * Run migration
 */
async function runMigration() {
    try {
        // Create tables
        await createTables();

        // Backup existing data
        backupJSON();

        // Migrate data
        const userCount = await migrateUsers();
        const sessionCount = await migrateSessions();

        console.log('\n════════════════════════════════════════');
        console.log('✅ MIGRATION COMPLETE');
        console.log('════════════════════════════════════════');
        console.log(`📊 Users migrated: ${userCount}`);
        console.log(`📊 Sessions migrated: ${sessionCount}`);
        console.log(`💾 Database: ${DB_PATH}`);
        console.log('════════════════════════════════════════\n');

        // Close database
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
                process.exit(1);
            }
            console.log('✅ Database connection closed');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Migration failed:', error);
        db.close();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    runMigration();
}

module.exports = { runMigration, createTables };
