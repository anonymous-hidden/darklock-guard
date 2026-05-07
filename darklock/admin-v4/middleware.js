/**
 * Darklock Admin v4 — Middleware
 * Authentication, RBAC, CSRF, rate-limiting, audit logging.
 *
 * Re-uses the existing admin auth system (admin_token cookie + ADMIN_JWT_SECRET)
 * and layers our own role-based permission checks on top.
 */

'use strict';

const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
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
    (req.originalUrl || req.path).startsWith('/api/');
}

// ── Authentication middleware ───────────────────────────────────────────────────
// Validates admin_token JWT cookie. Sets req.admin = { id, email, role }.

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) {
      console.log(`[Admin v4] requireAuth: no token for ${req.originalUrl}`);
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Authentication required' });
      return res.redirect('/signin');
    }

    const secret = requireEnv('ADMIN_JWT_SECRET');
    const decoded = jwt.verify(token, secret);

    if (!decoded.adminId || decoded.type !== 'admin') {
      console.log(`[Admin v4] requireAuth: invalid token payload (adminId=${decoded.adminId}, type=${decoded.type})`);
      if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Invalid token' });
      return res.redirect('/signin');
    }

    // Confirm admin still exists and is active
    const admin = await db.get(`SELECT id, email, role, active FROM admins WHERE id = ?`, [decoded.adminId]);
    if (!admin || !admin.active) {
      console.log(`[Admin v4] requireAuth: admin not found or inactive (id=${decoded.adminId}, found=${!!admin})`);
      res.clearCookie('admin_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', domain: process.env.NODE_ENV === 'production' ? '.darklock.net' : undefined, path: '/' });
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
      console.log(`[Admin v4] requireAuth: token error (${err.name}) for ${req.originalUrl}`);
      res.clearCookie('admin_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', domain: process.env.NODE_ENV === 'production' ? '.darklock.net' : undefined, path: '/' });
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

    // Ensure level is resolved (may be missing if req.admin was set by legacy middleware)
    const level = req.admin.level ?? (ROLE_HIERARCHY[req.admin.role] || 0);
    const minLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] || 100));
    if (level >= minLevel) return next();

    console.warn(`[Admin v4] 403 for ${req.admin.email} (role: ${req.admin.role}, level: ${level}) on ${req.method} ${req.originalUrl} — required level: ${minLevel}`);
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
  skip: (req) => req.method === 'GET', // GETs are read-only; only rate-limit mutations
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

// ── CSRF Protection ─────────────────────────────────────────────────────────────
// Double-submit cookie pattern: a signed csrf_token cookie is set on login/GET /shell,
// and must be echoed back in the X-CSRF-Token header for all state-changing requests.

const CSRF_SECRET = process.env.ADMIN_JWT_SECRET;
if (!CSRF_SECRET) {
  throw new Error('FATAL: ADMIN_JWT_SECRET is required for CSRF protection. Set it in .env');
}

function generateCSRFToken(adminId) {
  const payload = `${adminId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function validateCSRFToken(token, adminId) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split(':');
  if (parts.length < 3) return false;

  const [tokenAdminId, timestamp, sig] = [parts[0], parts[1], parts.slice(2).join(':')];

  // Token must match the authenticated admin
  if (tokenAdminId !== String(adminId)) return false;

  // Validate timestamp is strictly numeric
  if (!/^\d+$/.test(timestamp)) return false;

  // Token must not be older than 12 hours
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age > 12 * 60 * 60 * 1000) return false;

  // Verify signature
  const expected = crypto.createHmac('sha256', CSRF_SECRET).update(`${tokenAdminId}:${timestamp}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Middleware: Set the CSRF cookie on every authenticated GET request.
 * Must run AFTER requireAuth (needs req.admin).
 */
function setCSRFCookie(req, res, next) {
  if (req.method === 'GET' && req.admin) {
    const token = generateCSRFToken(req.admin.id);
    res.cookie('csrf_token', token, {
      httpOnly: false,  // Must be readable by JS for X-CSRF-Token header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
  }
  next();
}

/**
 * Middleware: Validate CSRF token on state-changing methods (POST, PUT, PATCH, DELETE).
 */
function requireCSRF(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.admin) return next(); // Let auth middleware handle it

  const token = req.headers['x-csrf-token'] || req.body?._csrf;
  if (!validateCSRFToken(token, req.admin.id)) {
    console.warn(`[Admin v4] CSRF validation failed for ${req.admin.email} on ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ success: false, error: 'CSRF token invalid or missing. Refresh the page and try again.' });
  }
  next();
}

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
  requireCSRF,
  setCSRFCookie,
  generateCSRFToken,
  getClientIP,
  ROLE_HIERARCHY,
};
