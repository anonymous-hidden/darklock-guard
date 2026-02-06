/**
 * Darklock Platform - Profile Routes
 * Handles user profile management, security settings, and 2FA
 * 
 * Security Features:
 * - Fresh 2FA verification required for sensitive actions
 * - Password confirmation for dangerous operations
 * - Session invalidation on password change
 * - Rate limiting on 2FA verification
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Import auth middleware and helpers
const { requireAuth } = require('./dashboard');
const authModule = require('./auth');
const db = require('../utils/database');

// Security utilities
const {
    atomicWriteJSON,
    safeReadJSON,
    rateLimitMiddleware,
    markVerified,
    isRecentlyVerified
} = require('../utils/security');

// Data paths
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

/**
 * Load users from storage
 */
async function loadUsers() {
    return await safeReadJSON(USERS_FILE, { users: [] });
}

/**
 * Save users to storage (atomic)
 */
async function saveUsers(data) {
    try {
        await atomicWriteJSON(USERS_FILE, data);
        return true;
    } catch (err) {
        console.error('[Darklock Profile] Error saving users:', err.message);
        return false;
    }
}

/**
 * Load sessions from storage
 */
async function loadSessions() {
    return await safeReadJSON(SESSIONS_FILE, { sessions: [] });
}

/**
 * Save sessions to storage (atomic)
 */
async function saveSessions(data) {
    try {
        await atomicWriteJSON(SESSIONS_FILE, data);
        return true;
    } catch (err) {
        console.error('[Darklock Profile] Error saving sessions:', err.message);
        return false;
    }
}

/**
 * Resolve user from DB first, fallback to JSON users file
 */
async function getUserRecord(userId) {
    const dbUser = await db.getUserById(userId);
    if (dbUser) {
        return { source: 'db', user: dbUser, usersData: null };
    }

    const usersData = await loadUsers();
    const user = usersData.users.find(u => u.id === userId);
    return { source: 'json', user, usersData };
}

// ============================================================================
// PROFILE API ROUTES
// ============================================================================

/**
 * GET /profile/api/overview - Get profile overview
 */
router.get('/api/overview', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({
            success: true,
            profile: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                avatar: user.avatar,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                lastLoginIp: user.lastLoginIp,
                settings: user.settings
            }
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Overview error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load profile'
        });
    }
});

/**
 * PUT /profile/api/update - Update profile information
 */
router.put('/api/update', requireAuth, async (req, res) => {
    try {
        const { username, email } = req.body;
        const usersData = await loadUsers();
        const userIndex = usersData.users.findIndex(u => u.id === req.user.userId);
        
        if (userIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = usersData.users[userIndex];
        
        // Check for duplicate username
        if (username && username !== user.username) {
            const existing = usersData.users.find(
                u => u.username.toLowerCase() === username.toLowerCase() && u.id !== user.id
            );
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Username is already taken'
                });
            }
            user.username = username.trim();
        }
        
        // Check for duplicate email
        if (email && email !== user.email) {
            const existing = usersData.users.find(
                u => u.email.toLowerCase() === email.toLowerCase() && u.id !== user.id
            );
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is already registered'
                });
            }
            user.email = email.toLowerCase().trim();
        }
        
        user.updatedAt = new Date().toISOString();
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

/**
 * PUT /profile/api/password - Change password
 * Invalidates all other sessions on success
 */
