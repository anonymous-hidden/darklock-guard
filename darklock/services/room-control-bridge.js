#!/usr/bin/env node
/**
 * DarkLock — Room Control Bridge
 * ===============================
 * Runs on the Pi5 alongside the darklock server.
 *
 * Talks to the Pico Room Control firmware (pico_room_control.py) over USB
 * serial and exposes a tiny localhost-only HTTP API protected by a shared
 * bearer token so the darklock route handlers can call it.
 *
 * Also discovers and controls Govee smart lights on the LAN.
 *
 * Endpoints (all require Authorization: Bearer <ROOM_BRIDGE_TOKEN>):
 *   POST /buzzer/active     { ms }            -> active buzzer (clamped 50..3000)
 *   POST /buzzer/active/stop                  -> stop active buzzer
 *   POST /buzzer/song       { name }          -> play named passive-buzzer song
 *   POST /buzzer/song/stop                    -> stop song
 *   POST /led               { which, on }     -> override LED
 *   GET  /songs                               -> list of song names
 *   GET  /lights                              -> discovered Govee LAN devices
 *   POST /lights/refresh                      -> rescan
 *   POST /lights/power      { device, on }    -> turn on/off (omit device = all)
 *   POST /lights/color      { device, r,g,b } -> set RGB
 *   POST /lights/brightness { device, value } -> 1..100
 *   POST /lights/scene      { device, scene } -> preset mood
 *   GET  /health                              -> status snapshot
 *
 * Env:
 *   ROOM_BRIDGE_PORT     default 3099
 *   ROOM_BRIDGE_TOKEN    required (shared with darklock server)
 *   PICO_PORT            optional explicit /dev/ttyACM0 path
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const govee = require('./govee-lan');

// --- Config -----------------------------------------------------------------
const PORT  = parseInt(process.env.ROOM_BRIDGE_PORT || '3099', 10);
const TOKEN = process.env.ROOM_BRIDGE_TOKEN || loadOrCreateToken();
const BAUD  = 115200;

const SONG_NAMES = [
    'alert', 'doorbell', 'jingle', 'rise', 'fall',
    'birthday', 'march', 'tetris', 'siren', 'shave',
];

// --- Token persistence ------------------------------------------------------
function loadOrCreateToken() {
    const tokenFile = path.join(__dirname, '..', '..', 'data', 'room-bridge-token.txt');
    try {
        if (fs.existsSync(tokenFile)) {
            return fs.readFileSync(tokenFile, 'utf8').trim();
        }
        const t = require('crypto').randomBytes(32).toString('hex');
        fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
        fs.writeFileSync(tokenFile, t, { mode: 0o600 });
        console.log('[RoomBridge] Generated new bridge token at', tokenFile);
        return t;
    } catch (e) {
        console.error('[RoomBridge] Failed to load/create token:', e);
        return require('crypto').randomBytes(32).toString('hex');
    }
}

// --- Serial -----------------------------------------------------------------
let port = null;
let parser = null;
let picoReady = false;
const pendingReplies = [];   // simple FIFO of {match, resolve}

async function findPicoPath() {
    if (process.env.PICO_PORT) return process.env.PICO_PORT;
    const ports = await SerialPort.list();
    const pico = ports.find(p =>
        /ttyACM/.test(p.path) ||
        /usbmodem/.test(p.path) ||
        (p.vendorId && p.vendorId.toLowerCase() === '2e8a')
    );
    return pico ? pico.path : null;
}

async function connectPico() {
    const picoPath = await findPicoPath();
    if (!picoPath) {
        console.warn('[RoomBridge] No Pico USB device found, retrying in 5s');
        setTimeout(connectPico, 5000);
        return;
    }
    console.log('[RoomBridge] Opening', picoPath);
    port = new SerialPort({ path: picoPath, baudRate: BAUD }, (err) => {
        if (err) {
            console.error('[RoomBridge] Open failed:', err.message);
            setTimeout(connectPico, 5000);
            return;
        }
        // After the port opens, the USB DTR toggle may have sent Ctrl+C to the
        // Pico, killing the running firmware. Send PING after 1.5s to give it
        // time to restart; the firmware responds with PONG + READY:ROOMCTRL.
        setTimeout(() => {
            if (port && port.isOpen) {
                port.write('PING\n', (e) => {
                    if (e) console.error('[RoomBridge] PING write error:', e.message);
                });
            }
        }, 1500);
    });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (line) => {
        line = String(line).trim();
        if (!line) return;
        if (line === 'READY:ROOMCTRL') {
            picoReady = true;
            console.log('[RoomBridge] Pico firmware ready');
            return;
        }
        // Resolve any pending reply waiters
        for (let i = pendingReplies.length - 1; i >= 0; i--) {
            const w = pendingReplies[i];
            if (w.match.test(line)) {
                pendingReplies.splice(i, 1);
                w.resolve(line);
            }
        }
        if (process.env.ROOM_BRIDGE_DEBUG) console.log('[Pico]', line);
    });

    port.on('close', () => {
        picoReady = false;
        console.warn('[RoomBridge] Serial closed, reconnecting in 3s');
        setTimeout(connectPico, 3000);
    });
    port.on('error', (err) => {
        console.error('[RoomBridge] Serial error:', err.message);
    });

    // Heartbeat
    setInterval(() => {
        if (port && port.isOpen) {
            try { port.write('NET:OK\n'); } catch {}
        }
    }, 5000);
}

function sendCmd(cmd, expectMatch = null, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
        if (!port || !port.isOpen) return reject(new Error('Pico not connected'));
        port.write(cmd + '\n', (err) => {
            if (err) return reject(err);
            if (!expectMatch) return resolve(null);
            const waiter = { match: expectMatch, resolve };
            pendingReplies.push(waiter);
            setTimeout(() => {
                const i = pendingReplies.indexOf(waiter);
                if (i >= 0) {
                    pendingReplies.splice(i, 1);
                    reject(new Error('Pico reply timeout: ' + cmd));
                }
            }, timeoutMs);
        });
    });
}

// --- HTTP server ------------------------------------------------------------
function readJson(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => {
            data += c;
            if (data.length > 16 * 1024) { req.destroy(); }
        });
        req.on('end', () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
        });
    });
}

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function authOk(req) {
    const h = req.headers['authorization'] || '';
    return h === 'Bearer ' + TOKEN;
}

const ROUTES = {};

ROUTES['GET /health'] = async (req, res) => {
    send(res, 200, {
        ok: true,
        pico: { connected: !!(port && port.isOpen), ready: picoReady },
        govee: govee.snapshot(),
    });
};

ROUTES['GET /songs'] = async (req, res) => {
    send(res, 200, { songs: SONG_NAMES });
};

ROUTES['POST /buzzer/active'] = async (req, res) => {
    const body = await readJson(req);
    const ms = Math.max(50, Math.min(3000, parseInt(body.ms, 10) || 500));
    try {
        await sendCmd('BEEP:' + ms, /^ACK:BEEP/);
        send(res, 200, { ok: true, ms });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

ROUTES['POST /buzzer/active/stop'] = async (req, res) => {
    try {
        await sendCmd('BEEP_STOP', /^ACK:BEEP_STOP/);
        send(res, 200, { ok: true });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

ROUTES['POST /buzzer/song'] = async (req, res) => {
    const body = await readJson(req);
    const name = String(body.name || '').toLowerCase();
    if (!SONG_NAMES.includes(name)) return send(res, 400, { ok: false, error: 'unknown_song' });
    try {
        await sendCmd('SONG:' + name, /^ACK:SONG/);
        send(res, 200, { ok: true, song: name });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

ROUTES['POST /buzzer/song/stop'] = async (req, res) => {
    try {
        await sendCmd('SONG_STOP', /^ACK:SONG_STOP/);
        send(res, 200, { ok: true });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

// Reboot the Pico into REPL mode so mpremote can access it for firmware updates.
// After calling this, stop the bridge, run mpremote commands, then restart bridge.
ROUTES['POST /repl'] = async (req, res) => {
    try {
        await sendCmd('REBOOT_TO_REPL', /^ACK:REBOOT_TO_REPL/, 3000);
        picoReady = false;
        send(res, 200, { ok: true, message: 'Pico rebooting to REPL mode. Stop the bridge, use mpremote, then restart.' });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

ROUTES['POST /led'] = async (req, res) => {
    const body = await readJson(req);
    const which = String(body.which || '').toUpperCase();
    if (!['NET', 'GREEN', 'BLUE', 'RED'].includes(which)) return send(res, 400, { ok: false, error: 'bad_led' });
    const state = body.on ? 'ON' : 'OFF';
    try {
        await sendCmd(`LED:${which}:${state}`, /^ACK:LED/);
        send(res, 200, { ok: true });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

ROUTES['GET /lights'] = async (req, res) => {
    send(res, 200, { devices: govee.list() });
};

ROUTES['POST /lights/refresh'] = async (req, res) => {
    const devs = await govee.scan();
    send(res, 200, { devices: devs });
};

ROUTES['POST /lights/power'] = async (req, res) => {
    const body = await readJson(req);
    const r = await govee.power(body.device || null, !!body.on);
    send(res, r.ok ? 200 : 400, r);
};

ROUTES['POST /lights/color'] = async (req, res) => {
    const body = await readJson(req);
    const r = await govee.color(body.device || null, +body.r, +body.g, +body.b);
    send(res, r.ok ? 200 : 400, r);
};

ROUTES['POST /lights/brightness'] = async (req, res) => {
    const body = await readJson(req);
    const r = await govee.brightness(body.device || null, parseInt(body.value, 10));
    send(res, r.ok ? 200 : 400, r);
};

ROUTES['POST /lights/scene'] = async (req, res) => {
    const body = await readJson(req);
    const r = await govee.scene(body.device || null, String(body.scene || ''));
    send(res, r.ok ? 200 : 400, r);
};

ROUTES['GET /sensor'] = async (req, res) => {
    try {
        const line = await sendCmd('READ_SENSOR', /^(SENSOR:|ERR:SENSOR)/, 3000);
        if (!line || line.startsWith('ERR:SENSOR')) {
            return send(res, 500, { ok: false, error: line || 'no_response' });
        }
        const parts = line.split(':');
        const temp = parseFloat(parts[1]);
        const humidity = parseFloat(parts[2]);
        send(res, 200, { ok: true, temp, humidity });
    } catch (e) {
        send(res, 500, { ok: false, error: e.message });
    }
};

const server = http.createServer(async (req, res) => {
    // Localhost only
    const ra = req.socket.remoteAddress;
    if (ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1') {
        return send(res, 403, { ok: false, error: 'forbidden' });
    }
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const key = req.method + ' ' + req.url.split('?')[0];
    const handler = ROUTES[key];
    if (!handler) return send(res, 404, { ok: false, error: 'not_found' });
    try {
        await handler(req, res);
    } catch (e) {
        console.error('[RoomBridge]', key, e);
        send(res, 500, { ok: false, error: 'internal_error' });
    }
});

// --- Start ------------------------------------------------------------------
server.listen(PORT, '127.0.0.1', () => {
    console.log(`[RoomBridge] Listening on 127.0.0.1:${PORT}`);
    console.log(`[RoomBridge] Token: ${TOKEN.slice(0,8)}... (${TOKEN.length} chars)`);
});

connectPico();
govee.start();

process.on('SIGINT',  () => { try { sendCmd('RESET'); } catch {}; process.exit(0); });
process.on('SIGTERM', () => { try { sendCmd('RESET'); } catch {}; process.exit(0); });
