/**
 * Darklock Platform - Dashboard Routes
 * Serves the main dashboard and handles dashboard-specific API endpoints
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Database
const db = require('../utils/database');
const themeManager = require('../utils/theme-manager');

// Fail-fast environment validation
const { getJwtSecret } = require('../utils/env-validator');

/**
 * Authentication middleware for dashboard routes
 * Validates both JWT and session (jti) for proper invalidation support
 */
async function requireAuth(req, res, next) {
    const token = req.cookies?.darklock_token;
    
    if (!token) {
        // For API requests, return JSON error
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        // For page requests, redirect to login
        return res.redirect('/platform/auth/login');
    }
    
    try {
        const secret = getJwtSecret();
        const decoded = jwt.verify(token, secret);
        
        // Validate session via jti (ensures revoked sessions are rejected)
        const session = await db.getSessionByJti(decoded.jti);
        if (!session || session.revoked_at) {
            throw new Error('Session revoked');
        }
        
        // Update session activity
        await db.updateSessionActivity(decoded.jti);
        
        req.user = decoded;
        next();
    } catch (err) {
        console.error('[Dashboard Auth] Error:', err.message);
        res.clearCookie('darklock_token');
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({
                success: false,
                error: 'Session expired'
            });
        }
        return res.redirect('/platform/auth/login');
    }
}

/**
 * Load users from storage (async)
 */
async function loadUsers() {
    const users = await db.getAllUsers();
    return { users };
}

/**
 * Save users to storage (async) - Not used with DB
 */
async function saveUsers(data) {
    // With database, individual user updates are handled by db.updateUser()
    console.log('[Darklock Dashboard] Note: Using database for user updates');
    return true;
}

// ============================================================================
// PAGE ROUTES
// ============================================================================

/**
 * GET /dashboard - Main dashboard page
 */
router.get('/', requireAuth, (req, res) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * GET /api/me - Get current user data
 */
router.get('/api/me', requireAuth, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Remove sensitive data
        delete user.password;
        delete user.two_factor_secret;
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.display_name,
                role: user.role,
                avatar: user.avatar,
                twoFactorEnabled: user.two_factor_enabled === 1,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                language: user.language || 'en',
                timezone: user.timezone || 'UTC'
            }
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Get user error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load user data'
        });
    }
});

/**
 * GET /dashboard/api/stats - Get dashboard statistics
 */
router.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        
        // Calculate stats
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        
        const totalUsers = usersData.users.length;
        const newUsers = usersData.users.filter(u => new Date(u.createdAt) > thirtyDaysAgo).length;
        const usersWithTwoFactor = usersData.users.filter(u => u.twoFactorEnabled).length;
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                newUsers,
                twoFactorAdoption: totalUsers > 0 ? Math.round((usersWithTwoFactor / totalUsers) * 100) : 0,
                activeApps: 1 // Discord Security Bot
            }
        });
        
    } catch (err) {
        console.error('[Darklock Dashboard] Stats error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load statistics'
        });
    }
});

/**
 * GET /dashboard/api/activity - Get recent activity
 */
router.get('/api/activity', requireAuth, async (req, res) => {
    try {
        const usersData = await loadUsers();
        
        // Get recent logins (last 10)
        const recentActivity = usersData.users
            .filter(u => u.lastLogin)
            .sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin))
            .slice(0, 10)
            .map(u => ({
                type: 'login',
                user: u.username,
                timestamp: u.lastLogin,
                description: `${u.username} signed in`
            }));
        
        res.json({
            success: true,
            activity: recentActivity
        });
        
    } catch (err) {
        console.error('[Darklock Dashboard] Activity error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load activity'
        });
    }
});

/**
 * GET /dashboard/api/apps - Get available applications
 */
router.get('/api/apps', requireAuth, (req, res) => {
    try {
        // Define available Darklock applications
        const apps = [
            {
                id: 'discord-security-bot',
                name: 'Discord Security Bot',
                description: 'Advanced Discord server protection with anti-raid, anti-nuke, verification systems, and comprehensive moderation tools.',
                icon: 'shield',
                status: 'active',
                url: '/dashboard',
                category: 'Security',
                features: ['Anti-Raid', 'Anti-Nuke', 'Verification', 'Moderation', 'Logging']
            },
            {
                id: 'threat-monitor',
                name: 'Threat Monitor',
                description: 'Real-time threat detection and alerting system for your digital infrastructure.',
                icon: 'radar',
                status: 'coming-soon',
                url: null,
                category: 'Security',
                features: ['Real-time Alerts', 'Threat Intelligence', 'Incident Response']
            },
            {
                id: 'secure-vault',
                name: 'Secure Vault',
                description: 'Encrypted credential management and secure secret storage for teams.',
                icon: 'lock',
                status: 'coming-soon',
                url: null,
                category: 'Security',
                features: ['End-to-end Encryption', 'Team Sharing', 'Access Control']
            }
        ];
        
        res.json({
            success: true,
            apps
        });
        
    } catch (err) {
        console.error('[Darklock Dashboard] Apps error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load applications'
        });
    }
});

// ============================================================================
// DEVICE STATUS API (Receives data FROM Darklock Guard desktop app)
// ============================================================================

/**
 * GET /api/devices/status
 * Returns status of all connected Darklock Guard instances
 * 
 * ARCHITECTURE NOTE:
 * - Data is PUSHED by the desktop app to this server
 * - This endpoint only READS stored device reports
 * - No file access or security operations happen here
 */