router.put('/api/password', requireAuth, rateLimitMiddleware('passwordChange'), async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword, totpCode } = req.body;
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'All password fields are required'
            });
        }
        
        if (newPassword !== confirmPassword) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'New passwords do not match'
            });
        }
        
        // Validate new password strength
        if (newPassword.length < 8) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            req.recordAttempt(false);
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }
        
        // If 2FA is enabled, require TOTP verification
        if (user.twoFactorEnabled) {
            if (!totpCode) {
                return res.status(400).json({
                    success: false,
                    requires2FA: true,
                    error: 'Two-factor authentication code required'
                });
            }
            
            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: totpCode.toString().replace(/\s/g, ''),
                window: 1
            });
            
            if (!verified) {
                req.recordAttempt(false);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid authentication code'
                });
            }
        }
        
        // Hash and save new password
        user.password = await bcrypt.hash(newPassword, 12);
        user.updatedAt = new Date().toISOString();
        user.passwordChangedAt = new Date().toISOString();
        await saveUsers(usersData);
        
        // Invalidate all other sessions (security best practice)
        const sessionsData = await loadSessions();
        const currentJti = req.user.jti;
        sessionsData.sessions = sessionsData.sessions.map(s => {
            if (s.userId === user.id && s.jti !== currentJti && !s.revokedAt) {
                return { ...s, revokedAt: new Date().toISOString() };
            }
            return s;
        });
        await saveSessions(sessionsData);
        
        req.recordAttempt(true);
        console.log(`[Darklock Profile] Password changed for user: ${user.username}`);
        
        res.json({
            success: true,
            message: 'Password changed successfully. All other sessions have been logged out.'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Password change error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to change password'
        });
    }
});

/**
 * GET /profile/api/security - Get security overview with last login info
 */
router.get('/api/security', requireAuth, async (req, res) => {
    try {
        // Get user from database
        const user = await db.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Get active sessions count
        const sessions = await db.getUserSessions(user.id);
        const activeSessions = sessions.filter(s => !s.revoked_at).length;
        
        res.json({
            success: true,
            security: {
                twoFactorEnabled: user.two_factor_enabled || false,
                twoFactorEnabledAt: user.two_factor_enabled_at || null,
                lastPasswordChange: user.password_changed_at || user.created_at,
                activeSessions,
                lastLogin: user.last_login,
                lastLoginIp: user.last_login_ip || 'Unknown',
                accountCreated: user.created_at
            }
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Security overview error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load security info'
        });
    }
});

// ============================================================================
// 2FA ROUTES
// ============================================================================

/**
 * POST /profile/api/2fa/setup - Initialize 2FA setup
 * Requires password verification first
 */
router.post('/api/2fa/setup', requireAuth, async (req, res) => {
    try {
        const { password } = req.body;
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        if (user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: 'Two-factor authentication is already enabled'
            });
        }
        
        // Require password verification to start 2FA setup
        if (password) {
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid password'
                });
            }
            // Mark as verified for this action
            markVerified(user.id, '2fa-setup');
        } else if (!isRecentlyVerified(user.id, '2fa-setup')) {
            return res.status(400).json({
                success: false,
                requiresPassword: true,
                error: 'Password verification required to enable 2FA'
            });
        }
        
        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `Darklock:${user.username}`,
            issuer: 'Darklock',
            length: 32
        });
        
        // Store pending secret (not yet verified)
        user.twoFactorPendingSecret = secret.base32;
        await saveUsers(usersData);
        
        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        
        res.json({
            success: true,
            secret: secret.base32,
            qrCode: qrCodeUrl,
            manualEntry: {
                secret: secret.base32,
                issuer: 'Darklock',
                account: user.username
            }
        });
        
    } catch (err) {
        console.error('[Darklock Profile] 2FA setup error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to initialize 2FA setup'
        });
    }
});

/**
 * POST /profile/api/2fa/verify - Verify and enable 2FA
 * Rate limited: 5 attempts per 15 minutes
 */
router.post('/api/2fa/verify', requireAuth, rateLimitMiddleware('2fa'), async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Verification code is required'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        if (!user.twoFactorPendingSecret) {
            return res.status(400).json({
                success: false,
                error: 'No pending 2FA setup found. Please start the setup process again.'
            });
        }
        
        // Verify the code
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorPendingSecret,
            encoding: 'base32',
            token: code.toString().replace(/\s/g, ''),
            window: 2
        });
        
        if (!verified) {
            req.recordAttempt(false);
            return res.status(400).json({
                success: false,
                error: 'Invalid verification code. Please try again.'
            });
        }
        
        // Enable 2FA
        user.twoFactorSecret = user.twoFactorPendingSecret;
        user.twoFactorEnabled = true;
        user.twoFactorEnabledAt = new Date().toISOString();
        delete user.twoFactorPendingSecret;
        
        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 8; i++) {
            backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        user.twoFactorBackupCodes = backupCodes.map(code => 
            bcrypt.hashSync(code, 10)
        );
        
        await saveUsers(usersData);
        
        req.recordAttempt(true);
        console.log(`[Darklock Profile] 2FA enabled for user: ${user.username}`);
        
        res.json({
            success: true,
            message: 'Two-factor authentication enabled successfully',
            backupCodes
        });
        
    } catch (err) {
        console.error('[Darklock Profile] 2FA verify error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to verify 2FA code'
        });
    }
});

