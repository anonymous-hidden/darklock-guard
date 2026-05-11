/**
 * Darklock Platform - Polls/Voting Routes
 *
 * Handles:
 *   GET  /platform/polls           – polls list page
 *   GET  /platform/api/polls       – get all polls JSON
 *   GET  /platform/api/polls/:id   – get single poll JSON
 *   POST /platform/api/polls       – create new poll (admin only)
 *   POST /platform/api/polls/:id/vote – vote on poll
 *   DELETE /platform/api/polls/:id – delete poll (admin only)
 */

'use strict';

const path = require('path');
const express = require('express');
const db = require('../utils/database');
const { requireEnv } = require('../utils/env-validator');

const router = express.Router();

// Platform user auth middleware
function requirePlatformAuth(req, res, next) {
    const token = req.cookies?.darklock_token;
    if (!token) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        return res.redirect('/platform/auth/login');
    }
    
    try {
        const jwt = require('jsonwebtoken');
        const secret = requireEnv('JWT_SECRET');
        const decoded = jwt.verify(token, secret);
        req.user = { id: decoded.userId, username: decoded.username, email: decoded.email };
        next();
    } catch (err) {
        res.clearCookie('darklock_token');
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        return res.redirect('/platform/auth/login');
    }
}

// Admin check middleware
async function requireAdmin(req, res, next) {
    // For now, we'll allow any authenticated user to create polls
    // In the future, add a proper role check
    next();
}

