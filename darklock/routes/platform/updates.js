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
 * GET /api/updates - Get all published updates (public API)
 */
router.get('/api/updates', async (req, res) => {
    try {
        const updates = await db.getAllUpdates();
        
        res.json({
            success: true,
            updates: updates || []
        });
    } catch (err) {
        console.error('[Updates API] Get updates error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load updates'
        });
    }
});

/**
 * GET /api/updates/:id - Get a specific update (public API)
 */
router.get('/api/updates/:id', async (req, res) => {
    try {
        const update = await db.getUpdateById(req.params.id);
        
        if (!update) {
            return res.status(404).json({
                success: false,
                error: 'Update not found'
            });
        }
        
        res.json({
            success: true,
            update
        });
    } catch (err) {
        console.error('[Updates API] Get update error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to load update'
        });
    }
});

module.exports = router;