/**
 * POST /profile/api/2fa/disable - Disable 2FA
 * Requires both password and current TOTP code
 */
router.post('/api/2fa/disable', requireAuth, async (req, res) => {
    try {
        const { password, code } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Password is required to disable 2FA'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        if (!user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: 'Two-factor authentication is not enabled'
            });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
        
        // Require TOTP code verification (not optional!)
        if (!code) {
            return res.status(400).json({
                success: false,
                requiresCode: true,
                error: 'Authentication code is required to disable 2FA'
            });
        }
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code.toString().replace(/\s/g, ''),
            window: 1
        });
        
        if (!verified) {
            return res.status(400).json({
                success: false,
                error: 'Invalid authentication code'
            });
        }
        
        // Disable 2FA
        user.twoFactorEnabled = false;
        user.twoFactorSecret = null;
        user.twoFactorBackupCodes = null;
        user.twoFactorDisabledAt = new Date().toISOString();
        
        await saveUsers(usersData);
        
        console.log(`[Darklock Profile] 2FA disabled for user: ${user.username}`);
        
        res.json({
            success: true,
            message: 'Two-factor authentication disabled'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] 2FA disable error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to disable 2FA'
        });
    }
});

/**
 * GET /profile/api/2fa/status - Get 2FA status
 */
router.get('/api/2fa/status', requireAuth, async (req, res) => {
    try {
        // Get user from database
        const user = await db.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({
            success: true,
            twoFactor: {
                enabled: user.two_factor_enabled || false,
                enabledAt: user.two_factor_enabled_at || null,
                hasBackupCodes: !!(user.two_factor_backup_codes && JSON.parse(user.two_factor_backup_codes || '[]').length > 0)
            }
        });
        
    } catch (err) {
        console.error('[Darklock Profile] 2FA status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get 2FA status'
        });
    }
});

/**
 * POST /profile/api/2fa/regenerate-backup - Regenerate backup codes
 * Requires both password and TOTP verification
 */
router.post('/api/2fa/regenerate-backup', requireAuth, async (req, res) => {
    try {
        const { password, code } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Password is required'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        if (!user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: 'Two-factor authentication is not enabled'
            });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
        
        // Require TOTP verification to view/regenerate backup codes
        if (!code) {
            return res.status(400).json({
                success: false,
                requiresCode: true,
                error: 'Authentication code is required'
            });
        }
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code.toString().replace(/\s/g, ''),
            window: 1
        });
        
        if (!verified) {
            return res.status(400).json({
                success: false,
                error: 'Invalid authentication code'
            });
        }
        
        // Generate new backup codes
        const backupCodes = [];
        for (let i = 0; i < 8; i++) {
            backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        user.twoFactorBackupCodes = backupCodes.map(code => 
            bcrypt.hashSync(code, 10)
        );
        
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Backup codes regenerated',
            backupCodes
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Regenerate backup codes error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to regenerate backup codes'
        });
    }
});

/**
 * POST /profile/api/2fa/verify-backup - Use a backup code
 */