// Initialize polls table
async function initializePollsTable() {
    try {
        await db.run(`
            CREATE TABLE IF NOT EXISTS polls (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                type TEXT DEFAULT 'feature',
                status TEXT DEFAULT 'open',
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS poll_options (
                id TEXT PRIMARY KEY,
                poll_id TEXT NOT NULL,
                option_text TEXT NOT NULL,
                votes INTEGER DEFAULT 0,
                FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS poll_votes (
                id TEXT PRIMARY KEY,
                poll_id TEXT NOT NULL,
                option_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(poll_id, user_id),
                FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
                FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
            )
        `);

        console.log('[Polls] Database tables initialized');
    } catch (err) {
        console.error('[Polls] Table initialization error:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/polls - Polls page
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requirePlatformAuth, async (req, res) => {
    try {
        const polls = await db.all(`
            SELECT p.*, COUNT(DISTINCT pv.id) as total_votes
            FROM polls p
            LEFT JOIN poll_votes pv ON p.id = pv.poll_id
            WHERE p.status = 'open'
            ORDER BY p.created_at DESC
            LIMIT 50
        `);

        const enriched = await Promise.all((polls || []).map(async (poll) => {
            const options = await db.all(`
                SELECT id, option_text, votes FROM poll_options WHERE poll_id = ?
            `, [poll.id]);
            
            // Check if user already voted
            const userVote = await db.get(`
                SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?
            `, [poll.id, req.user?.id]);

            return {
                ...poll,
                options: options || [],
                userVoted: !!userVote,
                userVoteOptionId: userVote?.option_id
            };
        }));

        res.json({
            success: true,
            polls: enriched
        });
    } catch (err) {
        console.error('[Polls] Fetch error:', err);
        res.json({ success: false, error: 'Failed to load polls', polls: [] });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/polls/api/polls - Get all polls (JSON API)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/polls', async (req, res) => {
    try {
        const polls = await db.all(`
            SELECT p.*, COUNT(DISTINCT pv.id) as total_votes
            FROM polls p
            LEFT JOIN poll_votes pv ON p.id = pv.poll_id
            WHERE p.status = 'open'
            ORDER BY p.created_at DESC
            LIMIT 50
        `);

        const enriched = await Promise.all((polls || []).map(async (poll) => {
            const options = await db.all(`
                SELECT id, option_text, votes FROM poll_options WHERE poll_id = ?
            `, [poll.id]);
            
            return {
                ...poll,
                options: options || []
            };
        }));

        res.json({
            success: true,
            polls: enriched
        });
    } catch (err) {
        console.error('[Polls API] Fetch error:', err);
        res.status(500).json({ success: false, error: 'Failed to load polls' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/polls/api/polls/:id - Get single poll
// ─────────────────────────────────────────────────────────────────────────────
router.get('/polls/:id', async (req, res) => {
    try {
        const poll = await db.get(`
            SELECT * FROM polls WHERE id = ?
        `, [req.params.id]);

        if (!poll) {
            return res.status(404).json({ success: false, error: 'Poll not found' });
        }

        const options = await db.all(`
            SELECT id, option_text, votes FROM poll_options WHERE poll_id = ?
        `, [poll.id]);

        res.json({
            success: true,
            poll: { ...poll, options: options || [] }
        });
    } catch (err) {
        console.error('[Polls API] Get error:', err);
        res.status(500).json({ success: false, error: 'Failed to load poll' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /platform/polls/api/polls - Create new poll (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/polls', requirePlatformAuth, requireAdmin, async (req, res) => {
    try {
        const { title, description, type, options } = req.body;

        if (!title || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Poll must have a title and at least 2 options'
            });
        }

        const pollId = require('crypto').randomUUID();
        const now = new Date().toISOString();

        // Create poll
        await db.run(`
            INSERT INTO polls (id, title, description, type, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [pollId, title, description || null, type || 'feature', req.user?.id, now, now]);

        // Add options
        for (const optionText of options) {
            const optionId = require('crypto').randomUUID();
            await db.run(`
                INSERT INTO poll_options (id, poll_id, option_text, votes)
                VALUES (?, ?, ?, 0)
            `, [optionId, pollId, optionText]);
        }

        res.json({
            success: true,
            message: 'Poll created successfully',
            pollId
        });
    } catch (err) {
        console.error('[Polls API] Create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create poll' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /platform/polls/api/polls/:id/vote - Vote on poll
// ─────────────────────────────────────────────────────────────────────────────
router.post('/polls/:id/vote', requirePlatformAuth, async (req, res) => {
    try {
        const { optionId } = req.body;
        const pollId = req.params.id;
        const userId = req.user?.id;

        if (!optionId) {
            return res.status(400).json({ success: false, error: 'Option ID required' });
        }

        // Check if poll exists
        const poll = await db.get(`SELECT * FROM polls WHERE id = ?`, [pollId]);
        if (!poll) {
            return res.status(404).json({ success: false, error: 'Poll not found' });
        }

        // Check if poll is open
        if (poll.status !== 'open') {
            return res.status(400).json({ success: false, error: 'Poll is closed' });
        }

        // Check if user already voted
        const existingVote = await db.get(`
            SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?
        `, [pollId, userId]);

        if (existingVote) {
            return res.status(400).json({ success: false, error: 'You have already voted on this poll' });
        }

        // Verify option exists
        const option = await db.get(`
            SELECT id FROM poll_options WHERE id = ? AND poll_id = ?
        `, [optionId, pollId]);

        if (!option) {
            return res.status(400).json({ success: false, error: 'Invalid option' });
        }

        // Record vote
        const voteId = require('crypto').randomUUID();
        await db.run(`
            INSERT INTO poll_votes (id, poll_id, option_id, user_id)
            VALUES (?, ?, ?, ?)
        `, [voteId, pollId, optionId, userId]);

        // Update vote count
        await db.run(`
            UPDATE poll_options SET votes = votes + 1 WHERE id = ?
        `, [optionId]);

        // Update poll timestamp
        await db.run(`
            UPDATE polls SET updated_at = ? WHERE id = ?
        `, [new Date().toISOString(), pollId]);

        res.json({ success: true, message: 'Vote recorded' });
    } catch (err) {
        console.error('[Polls API] Vote error:', err);
        res.status(500).json({ success: false, error: 'Failed to record vote' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /platform/polls/api/polls/:id - Delete poll (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/polls/:id', requirePlatformAuth, requireAdmin, async (req, res) => {
    try {
        const pollId = req.params.id;

        // Delete poll and cascade delete options and votes
        await db.run(`DELETE FROM polls WHERE id = ?`, [pollId]);

        res.json({ success: true, message: 'Poll deleted' });
    } catch (err) {
        console.error('[Polls API] Delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete poll' });
    }
});

module.exports = {
    router,
    initializePollsTable
};
