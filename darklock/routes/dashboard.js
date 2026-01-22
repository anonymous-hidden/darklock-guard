/**
 * Darklock Platform - Dashboard Routes
 * Serves the main dashboard and handles dashboard-specific API endpoints
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Security utilities
const { isSessionValid, safeReadJSON } = require('../utils/security');

// Data paths
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

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
        const secret = process.env.JWT_SECRET || 'darklock-secret-key-change-in-production';
        const decoded = jwt.verify(token, secret);
        
        // Validate session via jti (ensures revoked sessions are rejected)
        const sessionsData = await safeReadJSON(SESSIONS_FILE, { sessions: [] });
        if (!isSessionValid(decoded.jti, decoded.userId, sessionsData)) {
            throw new Error('Session revoked');
        }
        
        req.user = decoded;
        next();
    } catch (err) {
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
    return await safeReadJSON(USERS_FILE, { users: [] });
}

/**
 * Save users to storage (async)
 */
async function saveUsers(data) {
    const { atomicWriteJSON } = require('../utils/security');
    try {
        await atomicWriteJSON(USERS_FILE, data);
        return true;
    } catch (err) {
        console.error('[Darklock Dashboard] Error saving users:', err.message);
        return false;
    }
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

module.exports = { router, requireAuth };
