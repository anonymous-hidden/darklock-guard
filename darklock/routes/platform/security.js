/**
 * Darklock Platform - Security / Portal Routes
 *
 * Handles:
 *   GET  /platform/devices          – devices list (EJS)
 *   GET  /platform/devices/:id      – device detail (EJS)
 *   GET  /platform/api/devices      – device JSON API
 *   GET  /platform/api/devices/:id  – single device JSON API
 */

'use strict';

const path    = require('path');
const express = require('express');
const ejs     = require('ejs');

const { requireAuth } = require('../dashboard');
const api             = require('./lib/apiClient');

const router = express.Router();

// Discord bot reference (injected by server.js at startup)
let _discordBot = null;
function setDiscordBot(bot) { _discordBot = bot; }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = path.join(__dirname, '../../views/platform');

/**
 * Render an EJS template from views/platform/
 */
async function render(res, template, locals = {}) {
    try {
        const file = path.join(VIEWS, `${template}.ejs`);
        const html = await ejs.renderFile(file, locals, { async: true });
        res.send(html);
    } catch (err) {
        console.error(`[Platform] EJS render error (${template}):`, err.message);
        res.status(500).send('<h1>Render Error</h1><pre>' + err.message + '</pre>');
    }
}

/**
 * Fetch devices list from the dashboard API.
 * Returns { devices, error } — never throws.
 */
async function fetchDevices(req, filters = {}) {
    try {
        const qs = new URLSearchParams();
        if (filters.status  && filters.status  !== 'all') qs.set('status',  filters.status);
        if (filters.profile && filters.profile !== 'all') qs.set('profile', filters.profile);
        if (filters.search)                                qs.set('search',  filters.search);

        const qstr = qs.toString();
        const data = await api.get(
            `/platform/dashboard/api/devices/status${qstr ? '?' + qstr : ''}`,
            req
        );

        // Normalise: API may return { devices: [...] } or just an array
        const devices = Array.isArray(data) ? data
            : Array.isArray(data?.devices)  ? data.devices
            : [];

        return { devices, error: null };
    } catch (err) {
        console.error('[Platform] fetchDevices error:', err.message);
        return { devices: [], error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /platform/devices
 */
router.get('/devices', requireAuth, async (req, res) => {
    const filters = {
        status:  req.query.status  || 'all',
        profile: req.query.profile || 'all',
        search:  req.query.search  || '',
    };

    const { devices, error } = await fetchDevices(req, filters);

    return render(res, 'devices', {
        title: 'Devices — DarkLock Platform',
        devices,
        filters,
        error,
        retryPath: '/platform/devices',
        user: req.user || null,
    });
});

/**
 * GET /platform/devices/:id
 */
router.get('/devices/:id', requireAuth, async (req, res) => {
    const deviceId = req.params.id;

    try {
        const data = await api.get(
            `/platform/dashboard/api/devices/status?id=${encodeURIComponent(deviceId)}`,
            req
        );

        const devices = Array.isArray(data) ? data
            : Array.isArray(data?.devices)  ? data.devices
            : [];

        const device = devices.find(d => d.id === deviceId || d.deviceId === deviceId) || null;

        if (!device) {
            return render(res, 'device-not-found', {
                title: 'Device Not Found — DarkLock Platform',
                deviceId,
                user: req.user || null,
            });
        }

        return render(res, 'device-detail', {
            title: `${device.name || deviceId} — DarkLock Platform`,
            device,
            error: null,
            retryPath: `/platform/devices/${encodeURIComponent(deviceId)}`,
            user: req.user || null,
        });
    } catch (err) {
        console.error('[Platform] device detail error:', err.message);
        return render(res, 'device-detail', {
            title: 'Device — DarkLock Platform',
            device: null,
            error: err.message,
            retryPath: `/platform/devices/${encodeURIComponent(deviceId)}`,
            user: req.user || null,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON APIs (for client-side fetches)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /platform/api/devices
 */
router.get('/api/devices', requireAuth, async (req, res) => {
    const { devices, error } = await fetchDevices(req, req.query);
    if (error) {
        return res.status(502).json({ success: false, error });
    }
    res.json({ success: true, devices });
});

/**
 * GET /platform/api/devices/:id
 */
router.get('/api/devices/:id', requireAuth, async (req, res) => {
    const deviceId = req.params.id;
    const { devices, error } = await fetchDevices(req);
    if (error) {
        return res.status(502).json({ success: false, error });
    }
    const device = devices.find(d => d.id === deviceId || d.deviceId === deviceId);
    if (!device) {
        return res.status(404).json({ success: false, error: 'Device not found' });
    }
    res.json({ success: true, device });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { router, setDiscordBot };