router.get('/api/devices/status', requireAuth, async (req, res) => {
    try {
        const devicesFile = path.join(DATA_DIR, 'device-status.json');
        const deviceData = await safeReadJSON(devicesFile, { devices: [], events: [], lastSync: null });
        
        // Filter devices for this user only
        const userDevices = (deviceData.devices || []).filter(d => d.userId === req.user.userId);
        const userEvents = (deviceData.events || []).filter(e => e.userId === req.user.userId).slice(0, 50);
        
        res.json({
            success: true,
            devices: userDevices,
            events: userEvents,
            lastSync: deviceData.lastSync
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Device status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load device status'
        });
    }
});

/**
 * POST /api/devices/sync
 * Receives status updates FROM Darklock Guard desktop app
 * 
 * ARCHITECTURE NOTE:
 * - The desktop app calls this endpoint to PUSH its status
 * - This is the ONLY way device data gets to the website
 * - The website cannot pull or request scans
 * 
 * Expected payload from desktop app:
 * {
 *   deviceId: string,
 *   deviceName: string,
 *   status: 'secure' | 'changed' | 'compromised' | 'offline',
 *   paths: { verified: number, changed: number, error: number },
 *   totalFiles: number,
 *   lastVerified: ISO timestamp,
 *   appVersion: string,
 *   events: [{ timestamp, type, message, severity }]
 * }
 */
router.post('/api/devices/sync', requireAuth, async (req, res) => {
    try {
        const { deviceId, deviceName, status, paths, totalFiles, lastVerified, appVersion, events } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }
        
        const devicesFile = path.join(DATA_DIR, 'device-status.json');
        const deviceData = await safeReadJSON(devicesFile, { devices: [], events: [] });
        
        // Find or create device entry
        const deviceIndex = deviceData.devices.findIndex(d => d.deviceId === deviceId && d.userId === req.user.userId);
        const deviceEntry = {
            deviceId,
            userId: req.user.userId,
            name: deviceName || 'Unknown Device',
            status: status || 'offline',
            paths: paths || { verified: 0, changed: 0, error: 0 },
            totalFiles: totalFiles || 0,
            lastVerified: lastVerified || null,
            lastSync: new Date().toISOString(),
            appVersion: appVersion || 'Unknown'
        };
        
        if (deviceIndex >= 0) {
            deviceData.devices[deviceIndex] = deviceEntry;
        } else {
            deviceData.devices.push(deviceEntry);
        }
        
        // Append events (from app)
        if (events && Array.isArray(events)) {
            const newEvents = events.map(e => ({
                ...e,
                userId: req.user.userId,
                deviceId,
                receivedAt: new Date().toISOString()
            }));
            deviceData.events = [...newEvents, ...deviceData.events].slice(0, 500); // Keep last 500 events
        }
        
        deviceData.lastSync = new Date().toISOString();
        
        // Save
        const { atomicWriteJSON } = require('../utils/security');
        await atomicWriteJSON(devicesFile, deviceData);
        
        res.json({
            success: true,
            message: 'Device status synced'
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Device sync error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to sync device status'
        });
    }
});

/**
 * POST /api/settings - Save user settings
 */
router.post('/api/settings', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const settings = req.body;
        
        // Validate settings
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid settings data'
            });
        }
        
        // Save settings to database
        await db.saveUserSettings(userId, settings);

        // Keep top-level user fields in sync when provided
        if (settings.language) {
            await db.saveUserLanguage(userId, settings.language);
        }
        
        res.json({
            success: true,
            message: 'Settings saved successfully'
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Save settings error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to save settings'
        });
    }
});

/**
 * POST /api/language - Save user language preference
 */
router.post('/api/language', requireAuth, async (req, res) => {
    try {
        const { language } = req.body;
        
        if (!language) {
            return res.status(400).json({
                success: false,
                error: 'Language is required'
            });
        }
        
        // Validate language code
        const validLanguages = ['en', 'es', 'fr', 'de', 'pt'];
        if (!validLanguages.includes(language)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid language code'
            });
        }
        
        await db.saveUserLanguage(req.user.userId, language);

        // Also store in settings JSON for consistency
        try {
            const existingSettings = await db.getUserSettings(req.user.userId);
            await db.saveUserSettings(req.user.userId, {
                ...(existingSettings || {}),
                language
            });
        } catch (settingsErr) {
            console.warn('[Darklock Dashboard] Failed to sync language to settings:', settingsErr);
        }
        
        res.json({
            success: true,
            message: 'Language saved successfully'
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Save language error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to save language'
        });
    }
});

/**
 * POST /api/region - Save user region preference
 */
router.post('/api/region', requireAuth, async (req, res) => {
    try {
        const { region } = req.body;
        
        if (!region) {
            return res.status(400).json({
                success: false,
                error: 'Region is required'
            });
        }
        
        await db.saveUserRegion(req.user.userId, region);
        
        res.json({
            success: true,
            message: 'Region saved successfully'
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Save region error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to save region'
        });
    }
});

/**
 * GET /api/settings - Get user settings
 */
router.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const settings = await db.getUserSettings(userId);
        
        res.json({
            success: true,
            settings: settings || {}
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Get settings error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load settings'
        });
    }
});

/**
 * GET /api/current-theme - Get current active theme
 * Used by client-side theme system
 */
router.get('/api/current-theme', async (req, res) => {
    try {
        const activeTheme = await themeManager.getActiveTheme();
        
        res.json({
            success: true,
            theme: activeTheme.name,
            colors: activeTheme.theme.colors,
            autoHoliday: activeTheme.autoHoliday,
            currentHoliday: activeTheme.currentHoliday
        });
    } catch (err) {
        console.error('[Darklock Dashboard] Get current theme error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load theme',
            theme: 'darklock' // Fallback to default
        });
    }
});

module.exports = { router, requireAuth };
