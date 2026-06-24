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

function parseObjectField(value) {
    if (!value) {
        return {};
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
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
        
        // Also store in DB for cross-source consistency
        await db.updateUser(req.user.userId, {
            two_factor_secret: secret.base32
        });
        
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
        const hashedBackupCodes = backupCodes.map(code => 
            bcrypt.hashSync(code, 10)
        );
        user.twoFactorBackupCodes = hashedBackupCodes;
        
        await saveUsers(usersData);
        
        // Sync 2FA state to database
        await db.updateUser(req.user.userId, {
            two_factor_enabled: 1,
            two_factor_secret: user.twoFactorSecret,
            two_factor_backup_codes: JSON.stringify(hashedBackupCodes),
            two_factor_enabled_at: user.twoFactorEnabledAt
        });
        
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
        
        // Sync 2FA disable to database
        await db.updateUser(req.user.userId, {
            two_factor_enabled: 0,
            two_factor_secret: null,
            two_factor_backup_codes: null,
            two_factor_enabled_at: null
        });
        
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
        
        let hasBackupCodes = false;
        try {
            const parsedCodes = user.two_factor_backup_codes
                ? JSON.parse(user.two_factor_backup_codes)
                : [];
            hasBackupCodes = Array.isArray(parsedCodes) && parsedCodes.length > 0;
        } catch {
            hasBackupCodes = false;
        }

        res.json({
            success: true,
            twoFactor: {
                enabled: user.two_factor_enabled || false,
                enabledAt: user.two_factor_enabled_at || null,
                hasBackupCodes
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
        
        const totp2faSecret = source === 'db' ? user.two_factor_secret : user.twoFactorSecret;
        const verified = speakeasy.totp.verify({
            secret: totp2faSecret,
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
        const hashedCodes = backupCodes.map(c => bcrypt.hashSync(c, 10));
        
        if (source === 'json') {
            user.twoFactorBackupCodes = hashedCodes;
            await saveUsers(usersData);
        }
        
        // Always sync to database
        await db.updateUser(req.user.userId, {
            two_factor_backup_codes: JSON.stringify(hashedCodes)
        });
        
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
 * Requires authentication and rate limiting to prevent brute-force
 */
router.post('/api/2fa/verify-backup', requireAuth, rateLimitMiddleware('2fa'), async (req, res) => {
    try {
        const { backupCode } = req.body;
        
        if (!backupCode) {
            return res.status(400).json({
                success: false,
                error: 'Backup code is required'
            });
        }
        
        // Use authenticated user identity, never trust client-supplied username
        const username = req.user.username;
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
        
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        
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
        const oldAvatar = user.avatar;
        if (oldAvatar && oldAvatar.startsWith('/platform/avatars/')) {
            const oldFilename = path.basename(oldAvatar);
            const oldFilepath = path.join(avatarsDir, oldFilename);
            try { await fs.unlink(oldFilepath); } catch (e) { /* ignore */ }
        }
        
        // Update user record
        const avatarUrl = `/platform/avatars/${filename}`;
        if (source === 'json') {
            user.avatar = avatarUrl;
            await saveUsers(usersData);
        }
        
        // Always sync avatar to database
        await db.updateUser(req.user.userId, { avatar: avatarUrl });
        
        res.json({
            success: true,
            avatarUrl
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
// BANNER UPLOAD
// ============================================================================

const bannerUpload = multer({
    storage: avatarStorage, // reuse memory storage
    limits: {
        fileSize: 8 * 1024 * 1024 // 8MB limit for banners
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
 * POST /profile/api/banner - Upload profile banner
 */
router.post('/api/banner', requireAuth, bannerUpload.single('banner'), async (req, res) => {
    try {
        if (!sharp) {
            return res.status(503).json({
                success: false,
                error: 'Image processing is unavailable (missing sharp dependency)'
            });
        }
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No image file provided'
            });
        }
        
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Process banner image (wider format)
        const processedImage = await sharp(req.file.buffer)
            .resize(1200, 400, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toBuffer();
        
        // Create banners directory if it doesn't exist
        const bannersDir = path.join(DATA_DIR, 'banners');
        await fs.mkdir(bannersDir, { recursive: true });
        
        // Generate filename
        const filename = `banner-${user.id}-${Date.now()}.jpg`;
        const filepath = path.join(bannersDir, filename);
        
        // Save file
        await fs.writeFile(filepath, processedImage);
        
        // Delete old banner if exists
        const oldBanner = user.banner;
        if (oldBanner && oldBanner.startsWith('/platform/banners/')) {
            const oldFilename = path.basename(oldBanner);
            const oldFilepath = path.join(bannersDir, oldFilename);
            try { await fs.unlink(oldFilepath); } catch (e) { /* ignore */ }
        }
        
        // Update user record
        const bannerUrl = `/platform/banners/${filename}`;
        if (source === 'json') {
            user.banner = bannerUrl;
            await saveUsers(usersData);
        }
        
        // Always sync banner to database
        await db.updateUser(req.user.userId, { banner: bannerUrl });
        
        res.json({
            success: true,
            bannerUrl
        });
        
    } catch (err) {
        console.error('[Darklock Profile] Banner upload error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to upload banner'
        });
    }
});

/**
 * DELETE /profile/api/banner - Remove profile banner
 */
router.delete('/api/banner', requireAuth, async (req, res) => {
    try {
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        const currentBanner = user.banner;
        if (currentBanner && currentBanner.startsWith('/platform/banners/')) {
            const bannersDir = path.join(DATA_DIR, 'banners');
            try { await fs.unlink(path.join(bannersDir, path.basename(currentBanner))); } catch (e) { /* ignore */ }
        }
        
        if (source === 'json') { user.banner = null; await saveUsers(usersData); }
        await db.updateUser(req.user.userId, { banner: null });
        
        res.json({ success: true, message: 'Banner removed' });
    } catch (err) {
        console.error('[Darklock Profile] Banner remove error:', err);
        res.status(500).json({ success: false, error: 'Failed to remove banner' });
    }
});

/**
 * DELETE /profile/api/avatar - Remove avatar (reset to default)
 */
router.delete('/api/avatar', requireAuth, async (req, res) => {
    try {
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        const currentAvatar = user.avatar;
        if (currentAvatar && currentAvatar.startsWith('/platform/avatars/')) {
            const avatarsDir = path.join(DATA_DIR, 'avatars');
            try { await fs.unlink(path.join(avatarsDir, path.basename(currentAvatar))); } catch (e) { /* ignore */ }
        }
        
        if (source === 'json') { user.avatar = null; await saveUsers(usersData); }
        await db.updateUser(req.user.userId, { avatar: null });
        
        res.json({ success: true, message: 'Avatar removed' });
    } catch (err) {
        console.error('[Darklock Profile] Avatar remove error:', err);
        res.status(500).json({ success: false, error: 'Failed to remove avatar' });
    }
});

// ============================================================================
// PROFILE SYNC API (cross-app avatar/banner sync)
// ============================================================================

/**
 * GET /profile/api/sync - Get profile data for cross-app sync
 * Other Darklock apps call this to get current avatar/banner
 */
router.get('/api/sync', requireAuth, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            profile: {
                id: user.id,
                username: user.username,
                displayName: user.display_name || user.username,
                email: user.email,
                avatar: user.avatar || null,
                banner: user.banner || null,
                role: user.role,
                updatedAt: user.updated_at
            }
        });
    } catch (err) {
        console.error('[Darklock Profile] Sync error:', err);
        res.status(500).json({ success: false, error: 'Failed to load sync data' });
    }
});

/**
 * POST /profile/api/sync - Receive profile updates from other Darklock apps
 * When user changes avatar/banner in Secure Channel etc, it calls this to push changes
 */
router.post('/api/sync', requireAuth, async (req, res) => {
    try {
        const { avatar, banner, displayName } = req.body;
        const updates = {};
        
        if (avatar !== undefined) updates.avatar = avatar;
        if (banner !== undefined) updates.banner = banner;
        if (displayName !== undefined) updates.display_name = displayName;
        
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No updates provided' });
        }
        
        await db.updateUser(req.user.userId, updates);
        
        // Also update JSON file for backward compatibility
        const usersData = await loadUsers();
        const user = usersData.users.find(u => u.id === req.user.userId);
        if (user) {
            if (avatar !== undefined) user.avatar = avatar;
            if (banner !== undefined) user.banner = banner;
            if (displayName !== undefined) user.displayName = displayName;
            await saveUsers(usersData);
        }
        
        res.json({
            success: true,
            message: 'Profile synced across services'
        });
    } catch (err) {
        console.error('[Darklock Profile] Sync push error:', err);
        res.status(500).json({ success: false, error: 'Failed to sync profile' });
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

        const { source, user, usersData } = await getUserRecord(req.user.userId);
        const updates = {};
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Validate display name
        if (displayName !== undefined) {
            const normalizedDisplayName = String(displayName).trim();
            if (normalizedDisplayName.length > 50) {
                return res.status(400).json({
                    success: false,
                    error: 'Display name must be 50 characters or less'
                });
            }
            updates.display_name = normalizedDisplayName;
            if (source === 'json') {
                user.displayName = normalizedDisplayName;
            }
        }
        
        // Validate and update timezone
        if (timezone !== undefined) {
            const normalizedTimezone = String(timezone);
            updates.timezone = normalizedTimezone;
            if (source === 'json') {
                user.timezone = normalizedTimezone;
            }
        }
        
        // Validate and update language
        if (language !== undefined) {
            const normalizedLanguage = String(language);
            updates.language = normalizedLanguage;
            if (source === 'json') {
                user.language = normalizedLanguage;
            }
        }

        if (source === 'json') {
            await saveUsers(usersData);
        }

        if (Object.keys(updates).length > 0) {
            await db.updateUser(user.id, updates);
        }
        
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
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const preferences = parseObjectField(user.preferences);
        
        // Update preferences (only allow specific keys)
        const allowedKeys = ['theme', 'reducedMotion', 'compactLayout'];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                preferences[key] = req.body[key];
            }
        }

        if (source === 'json') {
            user.preferences = preferences;
            await saveUsers(usersData);
        }

        await db.updateUser(user.id, { preferences });
        
        res.json({
            success: true,
            message: 'Preferences updated successfully',
            preferences
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
        const { source, user, usersData } = await getUserRecord(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const notifications = parseObjectField(user.notifications);
        
        // Update notification settings (only allow specific keys)
        const allowedKeys = ['securityAlerts', 'productUpdates', 'emailNotifications'];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                notifications[key] = req.body[key];
            }
        }

        if (source === 'json') {
            user.notifications = notifications;
            await saveUsers(usersData);
        }

        await db.updateUser(user.id, { notifications });
        
        res.json({
            success: true,
            message: 'Notification settings updated successfully',
            notifications
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

// ============================================================================
// EMAIL CHANGE ROUTE
// ============================================================================

/**
 * PUT /profile/api/email - Change email address
 * Requires password confirmation and optional 2FA
 */
router.put('/api/email', requireAuth, rateLimitMiddleware('profileUpdate'), async (req, res) => {
    try {
        const { newEmail, password, totpCode } = req.body;

        if (!newEmail || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            return res.status(400).json({ success: false, error: 'Invalid email format' });
        }

        const { source, user, usersData } = await getUserRecord(req.user.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }

        // Check 2FA if enabled
        const twoFactorEnabled = source === 'db'
            ? (user.two_factor_enabled === 1 || user.two_factor_enabled === true)
            : !!user.twoFactorEnabled;

        if (twoFactorEnabled) {
            if (!totpCode) {
                return res.status(400).json({ success: false, error: '2FA code is required', requires2FA: true });
            }
            const verified = speakeasy.totp.verify({
                secret: source === 'db' ? user.two_factor_secret : user.twoFactorSecret,
                encoding: 'base32',
                token: totpCode,
                window: 2
            });
            if (!verified) {
                return res.status(401).json({ success: false, error: 'Invalid 2FA code' });
            }
        }

        // Check duplicate email
        if (source === 'db') {
            const existing = await db.getUserByEmail(newEmail.toLowerCase().trim());
            if (existing && existing.id !== user.id) {
                return res.status(400).json({ success: false, error: 'Email is already registered' });
            }
            await db.run(`UPDATE users SET email = ?, updated_at = ? WHERE id = ?`, [newEmail.toLowerCase().trim(), new Date().toISOString(), user.id]);
        } else {
            const existing = usersData.users.find(u => u.email.toLowerCase() === newEmail.toLowerCase() && u.id !== user.id);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Email is already registered' });
            }
            user.email = newEmail.toLowerCase().trim();
            user.updatedAt = new Date().toISOString();
            await saveUsers(usersData);
        }

        console.log(`[Darklock Profile] Email changed for ${user.username}: ${newEmail}`);
        res.json({ success: true, message: 'Email updated successfully' });
    } catch (err) {
        console.error('[Darklock Profile] Email change error:', err);
        res.status(500).json({ success: false, error: 'Failed to update email' });
    }
});

// ============================================================================
// USERNAME CHANGE ROUTE
// ============================================================================

/**
 * PUT /profile/api/username - Change username
 * Requires password confirmation
 */
router.put('/api/username', requireAuth, rateLimitMiddleware('profileUpdate'), async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be 3-20 characters' });
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' });
        }

        const { source, user, usersData } = await getUserRecord(req.user.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }

        // Check duplicate username
        if (source === 'db') {
            const existing = await db.getUserByUsername(username.trim());
            if (existing && existing.id !== user.id) {
                return res.status(400).json({ success: false, error: 'Username is already taken' });
            }
            await db.run(`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`, [username.trim(), new Date().toISOString(), user.id]);
        } else {
            const existing = usersData.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== user.id);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Username is already taken' });
            }
            user.username = username.trim();
            user.updatedAt = new Date().toISOString();
            await saveUsers(usersData);
        }

        console.log(`[Darklock Profile] Username changed to: ${username}`);
        res.json({ success: true, message: 'Username updated successfully', username: username.trim() });
    } catch (err) {
        console.error('[Darklock Profile] Username change error:', err);
        res.status(500).json({ success: false, error: 'Failed to update username' });
    }
});

// ============================================================================
// DATA EXPORT ROUTE
// ============================================================================

/**
 * GET /profile/api/export - Export all user data as JSON
 */
router.get('/api/export', requireAuth, async (req, res) => {
    try {
        const { source, user } = await getUserRecord(req.user.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Build export object (exclude sensitive data like password hashes)
        const exportData = {
            exportDate: new Date().toISOString(),
            platform: 'Darklock',
            account: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role || 'user',
                displayName: user.displayName || user.display_name || user.username,
                avatar: user.avatar || null,
                banner: user.banner || null,
                createdAt: user.createdAt || user.created_at,
                updatedAt: user.updatedAt || user.updated_at,
                lastLogin: user.lastLogin || user.last_login,
                lastLoginIp: user.lastLoginIp || user.last_login_ip
            },
            security: {
                twoFactorEnabled: source === 'db'
                    ? (user.two_factor_enabled === 1 || user.two_factor_enabled === true)
                    : !!user.twoFactorEnabled,
                oauthProvider: user.oauth_provider || user.oauthProvider || null
            },
            preferences: {
                language: user.language || 'en',
                region: user.region || null,
                timezone: user.timezone || 'UTC',
                settings: user.settings ? (typeof user.settings === 'string' ? JSON.parse(user.settings) : user.settings) : {},
                preferences: user.preferences ? (typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences) : {},
                notifications: user.notifications ? (typeof user.notifications === 'string' ? JSON.parse(user.notifications) : user.notifications) : {}
            }
        };

        console.log(`[Darklock Profile] Data exported for: ${user.username}`);
        res.json(exportData);
    } catch (err) {
        console.error('[Darklock Profile] Data export error:', err);
        res.status(500).json({ success: false, error: 'Failed to export data' });
    }
});

module.exports = router;
