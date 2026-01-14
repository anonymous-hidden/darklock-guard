const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

/**
 * Multi-Factor Staff Security System
 * Protects against compromised admin accounts
 */
class StaffSecurity {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        this.pendingConfirmations = new Map(); // actionId -> confirmation data
        this.activeSessions = new Map(); // userId -> session data
    }

    /**
     * Initialize or get 2FA for a staff member
     */
    async initialize2FA(guildId, userId) {
        // Check if already exists
        const existing = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        if (existing) {
            return {
                enabled: existing.enabled === 1,
                secret: existing.secret,
                backupCodes: JSON.parse(existing.backup_codes || '[]')
            };
        }

        // Generate new secret
        const secret = speakeasy.generateSecret({
            name: `DarkLock (Guild: ${guildId})`,
            length: 32
        });

        // Generate backup codes
        const backupCodes = this.generateBackupCodes(10);

        // Store in database
        await this.db.run(`
            INSERT INTO staff_2fa (guild_id, user_id, enabled, secret, backup_codes)
            VALUES (?, ?, 0, ?, ?)
        `, [guildId, userId, secret.base32, JSON.stringify(backupCodes)]);

        return {
            enabled: false,
            secret: secret.base32,
            otpauthUrl: secret.otpauth_url,
            qrCode: await this.generateQRCode(secret.otpauth_url),
            backupCodes
        };
    }

    /**
     * Enable 2FA for a staff member
     */
    async enable2FA(guildId, userId, verificationCode) {
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        if (!twofa) {
            return { success: false, error: '2FA not initialized' };
        }

        // Verify the code
        const isValid = speakeasy.totp.verify({
            secret: twofa.secret,
            encoding: 'base32',
            token: verificationCode,
            window: 2
        });

        if (!isValid) {
            return { success: false, error: 'Invalid verification code' };
        }

        // Enable 2FA
        await this.db.run(`
            UPDATE staff_2fa SET enabled = 1 WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        return { success: true };
    }

    /**
     * Disable 2FA
     */
    async disable2FA(guildId, userId, verificationCode) {
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        if (!twofa || twofa.enabled === 0) {
            return { success: false, error: '2FA not enabled' };
        }

        // Verify the code or backup code
        const isValid = await this.verify2FACode(guildId, userId, verificationCode);

        if (!isValid) {
            return { success: false, error: 'Invalid verification code' };
        }

        // Disable 2FA
        await this.db.run(`
            UPDATE staff_2fa SET enabled = 0 WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        return { success: true };
    }

    /**
     * Verify 2FA code
     */
    async verify2FACode(guildId, userId, code) {
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        if (!twofa || twofa.enabled === 0) {
            return false;
        }

        // Try TOTP verification
        const isValidTOTP = speakeasy.totp.verify({
            secret: twofa.secret,
            encoding: 'base32',
            token: code,
            window: 2
        });

        if (isValidTOTP) {
            await this.db.run(`
                UPDATE staff_2fa SET last_used = CURRENT_TIMESTAMP WHERE id = ?
            `, [twofa.id]);
            return true;
        }

        // Try backup code
        const backupCodes = JSON.parse(twofa.backup_codes || '[]');
        const codeIndex = backupCodes.indexOf(code);
        
        if (codeIndex !== -1) {
            // Remove used backup code
            backupCodes.splice(codeIndex, 1);
            await this.db.run(`
                UPDATE staff_2fa 
                SET backup_codes = ?, last_used = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [JSON.stringify(backupCodes), twofa.id]);
            return true;
        }

        return false;
    }

    /**
     * Check if action requires 2FA confirmation
     */
    async requiresConfirmation(actionType) {
        const destructiveActions = [
            'channel_delete',
            'role_delete',
            'mass_ban',
            'mass_kick',
            'webhook_delete',
            'permission_change',
            'lockdown',
            'nuke_prevention'
        ];

        return destructiveActions.includes(actionType);
    }

    /**
     * Request confirmation for destructive action
     */
    async requestConfirmation(guild, member, actionType, actionDetails) {
        // Check if 2FA is enabled
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ? AND enabled = 1
        `, [guild.id, member.id]);

        const requires2FA = twofa !== null;
        const confirmationCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Store confirmation request
        await this.db.run(`
            INSERT INTO destructive_action_confirmations (
                guild_id, user_id, action_type, action_details,
                confirmation_code, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            guild.id,
            member.id,
            actionType,
            JSON.stringify(actionDetails),
            confirmationCode,
            expiresAt.toISOString()
        ]);

        // Send confirmation request
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Confirmation Required')
            .setDescription(
                `You are about to perform a **destructive action**:\n\n` +
                `**Action:** ${this.formatActionType(actionType)}\n` +
                `**Details:** ${this.formatActionDetails(actionDetails)}\n\n` +
                (requires2FA ? 
                    `Please enter your **2FA code** followed by the confirmation code: **${confirmationCode}**\n\n` +
                    `Format: \`/confirm <2FA code> ${confirmationCode}\`` :
                    `Please confirm by typing: \`/confirm ${confirmationCode}\``
                )
            )
            .setColor(0xFF0000)
            .setFooter({ text: 'This confirmation expires in 5 minutes' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_action_${confirmationCode}`)
                    .setLabel('Confirm Action')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_action_${confirmationCode}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        try {
            await member.send({ embeds: [embed], components: [row] });
        } catch (error) {
            // If DM fails, send to channel
            const channel = guild.channels.cache.get(actionDetails.channelId);
            if (channel) {
                await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
            }
        }

        return { confirmationCode, requires2FA };
    }

    /**
     * Verify confirmation
     */
    async verifyConfirmation(guildId, userId, confirmationCode, twofaCode = null) {
        const confirmation = await this.db.get(`
            SELECT * FROM destructive_action_confirmations
            WHERE guild_id = ? AND user_id = ? AND confirmation_code = ?
            AND confirmed = 0 AND expires_at > datetime('now')
        `, [guildId, userId, confirmationCode]);

        if (!confirmation) {
            return { success: false, error: 'Invalid or expired confirmation code' };
        }

        // Check if 2FA is required
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ? AND enabled = 1
        `, [guildId, userId]);

        if (twofa && !twofaCode) {
            return { success: false, error: '2FA code required' };
        }

        if (twofa) {
            const isValid = await this.verify2FACode(guildId, userId, twofaCode);
            if (!isValid) {
                return { success: false, error: 'Invalid 2FA code' };
            }
        }

        // Mark as confirmed
        await this.db.run(`
            UPDATE destructive_action_confirmations
            SET confirmed = 1
            WHERE id = ?
        `, [confirmation.id]);

        return {
            success: true,
            actionType: confirmation.action_type,
            actionDetails: JSON.parse(confirmation.action_details)
        };
    }

    /**
     * Create staff session with device fingerprinting
     */
    async createSession(guildId, userId, deviceFingerprint, ipHash) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await this.db.run(`
            INSERT INTO staff_sessions (
                guild_id, user_id, session_token,
                device_fingerprint, ip_hash, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [guildId, userId, sessionToken, deviceFingerprint, ipHash, expiresAt.toISOString()]);

        this.activeSessions.set(userId, {
            token: sessionToken,
            deviceFingerprint,
            ipHash,
            expiresAt
        });

        return sessionToken;
    }

    /**
     * Verify session
     */
    async verifySession(sessionToken, deviceFingerprint, ipHash) {
        const session = await this.db.get(`
            SELECT * FROM staff_sessions
            WHERE session_token = ? AND expires_at > datetime('now')
        `, [sessionToken]);

        if (!session) {
            return { valid: false, reason: 'Session not found or expired' };
        }

        // Check device fingerprint consistency
        if (deviceFingerprint && session.device_fingerprint !== deviceFingerprint) {
            console.warn(`Device fingerprint mismatch for user ${session.user_id}`);
            // Log but don't block (fingerprint can change with browser updates)
        }

        // Check IP hash consistency
        if (ipHash && session.ip_hash !== ipHash) {
            console.warn(`IP hash mismatch for user ${session.user_id}`);
            // Log but don't block (IP can change with location)
        }

        // Update last activity
        await this.db.run(`
            UPDATE staff_sessions
            SET last_activity = CURRENT_TIMESTAMP
            WHERE session_token = ?
        `, [sessionToken]);

        return { valid: true, session };
    }

    /**
     * Generate backup codes
     */
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    /**
     * Generate QR code for 2FA setup
     */
    async generateQRCode(otpauthUrl) {
        try {
            return await QRCode.toDataURL(otpauthUrl);
        } catch (error) {
            console.error('QR code generation failed:', error);
            return null;
        }
    }

    /**
     * Format action type for display
     */
    formatActionType(actionType) {
        const typeMap = {
            'channel_delete': 'Delete Channel(s)',
            'role_delete': 'Delete Role(s)',
            'mass_ban': 'Mass Ban Users',
            'mass_kick': 'Mass Kick Users',
            'webhook_delete': 'Delete Webhook',
            'permission_change': 'Change Critical Permissions',
            'lockdown': 'Server Lockdown',
            'nuke_prevention': 'Anti-Nuke Action'
        };

        return typeMap[actionType] || actionType;
    }

    /**
     * Format action details for display
     */
    formatActionDetails(details) {
        const parts = [];
        
        if (details.channels) {
            parts.push(`**Channels:** ${details.channels.length}`);
        }
        if (details.roles) {
            parts.push(`**Roles:** ${details.roles.length}`);
        }
        if (details.users) {
            parts.push(`**Users:** ${details.users.length}`);
        }
        if (details.reason) {
            parts.push(`**Reason:** ${details.reason}`);
        }

        return parts.join('\n') || 'No details provided';
    }

    /**
     * Clean up expired sessions and confirmations
     */
    async cleanup() {
        await this.db.run(`
            DELETE FROM staff_sessions WHERE expires_at < datetime('now')
        `);

        await this.db.run(`
            DELETE FROM destructive_action_confirmations WHERE expires_at < datetime('now')
        `);
    }

    /**
     * Get staff security status
     */
    async getSecurityStatus(guildId, userId) {
        const twofa = await this.db.get(`
            SELECT * FROM staff_2fa WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        const sessions = await this.db.all(`
            SELECT * FROM staff_sessions WHERE guild_id = ? AND user_id = ?
            ORDER BY last_activity DESC
        `, [guildId, userId]);

        return {
            twofa: {
                enabled: twofa?.enabled === 1,
                lastUsed: twofa?.last_used,
                backupCodesRemaining: twofa ? JSON.parse(twofa.backup_codes || '[]').length : 0
            },
            sessions: sessions.map(s => ({
                token: s.session_token.substring(0, 8) + '...',
                lastActivity: s.last_activity,
                expiresAt: s.expires_at
            }))
        };
    }
}

module.exports = StaffSecurity;