router.post('/api/2fa/verify-backup', async (req, res) => {
    try {
        const { username, backupCode } = req.body;
        
        if (!username || !backupCode) {
            return res.status(400).json({
                success: false,
                error: 'Username and backup code are required'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(
            u => u.username.toLowerCase() === username.toLowerCase()
        );
        
        if (!user || !user.twoFactorEnabled || !user.twoFactorBackupCodes) {
            return res.status(401).json({
                success: false,
                error: 'Invalid backup code'
            });
        }
        
        // Check backup codes
        const normalizedCode = backupCode.toUpperCase().replace(/\s/g, '');
        let codeIndex = -1;
        
        for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
            if (await bcrypt.compare(normalizedCode, user.twoFactorBackupCodes[i])) {
                codeIndex = i;
                break;
            }
        }
        
        if (codeIndex === -1) {
            return res.status(401).json({
                success: false,
                error: 'Invalid backup code'
            });
        }
        
        // Remove used backup code
        user.twoFactorBackupCodes.splice(codeIndex, 1);
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Backup code accepted',
            remainingCodes: user.twoFactorBackupCodes.length
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Backup code verification error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to verify backup code'
        });
    }
});

// ============================================================================
// AVATAR UPLOAD
// ============================================================================

const multer = require('multer');
let sharp = null;
try {
    sharp = require('sharp');
} catch (err) {
    console.warn('[Darklock Profile] sharp not installed; avatar processing disabled');
}
const fs = require('fs').promises;

// Setup multer for avatar uploads
const avatarStorage = multer.memoryStorage();
const avatarUpload = multer({
    storage: avatarStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Only PNG, JPEG, and WebP images are allowed'));
        }
    }
});

/**
 * POST /profile/api/avatar - Upload avatar
 */
router.post('/api/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
    try {
        if (!sharp) {
            return res.status(503).json({
                success: false,
                error: 'Avatar processing is unavailable (missing sharp dependency)'
            });
        }
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No image file provided'
            });
        }
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Process image with sharp (resize and optimize)
        const processedImage = await sharp(req.file.buffer)
            .resize(256, 256, { fit: 'cover' })
            .jpeg({ quality: 90 })
            .toBuffer();
        
        // Create avatars directory if it doesn't exist
        const avatarsDir = path.join(DATA_DIR, 'avatars');
        await fs.mkdir(avatarsDir, { recursive: true });
        
        // Generate filename
        const filename = `${user.id}-${Date.now()}.jpg`;
        const filepath = path.join(avatarsDir, filename);
        
        // Save file
        await fs.writeFile(filepath, processedImage);
        
        // Delete old avatar if exists
        if (user.avatar && user.avatar.startsWith('/platform/avatars/')) {
            const oldFilename = path.basename(user.avatar);
            const oldFilepath = path.join(avatarsDir, oldFilename);
            try {
                await fs.unlink(oldFilepath);
            } catch (err) {
                // Ignore errors if old file doesn't exist
            }
        }
        
        // Update user record
        user.avatar = `/platform/avatars/${filename}`;
        await saveUsers(usersData);
        
        res.json({
            success: true,
            avatarUrl: user.avatar
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Avatar upload error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to upload avatar'
        });
    }
});

// ============================================================================
// PERSONAL INFO
// ============================================================================

/**
 * PUT /profile/api/info - Update personal information
 */
router.put('/api/info', requireAuth, async (req, res) => {
    try {
        const { displayName, timezone, language } = req.body;
        
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Validate display name
        if (displayName !== undefined) {
            if (displayName.length > 50) {
                return res.status(400).json({
                    success: false,
                    error: 'Display name must be 50 characters or less'
                });
            }
            user.displayName = displayName;
        }
        
        // Validate and update timezone
        if (timezone !== undefined) {
            user.timezone = timezone;
        }
        
        // Validate and update language
        if (language !== undefined) {
            user.language = language;
        }
        
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Personal info updated successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Personal info update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update personal info'
        });
    }
});

// ============================================================================
// PREFERENCES
// ============================================================================

/**
 * PUT /profile/api/preferences - Update user preferences
 */
router.put('/api/preferences', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Initialize preferences if not exists
        if (!user.preferences) {
            user.preferences = {};
        }
        
        // Update preferences (only allow specific keys)
        const allowedKeys = ['theme', 'reducedMotion', 'compactLayout'];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                user.preferences[key] = req.body[key];
            }
        }
        
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Preferences updated successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Preferences update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update preferences'
        });
    }
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * PUT /profile/api/notifications - Update notification settings
 */
