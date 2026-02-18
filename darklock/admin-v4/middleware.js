/**
 * Darklock Admin v4 — Middleware
 * Authentication, RBAC, rate-limiting, audit logging.
 *
 * Re-uses the existing admin auth system (admin_token cookie + ADMIN_JWT_SECRET)
 * and layers our own role-based permission checks on top.
 */

'use strict';

const jwt          = require('jsonwebtoken');
const rateLimit    = require('express-rate-limit');
const db           = require('../utils/database');
const queries      = require('./db/queries');
const { ROLE_HIERARCHY } = require('./db/schema');
const { requireEnv } = require('../utils/env-validator');

// ── Re-usable helpers ───────────────────────────────────────────────────────────

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
}

function isApiRequest(req) {
  return req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json') ||
    req.path.startsWith('/api/');
}

// ── Authentication middleware ───────────────────────────────────────────────────
// Validates admin_token JWT cookie. Sets req.admin = { id, email, role }.

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) {
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Authentication required' });
      return res.redirect('/signin');
    }

    const secret = requireEnv('ADMIN_JWT_SECRET');
    const decoded = jwt.verify(token, secret);

    if (!decoded.adminId || decoded.type !== 'admin') {
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Invalid token' });
      return res.redirect('/signin');
    }

    // Confirm admin still exists and is active
    const admin = await db.get(`SELECT id, email, role, active FROM admins WHERE id = ?`, [decoded.adminId]);
    if (!admin || !admin.active) {
      res.clearCookie('admin_token');
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Account disabled' });
      return res.redirect('/signin');
    }

    req.admin = {
      id:    admin.id,
      email: admin.email,
      role:  admin.role,
      name:  admin.email.split('@')[0], // Use email prefix as display name
      level: ROLE_HIERARCHY[admin.role] || 0,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      res.clearCookie('admin_token');
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Session expired' });
      return res.redirect('/signin');
    }
    console.error('[Admin v4] Auth error:', err);
    if (isApiRequest(req)) return res.status(500).json({ success: false, error: 'Authentication failed' });
    return res.redirect('/signin');
  }
}

// ── Role-level gate ─────────────────────────────────────────────────────────────
// requireRole('coowner') → requires level >= ROLE_HIERARCHY.coowner (90)

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, error: 'Not authenticated' });

    // Owner can do everything
    if (req.admin.role === 'owner') return next();

    const minLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] || 100));
    if (req.admin.level >= minLevel) return next();

    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  };
}

// Convenience shortcuts
const ownerOnly       = requireRole('owner');
const ownerOrCoowner  = requireRole('coowner');
const adminOrAbove    = requireRole('admin');
const modOrAbove      = requireRole('mod');
const helperOrAbove   = requireRole('helper');

// ── Permission-key gate ─────────────────────────────────────────────────────────
// Checks admin_permissions table for the admin's role.

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (req.admin.role === 'owner') return next();

    const perms = await queries.getRolePermissions(req.admin.role);
    const hasWildcard = perms.some(p => p.permission === '*' && p.granted);
    const hasSpecific = perms.some(p => p.permission === permissionKey && p.granted);

    if (hasWildcard || hasSpecific) return next();
    return res.status(403).json({ success: false, error: 'Permission denied', required: permissionKey });
  };
}

// ── Audit logger ────────────────────────────────────────────────────────────────
// Wraps req to auto-log write actions.

function auditLog(category) {
  return async (req, res, next) => {
    // Save original json method to intercept response
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      // Log non-GET successful actions
      if (req.method !== 'GET' && req.admin && res.statusCode < 400) {
        queries.logAudit({
          admin_id:    req.admin.id,
          admin_email: req.admin.email,
          action:      `${req.method} ${req.originalUrl}`,
          category,
          target_type: req.params?.id ? 'record' : null,
          target_id:   req.params?.id || null,
          ip_address:  getClientIP(req),
          user_agent:  req.headers['user-agent'],
        }).catch(err => console.error('[Admin v4] Audit log error:', err));
      }
      return originalJson(body);
    };
    next();
  };
}

// ── Rate limiters ───────────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.id || getClientIP(req),
  message: { success: false, error: 'Too many requests' },
});

const sensitiveActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.id || getClientIP(req),
  message: { success: false, error: 'Rate limit exceeded for sensitive actions' },
});

// ── Confirmation middleware ─────────────────────────────────────────────────────
// Requires { confirm: true } in request body for destructive actions.

function requireConfirmation(req, res, next) {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, error: 'Confirmation required. Send { confirm: true }' });
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
  ownerOnly,
  ownerOrCoowner,
  adminOrAbove,
  modOrAbove,
  helperOrAbove,
  auditLog,
  apiLimiter,
  sensitiveActionLimiter,
  requireConfirmation,
  getClientIP,
  ROLE_HIERARCHY,
};
