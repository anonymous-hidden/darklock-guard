/**
 * Darklock Platform - Updates Routes
 * Handles platform updates (admin creation + public viewing)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');

// Database
const db = require('../../utils/database');

// Email service
const emailService = require('../../utils/email');

/**
 * GET /platform/update - Public updates page (no auth required)
 */
router.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, '../../views/updates.html'));
});

/**
 * GET /api/updates - Get all public announcements (public API)
 * Reads from platform_announcements (created via admin-v4 dashboard)
 */
router.get('/api/updates', async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT id, title, content, version, pinned, created_at
             FROM platform_announcements
             WHERE visibility = 'public'
             ORDER BY pinned DESC, created_at DESC`
        );

        // Shape rows to match what updates.html expects
        const updates = (rows || []).map(r => ({
            id:           r.id,
            title:        r.title,
            content:      r.content,
            version:      r.version || '—',
            type:         'announcement',
            published_at: r.created_at,
        }));

        res.json({ success: true, updates });
    } catch (err) {
        console.error('[Updates API] Get updates error:', err);
        res.status(500).json({ success: false, error: 'Failed to load updates' });
    }
});

/**
 * GET /api/updates/:id - Get a specific announcement (public API)
 */
router.get('/api/updates/:id', async (req, res) => {
    try {
        const r = await db.get(
            `SELECT id, title, content, version, pinned, created_at
             FROM platform_announcements
             WHERE id = ? AND visibility = 'public'`,
            [req.params.id]
        );

        if (!r) {
            return res.status(404).json({ success: false, error: 'Update not found' });
        }

        res.json({
            success: true,
            update: {
                id:           r.id,
                title:        r.title,
                content:      r.content,
                version:      r.version || '—',
                type:         'announcement',
                published_at: r.created_at,
            }
        });
    } catch (err) {
        console.error('[Updates API] Get update error:', err);
        res.status(500).json({ success: false, error: 'Failed to load update' });
    }
});

module.exports = router;