router.put('/api/notifications', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Initialize notifications if not exists
        if (!user.notifications) {
            user.notifications = {};
        }
        
        // Update notification settings (only allow specific keys)
        const allowedKeys = ['securityAlerts', 'productUpdates', 'emailNotifications'];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                user.notifications[key] = req.body[key];
            }
        }
        
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Notification settings updated successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Notifications update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update notification settings'
        });
    }
});

// ============================================================================
// SETTINGS
// ============================================================================

/**
 * PUT /profile/api/settings - Update platform settings
 */
router.put('/api/settings', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Initialize settings if not exists
        if (!user.settings) {
            user.settings = {};
        }
        
        // Update settings (only allow specific keys)
        const allowedKeys = ['defaultLandingPage', 'rememberLastApp', 'fontScaling', 'highContrast', 'betaFeatures'];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                user.settings[key] = req.body[key];
            }
        }
        
        await saveUsers(usersData);
        
        res.json({
            success: true,
            message: 'Settings updated successfully'
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Settings update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update settings'
        });
    }
});

// ============================================================================
// ACCOUNT MANAGEMENT
// ============================================================================

/**
 * POST /profile/api/disable - Disable user account
 * Requires password verification
 */
router.post('/api/disable', requireAuth, async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Password is required'
            });
        }

        const { source, user, usersData } = await getUserRecord(req.user.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }

        if (source === 'db') {
            await db.updateUser(user.id, { active: 0 });
            await db.revokeAllUserSessions(user.id);
        } else {
            user.active = false;
            user.disabledAt = new Date().toISOString();

            await saveUsers(usersData);

            const sessionsData = await loadSessions();
            sessionsData.sessions = sessionsData.sessions.filter(s => s.userId !== user.id);
            await saveSessions(sessionsData);
        }

        console.log(`[Darklock Profile] Account disabled: ${user.username}`);

        res.json({
            success: true,
            message: 'Account disabled successfully'
        });
    } catch (err) {
        console.error('[Darklock Profile] Account disable error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to disable account'
        });
    }
});

/**
 * DELETE /profile/api/delete - Permanently delete user account
 * Requires password verification and 2FA if enabled
 */
router.delete('/api/delete', requireAuth, async (req, res) => {
    try {
        const { password, totpCode } = req.body;

        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Password is required'
            });
        }

        const { source, user, usersData } = await getUserRecord(req.user.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const role = user.role || user.role_name || user.roleName;
        if (role === 'owner' || role === 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete admin accounts. Please contact system administrator.'
            });
        }

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }

        const twoFactorEnabled = source === 'db'
            ? (user.two_factor_enabled === 1 || user.two_factor_enabled === true)
            : !!user.twoFactorEnabled;

        if (twoFactorEnabled) {
            if (!totpCode) {
                return res.status(400).json({
                    success: false,
                    error: '2FA code is required'
                });
            }

            const verified = speakeasy.totp.verify({
                secret: source === 'db' ? user.two_factor_secret : user.twoFactorSecret,
                encoding: 'base32',
                token: totpCode,
                window: 2
            });

            if (!verified) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid 2FA code'
                });
            }
        }

        if (source === 'db') {
            await db.revokeAllUserSessions(user.id);
            await db.run(`DELETE FROM users WHERE id = ?`, [user.id]);
        } else {
            usersData.users = usersData.users.filter(u => u.id !== user.id);
            await saveUsers(usersData);

            const sessionsData = await loadSessions();
            sessionsData.sessions = sessionsData.sessions.filter(s => s.userId !== user.id);
            await saveSessions(sessionsData);
        }

        console.log(`[Darklock Profile] Account deleted: ${user.username} (${user.email})`);

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (err) {
        console.error('[Darklock Profile] Account delete error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete account'
        });
    }
});

module.exports = router;
