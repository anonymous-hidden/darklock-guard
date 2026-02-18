/**
 * Team Management API Routes
 * Handles team member CRUD operations with role-based access
 * Roles: helper, mod, admin, co-owner, owner (protected)
 */

const express = require('express');
const router = express.Router();
const { requireAdminAuth } = require('./admin-auth');
const db = require('../utils/database');

// Role hierarchy (higher = more power)
const ROLE_HIERARCHY = {
    'helper': 1,
    'mod': 2,
    'admin': 3,
    'co-owner': 4,
    'owner': 5
};

const ROLE_PRESETS = {
    'helper': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: false,
        canBanUsers: false,
        canManageRoles: false,
        canManageServer: false,
        canAccessDashboard: true,
        canViewAnalytics: false,
        canManageBot: false
    },
    'mod': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: false,
        canManageServer: false,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: false
    },
    'admin': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: false
    },
    'co-owner': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true, canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: true
    },
    'owner': {
        canViewLogs: true,
        canManageTickets: true,
        canWarnUsers: true,
        canKickUsers: true,
        canBanUsers: true,
        canManageRoles: true,
        canManageServer: true,
        canAccessDashboard: true,
        canViewAnalytics: true,
        canManageBot: true
    }
};

/**
 * Initialize team management schema
 */
