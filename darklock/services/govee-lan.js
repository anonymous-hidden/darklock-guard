/**
 * Govee LAN API client
 * ====================
 * Implements the documented Govee LAN UDP protocol:
 *   - Multicast scan request:   239.255.255.250:4001  (we receive on 4002)
 *   - Per-device control:       <device-ip>:4003
 *   - Per-device status query:  <device-ip>:4003 (response on 4002)
 *
 * Reference: https://app-h5.govee.com/user-manual/wlan-guide
 *
 * Each device must have "LAN Control" enabled in the Govee Home app.
 */

'use strict';

const dgram = require('dgram');

const SCAN_ADDR    = '239.255.255.250';
const SCAN_PORT    = 4001;
const CTRL_PORT    = 4003;
const RECV_PORT    = 4002;
const SCAN_PAYLOAD = JSON.stringify({
    msg: { cmd: 'scan', data: { account_topic: 'reserve' } },
});

// ---- Scenes (RGB presets) --------------------------------------------------
const SCENES = {
    chill:    { r: 80,  g: 0,   b: 200, brightness: 60 },
    focus:    { r: 255, g: 255, b: 255, brightness: 100 },
    movie:    { r: 30,  g: 0,   b: 60,  brightness: 25 },
    sunset:   { r: 255, g: 90,  b: 30,  brightness: 80 },
    forest:   { r: 0,   g: 200, b: 80,  brightness: 60 },
    party:    { r: 255, g: 0,   b: 180, brightness: 100 },
    sleep:    { r: 200, g: 30,  b: 0,   brightness: 10 },
    cyber:    { r: 0,   g: 220, b: 255, brightness: 90 },
    blood:    { r: 255, g: 0,   b: 0,   brightness: 100 },
    ocean:    { r: 0,   g: 80,  b: 255, brightness: 75 },
};

// ---- State -----------------------------------------------------------------
let recvSock = null;
let scanSock = null;

/** map: device id -> { id, ip, model, sku, lastSeen, status } */
const devices = new Map();

// ---- Helpers ---------------------------------------------------------------
function safeJson(buf) {
    try { return JSON.parse(buf.toString()); } catch { return null; }
}

function sendTo(ip, payload) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket('udp4');
        const buf = Buffer.from(JSON.stringify(payload));
        sock.send(buf, 0, buf.length, CTRL_PORT, ip, (err) => {
            sock.close();
            resolve(!err);
        });
    });
}

function targets(deviceId) {
    if (!deviceId) return Array.from(devices.values());
    const d = devices.get(deviceId);
    return d ? [d] : [];
}

// ---- Public API ------------------------------------------------------------
function start() {
    // Listener (devices respond to multicast scan & status on RECV_PORT)
    recvSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    recvSock.on('error', (err) => console.warn('[Govee] recv error:', err.message));
    recvSock.on('message', (buf, rinfo) => {
        const obj = safeJson(buf);
        if (!obj || !obj.msg) return;
        const { cmd, data } = obj.msg;
        if ((cmd === 'scan' || cmd === 'devStatus') && data && data.device) {
            const id = data.device;
            const prev = devices.get(id) || {};
            devices.set(id, {
                id,
                ip: data.ip || rinfo.address,
                model: data.sku || data.model || prev.model || 'unknown',
                bleName: data.bleVersionHard || prev.bleName,
                lastSeen: Date.now(),
                status: cmd === 'devStatus' ? data : prev.status || null,
            });
        }
    });
    recvSock.bind(RECV_PORT, () => {
        try { recvSock.addMembership(SCAN_ADDR); } catch (e) {
            console.warn('[Govee] addMembership failed:', e.message);
        }
        scan();
    });

    // Multicast sender
    scanSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    scanSock.bind(0, () => {
        try { scanSock.setBroadcast(true); scanSock.setMulticastTTL(2); } catch {}
    });

    // Periodic re-scan + status pull
    setInterval(scan, 60_000);
    setInterval(pollStatus, 30_000);
}

async function scan() {
    return new Promise((resolve) => {
        if (!scanSock) return resolve([]);
        const buf = Buffer.from(SCAN_PAYLOAD);
        scanSock.send(buf, 0, buf.length, SCAN_PORT, SCAN_ADDR, () => {
            // Give devices a moment to respond
            setTimeout(() => resolve(list()), 1500);
        });
    });
}

function pollStatus() {
    for (const d of devices.values()) {
        sendTo(d.ip, { msg: { cmd: 'devStatus', data: {} } });
    }
}

function list() {
    return Array.from(devices.values()).map((d) => ({
        id: d.id,
        ip: d.ip,
        model: d.model,
        lastSeen: d.lastSeen,
        on: d.status?.onOff === 1,
        brightness: d.status?.brightness ?? null,
        color: d.status?.color || null,
    }));
}

function snapshot() {
    return { count: devices.size, devices: list() };
}

async function power(deviceId, on) {
    const ts = targets(deviceId);
    if (!ts.length) return { ok: false, error: 'no_devices' };
    const payload = { msg: { cmd: 'turn', data: { value: on ? 1 : 0 } } };
    const results = await Promise.all(ts.map((d) => sendTo(d.ip, payload)));
    return { ok: results.every(Boolean), affected: ts.length };
}

function clamp(v, lo, hi) { v = Number(v); if (!Number.isFinite(v)) return lo; return Math.max(lo, Math.min(hi, v)); }

async function color(deviceId, r, g, b) {
    const ts = targets(deviceId);
    if (!ts.length) return { ok: false, error: 'no_devices' };
    r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    const payload = {
        msg: { cmd: 'colorwc', data: { color: { r, g, b }, colorTemInKelvin: 0 } },
    };
    const results = await Promise.all(ts.map((d) => sendTo(d.ip, payload)));
    return { ok: results.every(Boolean), affected: ts.length, color: { r, g, b } };
}

async function brightness(deviceId, value) {
    const ts = targets(deviceId);
    if (!ts.length) return { ok: false, error: 'no_devices' };
    value = clamp(value, 1, 100);
    const payload = { msg: { cmd: 'brightness', data: { value } } };
    const results = await Promise.all(ts.map((d) => sendTo(d.ip, payload)));
    return { ok: results.every(Boolean), affected: ts.length, brightness: value };
}

async function scene(deviceId, name) {
    const s = SCENES[name];
    if (!s) return { ok: false, error: 'unknown_scene', available: Object.keys(SCENES) };
    // Govee LAN doesn't support named scenes — emulate by turning on, brightness, then color
    await power(deviceId, true);
    await brightness(deviceId, s.brightness);
    const r = await color(deviceId, s.r, s.g, s.b);
    return { ok: r.ok, scene: name };
}

module.exports = {
    start,
    scan,
    list,
    snapshot,
    power,
    color,
    brightness,
    scene,
    SCENES,
};
