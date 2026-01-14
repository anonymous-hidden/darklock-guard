/**
 * Darklock Platform - SQLite Database Layer
 * Replaces JSON file storage with persistent SQLite database
 * 
 * CRITICAL: Designed for Render persistent disk at /data
 * 
 * Features:
 * - Persistent user accounts across deploys
 * - Session management with JTI tracking
 * - User settings storage
 * - Transaction support
 * - Async/await interface
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

class DarklockDatabase {
    constructor() {
        // Use same data directory as bot for consistency
        const dataDir = process.env.DB_PATH || process.env.DATA_PATH || './data';
        this.dbPath = process.env.DARKLOCK_DB_PATH || path.join(dataDir, 'darklock.db');
        this.db = null;
        this.ready = false;
    }

    /**
     * Initialize database connection and create tables
     */
    async initialize() {
        // Ensure directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`[Darklock DB] Created directory: ${dbDir}`);
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    console.error('[Darklock DB] Failed to connect:', err);
                    reject(err);
                    return;
                }

                console.log(`[Darklock DB] Connected to database at: ${this.dbPath}`);

                try {
                    await this.createTables();
                    await this.runMigrations();
                    this.ready = true;
                    console.log('[Darklock DB] ✅ Database ready');
                    resolve();
                } catch (error) {
                    console.error('[Darklock DB] Initialization failed:', error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Create database tables
     */
    async createTables() {
        await this.run(`
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
        `);

        await this.run(`
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
        `);

        await this.run(`
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
        `);

        // Create indexes
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

        console.log('[Darklock DB] Tables created successfully');
    }

    /**
     * Run any pending migrations
     */
    async runMigrations() {
        // Future migrations will go here
        console.log('[Darklock DB] Migrations complete');
    }

    /**
     * Promisified db.run
     */
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    /**
     * Promisified db.get
     */
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Promisified db.all
     */
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
     * USER METHODS
     */

    async createUser(userData) {
        const { id, username, email, password, displayName, role = 'user', settings = {} } = userData;
        const now = new Date().toISOString();

        const result = await this.run(`
            INSERT INTO users (
                id, username, email, password, display_name, role,
                created_at, updated_at, password_changed_at, settings, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            username,
            email.toLowerCase(),
            password,
            displayName || username,
            role,
            now,
            now,
            now,
            JSON.stringify(settings),
            1
        ]);

        // Create default settings
        await this.run(`
            INSERT INTO user_settings (user_id, updated_at)
            VALUES (?, ?)
        `, [id, now]);

        return this.getUserById(id);
    }

    async getUserById(userId) {
        const user = await this.get(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (user && user.settings) {
            try {
                user.settings = JSON.parse(user.settings);
            } catch (e) {
                user.settings = {};
            }
        }
        return user;
    }

    async getUserByUsername(username) {
        const user = await this.get(`SELECT * FROM users WHERE username = ?`, [username]);
        if (user && user.settings) {
            try {
                user.settings = JSON.parse(user.settings);
            } catch (e) {
                user.settings = {};
            }
        }
        return user;
    }

    async getUserByEmail(email) {
        const user = await this.get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()]);
        if (user && user.settings) {
            try {
                user.settings = JSON.parse(user.settings);
            } catch (e) {
                user.settings = {};
            }
        }
        return user;
    }

    async updateUser(userId, updates) {
        const fields = [];
        const values = [];

        const allowedFields = [
            'username', 'email', 'password', 'display_name', 'role', 
            'avatar', 'two_factor_enabled', 'two_factor_secret',
            'last_login', 'last_login_ip', 'password_changed_at', 'settings', 'active'
        ];

        for (const [key, value] of Object.entries(updates)) {
            const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (allowedFields.includes(dbKey)) {
                fields.push(`${dbKey} = ?`);
                values.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
        }

        if (fields.length === 0) {
            return this.getUserById(userId);
        }

        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(userId);

        await this.run(`
            UPDATE users SET ${fields.join(', ')} WHERE id = ?
        `, values);

        return this.getUserById(userId);
    }

    /**
     * SESSION METHODS
     */

    async createSession(sessionData) {
        const { id, jti, userId, ip, userAgent, device } = sessionData;
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        await this.run(`
            INSERT INTO sessions (
                id, jti, user_id, created_at, last_active, expires_at,
                ip, user_agent, device
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, jti, userId, now, now, expiresAt, ip, userAgent, device]);

        return this.getSessionByJti(jti);
    }

    async getSessionByJti(jti) {
        return this.get(`SELECT * FROM sessions WHERE jti = ? AND revoked_at IS NULL`, [jti]);
    }

    async getSessionById(sessionId) {
        return this.get(`SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL`, [sessionId]);
    }

    async getUserSessions(userId) {
        return this.all(`
            SELECT * FROM sessions 
            WHERE user_id = ? AND revoked_at IS NULL 
            ORDER BY last_active DESC
        `, [userId]);
    }

    async updateSessionActivity(jti) {
        await this.run(`
            UPDATE sessions 
            SET last_active = ? 
            WHERE jti = ?
        `, [new Date().toISOString(), jti]);
    }

    async revokeSession(jti) {
        await this.run(`
            UPDATE sessions 
            SET revoked_at = ? 
            WHERE jti = ?
        `, [new Date().toISOString(), jti]);
    }

    async revokeAllUserSessions(userId) {
        await this.run(`
            UPDATE sessions 
            SET revoked_at = ? 
            WHERE user_id = ? AND revoked_at IS NULL
        `, [new Date().toISOString(), userId]);
    }

    async cleanupExpiredSessions() {
        const result = await this.run(`
            DELETE FROM sessions 
            WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)
        `, [new Date().toISOString(), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]);

        if (result.changes > 0) {
            console.log(`[Darklock DB] Cleaned up ${result.changes} expired sessions`);
        }
    }

    /**
     * SETTINGS METHODS
     */

    async getUserSettings(userId) {
        return this.get(`SELECT * FROM user_settings WHERE user_id = ?`, [userId]);
    }

    async updateUserSettings(userId, settings) {
        const existing = await this.getUserSettings(userId);
        const now = new Date().toISOString();

        if (!existing) {
            // Create settings
            const fields = ['user_id', 'updated_at'];
            const values = [userId, now];
            const placeholders = ['?', '?'];

            for (const [key, value] of Object.entries(settings)) {
                fields.push(key);
                values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
                placeholders.push('?');
            }

            await this.run(`
                INSERT INTO user_settings (${fields.join(', ')}) 
                VALUES (${placeholders.join(', ')})
            `, values);
        } else {
            // Update settings
            const fields = [];
            const values = [];

            for (const [key, value] of Object.entries(settings)) {
                fields.push(`${key} = ?`);
                values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
            }

            if (fields.length > 0) {
                fields.push('updated_at = ?');
                values.push(now);
                values.push(userId);

                await this.run(`
                    UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?
                `, values);
            }
        }

        return this.getUserSettings(userId);
    }

    /**
     * Close database connection
     */
    close() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }

            this.db.close((err) => {
                if (err) reject(err);
                else {
                    console.log('[Darklock DB] Connection closed');
                    resolve();
                }
            });
        });
    }
}

// Export singleton instance
const db = new DarklockDatabase();
module.exports = db;
