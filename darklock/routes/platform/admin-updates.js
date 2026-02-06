/**
 * Darklock Platform - Admin Updates API
 * Admin-only endpoints for creating and managing platform updates
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Database
const db = require('../../utils/database');

// Email service
const emailService = require('../../utils/email');

/**
 * Admin authentication middleware
 */
async function requireAdmin(req, res, next) {
    try {
        const jwt = require('jsonwebtoken');
        const { requireEnv } = require('../../utils/env-validator');
        
        const token = req.cookies?.admin_token;
        
        // Check if this is an API request (JSON)
        const isApiRequest = req.xhr || 
            req.headers.accept?.includes('application/json') ||
            req.headers['content-type']?.includes('application/json') ||
            req.path.startsWith('/api/');
        
        if (!token) {
            if (isApiRequest) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            return res.redirect('/signin');
        }
        
        // Use the same secret as admin-auth.js
        const ADMIN_JWT_SECRET = requireEnv('ADMIN_JWT_SECRET');
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
        
        // For admin JWTs, the payload has adminId and role
        if (!decoded.adminId || decoded.type !== 'admin') {
            if (isApiRequest) {
                return res.status(403).json({
                    success: false,
                    error: 'Invalid token type'
                });
            }
            return res.redirect('/signin');
        }
        
        req.user = decoded;
        req.adminUser = { id: decoded.adminId, email: decoded.email, role: decoded.role };
        next();
    } catch (err) {
        console.error('[Admin Updates] Auth error:', err);
        res.clearCookie('admin_token');
        
        // Check if this is an API request
        const isApiRequest = req.xhr || 
            req.headers.accept?.includes('application/json') ||
            req.headers['content-type']?.includes('application/json') ||
            req.path.startsWith('/api/');
        
        if (isApiRequest) {
            return res.status(401).json({
                success: false,
                error: 'Authentication failed'
            });
        }
        return res.redirect('/signin');
    }
}

/**
 * Validate semantic version format
 */
function isValidVersion(version) {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
}

/**
 * Compare semantic versions
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return 1;
        if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
}

/**
 * POST /admin/updates - Create a new update (admin only)
 */
router.post('/admin/updates', requireAdmin, async (req, res) => {
    try {
        const { title, version, type, content } = req.body;
        
        // Validate required fields
        if (!title || !version || !type || !content) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required (title, version, type, content)'
            });
        }
        
        // Validate version format
        if (!isValidVersion(version)) {
            return res.status(400).json({
                success: false,
                error: 'Version must be in semantic format (e.g., 2.1.0)'
            });
        }
        
        // Validate update type
        const validTypes = ['major', 'minor', 'bugfix'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Type must be one of: major, minor, bugfix'
            });
        }
        
        // Check if version already exists
        const allUpdates = await db.getAllUpdates();
        const existingVersion = allUpdates.find(u => u.version === version);
        if (existingVersion) {
            return res.status(400).json({
                success: false,
                error: 'Version already exists'
            });
        }
        
        // Validate version is greater than latest
        const latestUpdate = await db.getLatestUpdate();
        if (latestUpdate && compareVersions(version, latestUpdate.version) <= 0) {
            return res.status(400).json({
                success: false,
                error: `Version must be greater than latest version (${latestUpdate.version})`
            });
        }
        
        // Create update
        const updateId = crypto.randomBytes(16).toString('hex');
        const newUpdate = await db.createUpdate({
            id: updateId,
            title: title.trim(),
            version: version.trim(),
            type,
            content: content.trim(),
            createdBy: req.user.userId
        });
        
        console.log(`[Admin Updates] New update created: v${version} by ${req.user.username}`);
        
        // Send emails to opted-in users (async, non-blocking)
        sendUpdateEmails(newUpdate)
            .catch(err => console.error('[Admin Updates] Failed to send emails:', err));
        
        res.json({
            success: true,
            message: 'Update published successfully',
            update: newUpdate
        });
        
    } catch (err) {
        console.error('[Admin Updates] Create update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to create update'
        });
    }
});

/**
 * Send update notification emails to opted-in users
 */
async function sendUpdateEmails(update) {
    try {
        const users = await db.getUsersWithEmailOptIn();
        
        if (users.length === 0) {
            console.log('[Admin Updates] No users opted in for email updates');
            return;
        }
        
        console.log(`[Admin Updates] Sending update emails to ${users.length} users...`);
        
        // Send emails (could be batched or queued in production)
        const emailPromises = users.map(user => 
            emailService.sendUpdateEmail(user.email, user.username, update)
                .catch(err => console.error(`[Admin Updates] Failed to send to ${user.email}:`, err))
        );
        
        await Promise.allSettled(emailPromises);
        
        console.log('[Admin Updates] Update emails sent');
    } catch (err) {
        console.error('[Admin Updates] Email dispatch error:', err);
    }
}

/**
 * GET /admin/updates - Get all updates (admin only)
 */
router.get('/admin/updates', requireAdmin, async (req, res) => {
    try {
        const updates = await db.getAllUpdates();
        
        res.json({
            success: true,
            updates: updates || []
        });
    } catch (err) {
        console.error('[Admin Updates] Get updates error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load updates'
        });
    }
});

/**
 * PUT /admin/updates/:id - Update an existing update (admin only)
 */
router.put('/admin/updates/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, version, type, content } = req.body;
        
        // Validate required fields
        if (!title || !version || !type || !content) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required (title, version, type, content)'
            });
        }
        
        // Validate version format
        if (!isValidVersion(version)) {
            return res.status(400).json({
                success: false,
                error: 'Version must be in semantic format (e.g., 2.1.0)'
            });
        }
        
        // Validate update type
        const validTypes = ['major', 'minor', 'bugfix'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Type must be one of: major, minor, bugfix'
            });
        }

        // Check if update exists
        const existingUpdate = await db.getUpdateById(id);
        if (!existingUpdate) {
            return res.status(404).json({
                success: false,
                error: 'Update not found'
            });
        }

        // Check if version is being changed to an existing version
        if (version !== existingUpdate.version) {
            const allUpdates = await db.getAllUpdates();
            const duplicateVersion = allUpdates.find(u => u.version === version && u.id !== id);
            if (duplicateVersion) {
                return res.status(400).json({
                    success: false,
                    error: 'Version already exists'
                });
            }
        }
        
        // Update the update
        const updatedUpdate = await db.updateUpdate(id, {
            title: title.trim(),
            version: version.trim(),
            type,
            content: content.trim()
        });
        
        console.log(`[Admin Updates] Update edited: v${version} (${id}) by ${req.user.username || req.adminUser.email}`);
        
        res.json({
            success: true,
            message: 'Update saved successfully',
            update: updatedUpdate
        });
        
    } catch (err) {
        console.error('[Admin Updates] Update update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update update'
        });
    }
});

/**
 * DELETE /admin/updates/:id - Delete an update (admin only)
 */
router.delete('/admin/updates/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if update exists
        const existingUpdate = await db.getUpdateById(id);
        if (!existingUpdate) {
            return res.status(404).json({
                success: false,
                error: 'Update not found'
            });
        }

        // Delete the update
        await db.deleteUpdate(id);
        
        console.log(`[Admin Updates] Update deleted: v${existingUpdate.version} (${id}) by ${req.user.username || req.adminUser.email}`);
        
        res.json({
            success: true,
            message: 'Update deleted successfully'
        });
        
    } catch (err) {
        console.error('[Admin Updates] Delete update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete update'
        });
    }
});

module.exports = router;
