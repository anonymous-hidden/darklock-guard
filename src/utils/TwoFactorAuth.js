const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

class TwoFactorAuth {
    constructor(db) {
        this.db = db;
    }

    /**
     * Generate a new TOTP secret for a user
     * @param {string} username - Username for the QR code label
     * @returns {Object} Secret, QR code data URL, and backup codes
     */
    async generateSecret(username) {
        const secret = speakeasy.generateSecret({
            name: `DarkLock Dashboard (${username})`,
            issuer: 'DarkLock Security',
            length: 32
        });

        // Generate 10 backup codes
        const backupCodes = this.generateBackupCodes(10);

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

        return {
            secret: secret.base32,
            qrCode: qrCodeUrl,
            backupCodes: backupCodes
        };
    }

    /**
     * Generate secure backup codes
     * @param {number} count - Number of codes to generate
     * @returns {string[]} Array of backup codes
     */
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            // Generate 8-character alphanumeric code
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            codes.push(code.match(/.{1,4}/g).join('-')); // Format: XXXX-XXXX
        }
        return codes;
    }

    /**
     * Verify a TOTP token
     * @param {string} secret - Base32 encoded secret
     * @param {string} token - 6-digit token from user
     * @param {number} window - Time window for token validation (default 1 = ±30s)
     * @returns {boolean} True if valid
     */
    verifyToken(secret, token, window = 1) {
        return speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: window
        });
    }

    /**
     * Verify a backup code and mark it as used
     * @param {string} username - Username
     * @param {string} code - Backup code to verify
     * @returns {Promise<boolean>} True if valid and not used
     */
    async verifyBackupCode(username, code) {
        try {
            const user = await this.db.get(
                'SELECT backup_codes FROM admin_users WHERE username = ? AND active = 1',
                [username]
            );

            if (!user || !user.backup_codes) return false;

            const backupCodes = JSON.parse(user.backup_codes);
            const formattedCode = code.toUpperCase().replace(/\s/g, '');

            // Check if code exists and hasn't been used
            const codeIndex = backupCodes.findIndex(c => c.code === formattedCode && !c.used);
            if (codeIndex === -1) return false;

            // Mark code as used
            backupCodes[codeIndex].used = true;
            backupCodes[codeIndex].usedAt = new Date().toISOString();

            await this.db.run(
                'UPDATE admin_users SET backup_codes = ? WHERE username = ?',
                [JSON.stringify(backupCodes), username]
            );

            return true;
        } catch (error) {
            console.error('[2FA] Backup code verification error:', error);
            return false;
        }
    }

    /**
     * Enable 2FA for a user
     * @param {string} username - Username
     * @param {string} secret - TOTP secret
     * @param {string[]} backupCodes - Backup codes
     * @returns {Promise<boolean>} Success status
     */
    async enable2FA(username, secret, backupCodes) {
        try {
            const formattedCodes = backupCodes.map(code => ({
                code: code,
                used: false,
                usedAt: null
            }));

            await this.db.run(
                `UPDATE admin_users 
                 SET totp_secret = ?, totp_enabled = 1, backup_codes = ?
                 WHERE username = ?`,
                [secret, JSON.stringify(formattedCodes), username]
            );

            return true;
        } catch (error) {
            console.error('[2FA] Enable error:', error);
            return false;
        }
    }

    /**
     * Disable 2FA for a user
     * @param {string} username - Username
     * @returns {Promise<boolean>} Success status
     */
    async disable2FA(username) {
        try {
            await this.db.run(
                `UPDATE admin_users 
                 SET totp_secret = NULL, totp_enabled = 0, backup_codes = NULL
                 WHERE username = ?`,
                [username]
            );

            return true;
        } catch (error) {
            console.error('[2FA] Disable error:', error);
            return false;
        }
    }

    /**
     * Check if user has 2FA enabled
     * @param {string} username - Username
     * @returns {Promise<boolean>} True if enabled
     */
    async is2FAEnabled(username) {
        try {
            const user = await this.db.get(
                'SELECT totp_enabled FROM admin_users WHERE username = ? AND active = 1',
                [username]
            );

            return user && user.totp_enabled === 1;
        } catch (error) {
            console.error('[2FA] Check enabled error:', error);
            return false;
        }
    }

    /**
     * Get TOTP secret for a user
     * @param {string} username - Username
     * @returns {Promise<string|null>} Secret or null
     */
    async getSecret(username) {
        try {
            const user = await this.db.get(
                'SELECT totp_secret FROM admin_users WHERE username = ? AND active = 1',
                [username]
            );

            return user?.totp_secret || null;
        } catch (error) {
            console.error('[2FA] Get secret error:', error);
            return null;
        }
    }

    /**
     * Regenerate backup codes
     * @param {string} username - Username
     * @returns {Promise<string[]|null>} New backup codes or null
     */
    async regenerateBackupCodes(username) {
        try {
            const newCodes = this.generateBackupCodes(10);
            const formattedCodes = newCodes.map(code => ({
                code: code,
                used: false,
                usedAt: null
            }));

            await this.db.run(
                'UPDATE admin_users SET backup_codes = ? WHERE username = ?',
                [JSON.stringify(formattedCodes), username]
            );

            return newCodes;
        } catch (error) {
            console.error('[2FA] Regenerate codes error:', error);
            return null;
        }
    }

    // =========================================================================
    // Discord OAuth User 2FA Methods
    // =========================================================================

    /**
     * Generate a new TOTP secret for a Discord user
     * @param {string} discordId - Discord user ID
     * @param {string} username - Discord username for QR code label
     * @returns {Object} Secret, QR code data URL, and backup codes
     */
    async generateSecretForDiscordUser(discordId, username) {
        const secret = speakeasy.generateSecret({
            name: `DarkLock (${username})`,
            issuer: 'DarkLock Security',
            length: 32
        });

        // Generate 10 backup codes
        const backupCodes = this.generateBackupCodes(10);

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

        return {
            secret: secret.base32,
            qrCode: qrCodeUrl,
            backupCodes: backupCodes
        };
    }

    /**
     * Check if Discord user has 2FA enabled
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} True if enabled
     */
    async isDiscordUser2FAEnabled(discordId) {
        try {
            const user = await this.db.get(
                'SELECT totp_enabled FROM discord_users_2fa WHERE discord_id = ?',
                [discordId]
            );

            return user && user.totp_enabled === 1;
        } catch (error) {
            console.error('[2FA] Check Discord user enabled error:', error);
            return false;
        }
    }

    /**
     * Get TOTP secret for a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<string|null>} Secret or null
     */
    async getDiscordUserSecret(discordId) {
        try {
            const user = await this.db.get(
                'SELECT totp_secret FROM discord_users_2fa WHERE discord_id = ? AND totp_enabled = 1',
                [discordId]
            );

            return user?.totp_secret || null;
        } catch (error) {
            console.error('[2FA] Get Discord user secret error:', error);
            return null;
        }
    }

    /**
     * Enable 2FA for a Discord user
     * @param {string} discordId - Discord user ID
     * @param {string} secret - TOTP secret
     * @param {string[]} backupCodes - Backup codes
     * @returns {Promise<boolean>} Success status
     */
    async enableDiscordUser2FA(discordId, secret, backupCodes) {
        try {
            const formattedCodes = backupCodes.map(code => ({
                code: code,
                used: false,
                usedAt: null
            }));

            // Check if record exists
            const existing = await this.db.get(
                'SELECT discord_id FROM discord_users_2fa WHERE discord_id = ?',
                [discordId]
            );

            if (existing) {
                await this.db.run(
                    `UPDATE discord_users_2fa 
                     SET totp_secret = ?, totp_enabled = 1, backup_codes = ?, enabled_at = datetime('now')
                     WHERE discord_id = ?`,
                    [secret, JSON.stringify(formattedCodes), discordId]
                );
            } else {
                await this.db.run(
                    `INSERT INTO discord_users_2fa (discord_id, totp_secret, totp_enabled, backup_codes, enabled_at)
                     VALUES (?, ?, 1, ?, datetime('now'))`,
                    [discordId, secret, JSON.stringify(formattedCodes)]
                );
            }

            return true;
        } catch (error) {
            console.error('[2FA] Enable Discord user 2FA error:', error);
            return false;
        }
    }

    /**
     * Disable 2FA for a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async disableDiscordUser2FA(discordId) {
        try {
            await this.db.run(
                `UPDATE discord_users_2fa 
                 SET totp_secret = NULL, totp_enabled = 0, backup_codes = NULL
                 WHERE discord_id = ?`,
                [discordId]
            );

            return true;
        } catch (error) {
            console.error('[2FA] Disable Discord user 2FA error:', error);
            return false;
        }
    }

    /**
     * Verify a TOTP token for Discord user
     * @param {string} discordId - Discord user ID
     * @param {string} token - 6-digit token from user
     * @returns {Promise<boolean>} True if valid
     */
    async verifyDiscordUserToken(discordId, token) {
        try {
            const secret = await this.getDiscordUserSecret(discordId);
            if (!secret) return false;

            const isValid = this.verifyToken(secret, token);
            
            if (isValid) {
                // Update last used timestamp
                await this.db.run(
                    "UPDATE discord_users_2fa SET last_used = datetime('now') WHERE discord_id = ?",
                    [discordId]
                );
            }

            return isValid;
        } catch (error) {
            console.error('[2FA] Verify Discord user token error:', error);
            return false;
        }
    }

    /**
     * Verify a backup code for Discord user
     * @param {string} discordId - Discord user ID
     * @param {string} code - Backup code to verify
     * @returns {Promise<boolean>} True if valid and not used
     */
    async verifyDiscordUserBackupCode(discordId, code) {
        try {
            const user = await this.db.get(
                'SELECT backup_codes FROM discord_users_2fa WHERE discord_id = ? AND totp_enabled = 1',
                [discordId]
            );

            if (!user || !user.backup_codes) return false;

            const backupCodes = JSON.parse(user.backup_codes);
            const formattedCode = code.toUpperCase().replace(/[\s-]/g, '');

            // Check if code exists and hasn't been used
            const codeIndex = backupCodes.findIndex(c => 
                c.code.replace(/-/g, '') === formattedCode && !c.used
            );
            if (codeIndex === -1) return false;

            // Mark code as used
            backupCodes[codeIndex].used = true;
            backupCodes[codeIndex].usedAt = new Date().toISOString();

            await this.db.run(
                "UPDATE discord_users_2fa SET backup_codes = ?, last_used = datetime('now') WHERE discord_id = ?",
                [JSON.stringify(backupCodes), discordId]
            );

            return true;
        } catch (error) {
            console.error('[2FA] Discord user backup code verification error:', error);
            return false;
        }
    }

    /**
     * Regenerate backup codes for Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<string[]|null>} New backup codes or null
     */
    async regenerateDiscordUserBackupCodes(discordId) {
        try {
            const newCodes = this.generateBackupCodes(10);
            const formattedCodes = newCodes.map(code => ({
                code: code,
                used: false,
                usedAt: null
            }));

            await this.db.run(
                'UPDATE discord_users_2fa SET backup_codes = ? WHERE discord_id = ?',
                [JSON.stringify(formattedCodes), discordId]
            );

            return newCodes;
        } catch (error) {
            console.error('[2FA] Regenerate Discord user codes error:', error);
            return null;
        }
    }

    /**
     * Get 2FA status for Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<Object>} Status info
     */
    async getDiscordUser2FAStatus(discordId) {
        try {
            const user = await this.db.get(
                'SELECT totp_enabled, enabled_at, last_used, backup_codes FROM discord_users_2fa WHERE discord_id = ?',
                [discordId]
            );

            if (!user) {
                return { enabled: false, enabledAt: null, lastUsed: null, backupCodesRemaining: 0 };
            }

            let backupCodesRemaining = 0;
            if (user.backup_codes) {
                try {
                    const codes = JSON.parse(user.backup_codes);
                    backupCodesRemaining = codes.filter(c => !c.used).length;
                } catch (e) {}
            }

            return {
                enabled: user.totp_enabled === 1,
                enabledAt: user.enabled_at,
                lastUsed: user.last_used,
                backupCodesRemaining
            };
        } catch (error) {
            console.error('[2FA] Get Discord user status error:', error);
            return { enabled: false, enabledAt: null, lastUsed: null, backupCodesRemaining: 0 };
        }
    }
}

module.exports = TwoFactorAuth;
