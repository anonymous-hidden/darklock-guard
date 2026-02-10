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
        let dataDir = process.env.DB_PATH || process.env.DATA_PATH || './data';
        // Convert absolute /data to relative ./data for local development
        if (dataDir === '/data' || dataDir === '/data/') {
            dataDir = './data';
        }
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
                active INTEGER DEFAULT 1,
                language TEXT DEFAULT 'en',
                region TEXT DEFAULT 'auto',
                email_updates_opt_in INTEGER DEFAULT 0
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
                region TEXT DEFAULT 'auto',
                timezone TEXT DEFAULT 'auto',
                date_format TEXT DEFAULT 'MM/DD/YYYY',
                time_format TEXT DEFAULT '12h',
                default_landing_page TEXT DEFAULT 'dashboard',
                remember_last_app INTEGER DEFAULT 1,
                auto_save INTEGER DEFAULT 1,
                compact_mode INTEGER DEFAULT 0,
                sidebar_position TEXT DEFAULT 'left',
                font_scaling TEXT DEFAULT '100',
                high_contrast INTEGER DEFAULT 0,
                reduced_motion INTEGER DEFAULT 0,
                screen_reader_support INTEGER DEFAULT 0,
                email_notifications INTEGER DEFAULT 1,
                push_notifications INTEGER DEFAULT 0,
                sound_enabled INTEGER DEFAULT 1,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS updates (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                version TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                published_at TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);

        // Create indexes
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_updates_published_at ON updates(published_at)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_updates_version ON updates(version)`);

        // Premium subscription tables
        await this.run(`
            CREATE TABLE IF NOT EXISTS premium_subscriptions (
                user_id TEXT PRIMARY KEY,
                tier TEXT NOT NULL,
                license_code TEXT,
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                payment_id TEXT,
                expires_at TEXT,
                purchased_at TEXT NOT NULL,
                cancelled_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS license_codes (
                code TEXT PRIMARY KEY,
                tier TEXT NOT NULL,
                expires_at TEXT,
                max_redemptions INTEGER DEFAULT 1,
                redemptions_count INTEGER DEFAULT 0,
                redeemed_at TEXT,
                created_at TEXT NOT NULL
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS payment_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                tier TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'usd',
                stripe_session_id TEXT,
                stripe_payment_intent TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Create indexes for premium tables
        await this.run(`CREATE INDEX IF NOT EXISTS idx_premium_stripe_customer ON premium_subscriptions(stripe_customer_id)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_premium_payment_id ON premium_subscriptions(payment_id)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_license_tier ON license_codes(tier)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_history(user_id)`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_payment_intent ON payment_history(stripe_payment_intent)`);

        console.log('[Darklock DB] Tables created successfully');
    }

    /**
     * Run any pending migrations
     */
    async runMigrations() {
        // Migration: Add language, region, and email_updates_opt_in to existing users table
        try {
            await this.run(`ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'`);
            console.log('[Darklock DB] Migration: Added language column');
        } catch (err) {
            // Column already exists
        }
        
        try {
            await this.run(`ALTER TABLE users ADD COLUMN region TEXT DEFAULT 'auto'`);
            console.log('[Darklock DB] Migration: Added region column');
        } catch (err) {
            // Column already exists
        }
        
        try {
            await this.run(`ALTER TABLE users ADD COLUMN email_updates_opt_in INTEGER DEFAULT 0`);
            console.log('[Darklock DB] Migration: Added email_updates_opt_in column');
        } catch (err) {
            // Column already exists
        }
        
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

    async getAllUsers() {
        const users = await this.all(`SELECT * FROM users`);
        return users.map(user => {
            if (user.settings) {
                try {
                    user.settings = JSON.parse(user.settings);
                } catch (e) {
                    user.settings = {};
                }
            }
            return user;
        });
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

    async updateUserLastLogin(userId, ip) {
        const now = new Date().toISOString();
        await this.run(`
            UPDATE users 
            SET last_login = ?, last_login_ip = ?, updated_at = ?
            WHERE id = ?
        `, [now, ip, now, userId]);
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
        const user = await this.getUserById(userId);
        if (user && user.settings) {
            try {
                // If already an object, return as-is
                if (typeof user.settings === 'object') {
                    return user.settings;
                }
                return JSON.parse(user.settings);
            } catch (err) {
                console.error('[Darklock DB] Failed to parse user settings:', err);
                return {};
            }
        }
        return {};
    }

    async saveUserSettings(userId, settings) {
        const now = new Date().toISOString();
        await this.run(`
            UPDATE users 
            SET settings = ?, updated_at = ? 
            WHERE id = ?
        `, [JSON.stringify(settings), now, userId]);
    }

    async updateUserSettings(userId, settings) {
        const existing = await this.get(`SELECT * FROM user_settings WHERE user_id = ?`, [userId]);
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
     * UPDATE METHODS
     */

    async createUpdate(updateData) {
        const { id, title, version, type, content, createdBy } = updateData;
        const now = new Date().toISOString();

        await this.run(`
            INSERT INTO updates (
                id, title, version, type, content, published_at, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, title, version, type, content, now, createdBy, now]);

        return this.getUpdateById(id);
    }

    async getUpdateById(updateId) {
        return this.get(`SELECT * FROM updates WHERE id = ?`, [updateId]);
    }

    async getAllUpdates() {
        return this.all(`
            SELECT * FROM updates 
            ORDER BY published_at DESC
        `);
    }

    async getLatestUpdate() {
        return this.get(`
            SELECT * FROM updates 
            ORDER BY published_at DESC 
            LIMIT 1
        `);
    }

    async updateUpdate(updateId, updateData) {
        const now = new Date().toISOString();
        await this.run(`
            UPDATE updates 
            SET title = ?, version = ?, type = ?, content = ?, updated_at = ?
            WHERE id = ?
        `, [
            updateData.title,
            updateData.version,
            updateData.type,
            updateData.content,
            now,
            updateId
        ]);
        return this.getUpdateById(updateId);
    }

    async deleteUpdate(updateId) {
        await this.run(`DELETE FROM updates WHERE id = ?`, [updateId]);
    }

    async getUsersWithEmailOptIn() {
        return this.all(`
            SELECT id, username, email 
            FROM users 
            WHERE email_updates_opt_in = 1 AND active = 1
        `);
    }

    /**
     * Save user language preference
     */
    async saveUserLanguage(userId, language) {
        const now = new Date().toISOString();
        await this.run(`
            UPDATE users 
            SET language = ?, updated_at = ? 
            WHERE id = ?
        `, [language, now, userId]);
    }

    /**
     * Save user region preference
     */
    async saveUserRegion(userId, region) {
        const now = new Date().toISOString();
        await this.run(`
            UPDATE users 
            SET region = ?, updated_at = ? 
            WHERE id = ?
        `, [region, now, userId]);
    }

    /**
     * Get user's premium subscription
     */
    async getUserPremium(userId) {
        return this.get(`
            SELECT * FROM premium_subscriptions 
            WHERE user_id = ?
        `, [userId]);
    }

    /**
     * Save/update premium subscription
     */
    async savePremium(userId, data) {
        const now = new Date().toISOString();
        return this.run(`
            INSERT OR REPLACE INTO premium_subscriptions 
            (user_id, tier, license_code, stripe_customer_id, stripe_subscription_id, payment_id, expires_at, purchased_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId,
            data.tier,
            data.licenseCode || null,
            data.stripeCustomerId || null,
            data.stripeSubscriptionId || null,
            data.stripePaymentIntent || null,
            data.expiresAt || null,
            data.purchasedAt || now,
            now
        ]);
    }

    /**
     * Create license code
     */
    async createLicense(code, tier, expiresAt = null, maxRedemptions = 1) {
        const now = new Date().toISOString();
        return this.run(`
            INSERT INTO license_codes 
            (code, tier, expires_at, max_redemptions, redemptions_count, created_at)
            VALUES (?, ?, ?, ?, 0, ?)
        `, [code, tier, expiresAt, maxRedemptions, now]);
    }

    /**
     * Get license code
     */
    async getLicense(code) {
        return this.get(`
            SELECT * FROM license_codes 
            WHERE code = ?
        `, [code]);
    }

    /**
     * Redeem license code
     */
    async redeemLicense(code) {
        return this.run(`
            UPDATE license_codes 
            SET redemptions_count = redemptions_count + 1,
                redeemed_at = ?
            WHERE code = ?
        `, [new Date().toISOString(), code]);
    }

    /**
     * Record payment
     */
    async recordPayment(data) {
        const now = new Date().toISOString();
        return this.run(`
            INSERT INTO payment_history 
            (user_id, tier, amount, currency, stripe_session_id, stripe_payment_intent, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            data.userId,
            data.tier,
            data.amount,
            data.currency,
            data.stripeSessionId || null,
            data.stripePaymentIntent || null,
            data.status || 'completed',
            now
        ]);
    }

    /**
     * Cancel premium
     */
    async cancelPremium(userId) {
        return this.run(`
            UPDATE premium_subscriptions 
            SET cancelled_at = ?
            WHERE user_id = ?
        `, [new Date().toISOString(), userId]);
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
