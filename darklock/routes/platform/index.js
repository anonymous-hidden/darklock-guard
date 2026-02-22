const express = require('express');
const router = express.Router();
const { requireAuth } = require('../dashboard');

const os = require('os');
const apiClient = require('./lib/apiClient');
const db = require('../../utils/database');
let discordBot = null;

// Allow main server to inject bot reference if needed
function setDiscordBot(bot) {
    discordBot = bot;
}
// GET /platform/api/metrics — SECURITY: require admin auth
router.get('/api/metrics', requireAuth, async (req, res) => {
    try {
        // System metrics
        const memUsage = process.memoryUsage();
        const cpuLoad = os.loadavg();
        let dbLatency = 0;
        try {
            const start = Date.now();
            await db.get(`SELECT 1`);
            dbLatency = Date.now() - start;
        } catch {}

        // Bot metrics
        const botMetrics = discordBot ? {
            status: discordBot.ws?.status === 0 ? 'online' : 'degraded',
            ping: discordBot.ws?.ping || 0,
            guilds: discordBot.guilds?.cache?.size || 0,
            users: discordBot.users?.cache?.size || 0
        } : { status: 'offline', ping: 0, guilds: 0, users: 0 };

        res.json({
            success: true,
            system: {
                memory: {
                    rss: memUsage.rss,
                    heapTotal: memUsage.heapTotal,
                    heapUsed: memUsage.heapUsed,
                    external: memUsage.external
                },
                cpu: cpuLoad,
                dbLatency
            },
            bot: botMetrics,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to load metrics' });
    }
});

function parseReleaseNotes(notes) {
    if (!notes) return [];
    if (Array.isArray(notes)) return notes;
    return String(notes)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(text => ({ type: 'note', text }));
}

function mapRelease(apiRelease) {
    if (!apiRelease) return null;
    return {
        id: apiRelease.id,
        product: apiRelease.product || 'Guard',
        version: apiRelease.version,
        os: apiRelease.os,
        channel: (apiRelease.channel || '').toLowerCase(),
        releaseDate: apiRelease.created_at,
        fileSize: apiRelease.file_size || 'Unknown size',
        signatureValid: Boolean(apiRelease.signature),
        sha256: apiRelease.checksum || 'N/A',
        changelog: parseReleaseNotes(apiRelease.release_notes || apiRelease.changelog),
        downloadUrl: apiRelease.url,
        signatureUrl: apiRelease.signature || null
    };
}

function deriveStatus(lastSeenIso) {
    if (!lastSeenIso) return 'offline';
    const ts = new Date(lastSeenIso);
    if (Number.isNaN(ts.getTime())) return 'offline';
    return (Date.now() - ts.getTime()) < 5 * 60 * 1000 ? 'online' : 'offline';
}

function mapDevice(apiDevice) {
    if (!apiDevice) return null;
    const lastSeen = apiDevice.last_seen_at || apiDevice.lastSeen;
    const linkedAt = apiDevice.linked_at || apiDevice.linkedAt;
    const securityProfile = (apiDevice.security_profile || apiDevice.securityProfile || 'NORMAL').toUpperCase();
    return {
        id: apiDevice.id,
        name: apiDevice.name || apiDevice.device_name || apiDevice.id,
        status: deriveStatus(lastSeen),
        securityProfile,
        lastSeen: lastSeen || null,
        linkedAt: linkedAt || null,
        mode: apiDevice.mode || 'CONNECTED',
        publicKey: apiDevice.public_key || apiDevice.publicKey || null,
        viewOnly: Boolean(apiDevice.view_only || apiDevice.viewOnly)
    };
}

async function fetchLatestLogsCommand(req, deviceId) {
    try {
        const data = await apiClient.get(`/api/devices/${deviceId}/commands?command=REQUEST_LOGS&limit=1`, req);
        if (Array.isArray(data?.commands) && data.commands.length) {
            return data.commands[0];
        }
        return null;
    } catch (err) {
        console.warn('[Platform] Failed to load logs command state', err?.message || err);
        return null;
    }
}

async function fetchLatestSafeModeCommand(req, deviceId) {
    try {
        const data = await apiClient.get(`/api/devices/${deviceId}/commands?command=ENTER_SAFE_MODE&limit=1`, req);
        if (Array.isArray(data?.commands) && data.commands.length) {
            return data.commands[0];
        }
        return null;
    } catch (err) {
        console.warn('[Platform] Failed to load safe mode command state', err?.message || err);
        return null;
    }
}

// GET /platform/updates
router.get('/updates', requireAuth, async (req, res) => {
    const { product, os, channel, search } = req.query;
    const filters = { product, os, channel, search };

    try {
        const params = new URLSearchParams();
        if (os && os !== 'all') params.set('os', os);
        if (channel && channel !== 'all') params.set('channel', channel);
        if (search) params.set('version', search);

        const query = params.toString();
        const data = await apiClient.get(`/api/releases${query ? `?${query}` : ''}`, req);
        const releases = Array.isArray(data?.releases)
            ? data.releases.map(mapRelease).filter(Boolean)
            : [];

        let filteredReleases = [...releases];
        if (product && product !== 'all') {
            filteredReleases = filteredReleases.filter(r => (r.product || '').toLowerCase() === product.toLowerCase());
        }
        if (search) {
            filteredReleases = filteredReleases.filter(r => (r.version || '').toLowerCase().includes(search.toLowerCase()));
        }

        return res.render('platform/updates', {
            title: 'Updates - Darklock Platform',
            releases: filteredReleases,
            filters,
            user: req.user,
            error: null,
            retryPath: '/platform/updates'
        });
    } catch (err) {
        console.error('[Platform] Failed to load releases', err);
        const message = err?.body?.error || err?.message || 'Failed to load releases';
        return res.status(err?.status === 404 ? 404 : 503).render('platform/updates', {
            title: 'Updates - Darklock Platform',
            releases: [],
            filters,
            user: req.user,
            error: message,
            retryPath: '/platform/updates'
        });
    }
});

// GET /platform/devices
router.get('/devices', requireAuth, async (req, res) => {
    const { status, profile, search } = req.query;
    const filters = { status, profile, search };

    try {
        const data = await apiClient.get('/api/devices', req);
        const devices = Array.isArray(data?.devices)
            ? data.devices.map(mapDevice).filter(Boolean)
            : [];

        let filteredDevices = [...devices];
        if (status && status !== 'all') {
            filteredDevices = filteredDevices.filter(d => d.status === status);
        }
        if (profile && profile !== 'all') {
            filteredDevices = filteredDevices.filter(d => d.securityProfile === profile.toUpperCase());
        }
        if (search) {
            filteredDevices = filteredDevices.filter(d =>
                (d.id || '').toLowerCase().includes(search.toLowerCase()) ||
                (d.name || '').toLowerCase().includes(search.toLowerCase())
            );
        }

        return res.render('platform/devices', {
            title: 'Devices - Darklock Platform',
            devices: filteredDevices,
            filters,
            user: req.user,
            error: null,
            retryPath: '/platform/devices'
        });
    } catch (err) {
        console.error('[Platform] Failed to load devices', err);
        const message = err?.body?.error || err?.message || 'Failed to load devices';
        return res.status(err?.status === 404 ? 404 : 503).render('platform/devices', {
            title: 'Devices - Darklock Platform',
            devices: [],
            filters,
            user: req.user,
            error: message,
            retryPath: '/platform/devices'
        });
    }
});

// GET /platform/devices/:id
router.get('/devices/:id', requireAuth, async (req, res) => {
    try {
        const data = await apiClient.get(`/api/devices/${req.params.id}`, req);
        const device = mapDevice(data?.device || data);

        if (!device) {
            return res.status(404).render('platform/device-not-found', {
                title: 'Device Not Found',
                user: req.user,
                retryPath: '/platform/devices'
            });
        }

        const events = Array.isArray(data?.events) ? data.events : [];
        const logsCommand = await fetchLatestLogsCommand(req, req.params.id);
        const safeModeCommand = await fetchLatestSafeModeCommand(req, req.params.id);

        return res.render('platform/device-detail', {
            title: `${device.name} - Darklock Platform`,
            device,
            events,
            logsCommand,
            safeModeCommand,
            user: req.user,
            error: null,
            retryPath: `/platform/devices/${req.params.id}`
        });
    } catch (err) {
        console.error('[Platform] Failed to load device', err);
        const status = err?.status === 404 ? 404 : 503;
        if (status === 404) {
            return res.status(404).render('platform/device-not-found', {
                title: 'Device Not Found',
                user: req.user,
                retryPath: '/platform/devices'
            });
        }
        return res.status(status).render('platform/device-detail', {
            title: 'Device Unavailable',
            device: null,
            events: [],
            logsCommand: null,
            safeModeCommand: null,
            user: req.user,
            error: err?.message || 'Failed to load device',
            retryPath: `/platform/devices/${req.params.id}`
        });
    }
});

// POST /platform/devices/:id/request-logs
router.post('/devices/:id/request-logs', requireAuth, async (req, res) => {
    try {
        const response = await apiClient.post(`/api/devices/${req.params.id}/commands`, req, {
            command_type: 'REQUEST_LOGS'
        });
        return res.json({ success: true, commandId: response.commandId });
    } catch (err) {
        const status = err?.status || 500;
        return res.status(status).json({ success: false, error: err?.body?.error || err?.message || 'request_failed' });
    }
});

// POST /platform/devices/:id/enter-safe-mode
router.post('/devices/:id/enter-safe-mode', requireAuth, async (req, res) => {
    try {
        const response = await apiClient.post(`/api/devices/${req.params.id}/commands`, req, {
            command_type: 'ENTER_SAFE_MODE'
        });
        return res.json({ success: true, commandId: response.commandId });
    } catch (err) {
        const status = err?.status || 500;
        return res.status(status).json({ success: false, error: err?.body?.error || err?.message || 'request_failed' });
    }
});

module.exports = { router, setDiscordBot };