async function initializeTeamSchema() {
    try {
        // Team members table
        await db.run(`
            CREATE TABLE IF NOT EXISTS team_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                discord_id TEXT,
                added_by TEXT NOT NULL,
                added_at TEXT NOT NULL,
                last_active TEXT,
                is_active INTEGER DEFAULT 1,
                CONSTRAINT valid_role CHECK (role IN ('helper', 'mod', 'admin', 'co-owner', 'owner'))
            )
        `);

        // Role permissions table
        await db.run(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT UNIQUE NOT NULL,
                permissions TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CONSTRAINT valid_role CHECK (role IN ('helper', 'mod', 'admin', 'co-owner', 'owner'))
            )
        `);

        // Initialize default permissions if not exists
        for (const [role, perms] of Object.entries(ROLE_PRESETS)) {
            const existing = await db.get('SELECT * FROM role_permissions WHERE role = ?', [role]);
            if (!existing) {
                await db.run(
                    'INSERT INTO role_permissions (role, permissions, updated_by, updated_at) VALUES (?, ?, ?, ?)',
                    [role, JSON.stringify(perms), 'system', new Date().toISOString()]
                );
            }
        }

        console.log('[Team Management] Schema initialized');
    } catch (error) {
        console.error('[Team Management] Schema error:', error);
    }
}

// Middleware to check if user can manage team
async function canManageTeam(req, res, next) {
    const userEmail = req.admin?.email;
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const member = await db.get('SELECT * FROM team_members WHERE email = ? AND is_active = 1', [userEmail]);
    if (!member || ROLE_HIERARCHY[member.role] < ROLE_HIERARCHY['admin']) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }

    req.userRole = member.role;
    req.userEmail = userEmail;
    next();
}

// GET /api/team - List all team members
router.get('/', requireAdminAuth, async (req, res) => {
    try {
        const members = await db.all('SELECT * FROM team_members WHERE is_active = 1 ORDER BY id ASC');
        res.json({ success: true, members });
    } catch (error) {
        console.error('[Team API] List error:', error);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});

// POST /api/team - Add team member
router.post('/', requireAdminAuth, canManageTeam, async (req, res) => {
    try {
        const { email, username, role, discord_id } = req.body;

        // Validation
        if (!email || !username || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!ROLE_HIERARCHY[role]) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Prevent adding owner role
        if (role === 'owner') {
            return res.status(403).json({ error: 'Cannot add owner role' });
        }

        // Check if requester has permission to add this role
        if (ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[req.userRole]) {
            return res.status(403).json({ error: 'Cannot add member with equal or higher role' });
        }

        // Check if email already exists
        const existing = await db.get('SELECT * FROM team_members WHERE email = ?', [email]);
        if (existing) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const now = new Date().toISOString();
        await db.run(
            'INSERT INTO team_members (email, username, role, discord_id, added_by, added_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [email, username, role, discord_id || null, req.userEmail, now]
        );

        res.json({ success: true, message: 'Team member added successfully' });
    } catch (error) {
        console.error('[Team API] Add error:', error);
        res.status(500).json({ error: 'Failed to add team member' });
    }
});

// PUT /api/team/:id - Update team member
router.put('/:id', requireAdminAuth, canManageTeam, async (req, res) => {
    try {
        const { id } = req.params;
        const { role, username, discord_id } = req.body;

        const member = await db.get('SELECT * FROM team_members WHERE id = ?', [id]);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Cannot modify owner
        if (member.role === 'owner') {
            return res.status(403).json({ error: 'Cannot modify owner' });
        }

        // Check permission to modify
        if (ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[req.userRole]) {
            return res.status(403).json({ error: 'Cannot modify member with equal or higher role' });
        }

        if (role && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[req.userRole]) {
            return res.status(403).json({ error: 'Cannot assign equal or higher role' });
        }

        // Prevent setting owner role
        if (role === 'owner') {
            return res.status(403).json({ error: 'Cannot assign owner role' });
        }

        const updates = [];
        const values = [];

        if (role && ROLE_HIERARCHY[role]) {
            updates.push('role = ?');
            values.push(role);
        }
        if (username) {
            updates.push('username = ?');
            values.push(username);
        }
        if (discord_id !== undefined) {
            updates.push('discord_id = ?');
            values.push(discord_id || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        values.push(id);
        await db.run(`UPDATE team_members SET ${updates.join(', ')} WHERE id = ?`, values);

        res.json({ success: true, message: 'Team member updated successfully' });
    } catch (error) {
        console.error('[Team API] Update error:', error);
        res.status(500).json({ error: 'Failed to update team member' });
    }
});

// DELETE /api/team/:id - Remove team member
router.delete('/:id', requireAdminAuth, canManageTeam, async (req, res) => {
    try {
        const { id } = req.params;

        const member = await db.get('SELECT * FROM team_members WHERE id = ?', [id]);
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Cannot remove owner
        if (member.role === 'owner') {
            return res.status(403).json({ error: 'Cannot remove owner' });
        }

        // Check permission
        if (ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[req.userRole]) {
            return res.status(403).json({ error: 'Cannot remove member with equal or higher role' });
        }

        await db.run('UPDATE team_members SET is_active = 0 WHERE id = ?', [id]);

        res.json({ success: true, message: 'Team member removed successfully' });
    } catch (error) {
        console.error('[Team API] Delete error:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// GET /api/team/permissions - Get all role permissions
router.get('/permissions', requireAdminAuth, async (req, res) => {
    try {
        const permissions = await db.all('SELECT * FROM role_permissions ORDER BY role ASC');
        const formatted = {};
        for (const perm of permissions) {
            formatted[perm.role] = JSON.parse(perm.permissions);
        }
        res.json({ success: true, permissions: formatted });
    } catch (error) {
        console.error('[Team API] Get permissions error:', error);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});

// PUT /api/team/permissions - Update role permissions
router.put('/permissions', requireAdminAuth, canManageTeam, async (req, res) => {
    try {
        const { role, permission, value } = req.body;

        if (!ROLE_HIERARCHY[role]) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Cannot modify owner permissions
        if (role === 'owner') {
            return res.status(403).json({ error: 'Cannot modify owner permissions' });
        }

        // Check permission (only owner can modify co-owner, admins can modify below)
        if (role === 'co-owner' && req.userRole !== 'owner') {
            return res.status(403).json({ error: 'Only owner can modify co-owner permissions' });
        }

        if (ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[req.userRole]) {
            return res.status(403).json({ error: 'Cannot modify permissions for equal or higher role' });
        }

        // Get existing permissions
        const existing = await db.get('SELECT * FROM team_role_permissions WHERE role = ?', [role]);
        if (!existing) {
            return res.status(404).json({ error: 'Role permissions not found' });
        }

        const permissions = JSON.parse(existing.permissions);
        permissions[permission] = value;

        const now = new Date().toISOString();
        const userEmail = req.admin?.email || req.userEmail || 'admin';
        
        await db.run(
            'UPDATE team_role_permissions SET permissions = ?, updated_by = ?, updated_at = ? WHERE role = ?',
            [JSON.stringify(permissions), userEmail, now, role]
        );

        res.json({ success: true, message: 'Permission updated successfully' });
    } catch (error) {
        console.error('[Team API] Update permissions error:', error);
        res.status(500).json({ error: 'Failed to update permissions' });
    }
});

module.exports = { router, initializeTeamSchema };
