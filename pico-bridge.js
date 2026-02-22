#!/usr/bin/env node
/**
 * DarkLock Portable — Pico LED Bridge
 * ====================================
 * Host-side companion for pico_portable_status.py (MicroPython firmware).
 *
 * Reads bot status from data/bot_status.json (written by the main bot)
 * and sends simple serial commands to the Pico over USB so it can drive
 * the 4 LEDs without needing its own Wi-Fi stack.
 *
 * Serial commands sent to Pico:
 *   OK        → green solid
 *   DEGRADED  → yellow blink
 *   FAIL      → red fast blink
 *   CHECKING  → blue pulse
 *   SHUTDOWN  → all LEDs off
 *
 * Usage:
 *   node pico-bridge.js                  # auto-detect Pico port
 *   PICO_PORT=/dev/ttyACM1 node pico-bridge.js
 *
 * Part of: npm run start:portable
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { SerialPort } = require('serialport');

// ─── Config ───────────────────────────────────────────────────────────────────

const PICO_PORT       = process.env.PICO_PORT || null;   // null = auto-detect
const BAUD_RATE       = 115200;
const CHECK_INTERVAL  = 3000;   // ms between status reads
const STATUS_FILE     = path.join(__dirname, 'data', 'bot_status.json');
const FAIL_THRESHOLD  = 3;
const RECOVER_THRESHOLD = 2;

// ─── State ────────────────────────────────────────────────────────────────────

let   port          = null;
let   lastState     = null;
let   failStreak    = 0;
let   okStreak      = 0;
let   connected     = false;

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[Pico Bridge] ${msg}`);
}

// ─── Auto-detect Pico USB port ────────────────────────────────────────────────

async function findPicoPort() {
  const ports = await SerialPort.list();
  // Pico W shows up as ACM or as manufacturer "Raspberry Pi"
  const pico = ports.find(p =>
    /ttyACM/.test(p.path) ||
    /usbmodem/.test(p.path) ||
    (p.manufacturer && /raspberry/i.test(p.manufacturer)) ||
    (p.vendorId === '2e8a')   // Raspberry Pi vendor ID
  );
  return pico ? pico.path : null;
}

// ─── Serial send helper ───────────────────────────────────────────────────────

function send(cmd) {
  if (!port || !port.isOpen) return;
  port.write(cmd + '\n', err => {
    if (err) log(`Send error: ${err.message}`);
    else log(`→ ${cmd}`);
  });
}

// ─── Read bot_status.json ─────────────────────────────────────────────────────

function readBotStatus() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    const raw = fs.readFileSync(STATUS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Determine LED state from status ─────────────────────────────────────────

function resolveState(status) {
  if (!status) return 'FAIL';

  const online   = status.online  === true || status.status === 'online';
  const starting = status.status  === 'starting' || status.status === 'restarting';

  if (starting) return 'CHECKING';
  if (online)   return 'OK';
  return 'FAIL';
}

// ─── Watchdog — mirrors state.py logic ───────────────────────────────────────

function updateWatchdog(healthy) {
  let state;
  if (healthy) {
    failStreak = 0;
    okStreak++;
    if (okStreak >= RECOVER_THRESHOLD) {
      state    = 'OK';
      okStreak = 0;
    } else {
      state = lastState || 'CHECKING';
    }
  } else {
    okStreak = 0;
    failStreak++;
    state = failStreak >= FAIL_THRESHOLD ? 'FAIL' : 'DEGRADED';
  }
  const changed = state !== lastState;
  lastState = state;
  return { state, changed };
}

// ─── Main check loop ──────────────────────────────────────────────────────────

function runCheck() {
  const status  = readBotStatus();
  const raw     = resolveState(status);
  const healthy = raw === 'OK' || raw === 'CHECKING';
  const { state, changed } = updateWatchdog(healthy);

  // Always send if just connected, otherwise only on change
  if (changed || !connected) {
    connected = true;
    log(`State: ${state}`);
    send(state);
  }
}

// ─── Try to open one specific port, returns true on success ──────────────────

let checkInterval = null;

function tryOpenPort(portPath) {
  // Destroy any existing port instance
  if (port) {
    try { port.destroy(); } catch {}
    port = null;
  }

  log(`Trying serial port: ${portPath} @ ${BAUD_RATE}`);

  const p = new SerialPort({ path: portPath, baudRate: BAUD_RATE, autoOpen: false });

  p.open(err => {
    if (err) {
      // EAGAIN / lock error — another process (7seg, etc.) has the port.
      // Retry after a delay without exiting.
      const isLock = err.message && (
        err.message.includes('Cannot lock port') ||
        err.message.includes('Resource temporarily unavailable') ||
        err.message.includes('EACCES') ||
        err.message.includes('EBUSY')
      );
      if (isLock) {
        log(`Port locked (in use by another module) — retrying in 8s...`);
      } else {
        log(`Port open error: ${err.message} — retrying in 8s...`);
      }
      setTimeout(() => start(), 8000);
      return;
    }

    port = p;

    port.on('data', data => {
      const line = data.toString().trim();
      if (line) log(`← Pico: ${line}`);
    });

    port.on('error', err2 => {
      log(`Serial error: ${err2.message} — reconnecting in 8s...`);
      connected = false;
      setTimeout(() => start(), 8000);
    });

    port.on('close', () => {
      log('Port closed — reconnecting in 8s...');
      connected = false;
      setTimeout(() => start(), 8000);
    });

    log(`Pico connected on ${portPath}`);

    // Start check loop once (guard against multiple intervals)
    if (!checkInterval) {
      setTimeout(() => {
        send('CHECKING');
        checkInterval = setInterval(runCheck, CHECK_INTERVAL);
      }, 2000);
    } else {
      send('CHECKING');
    }
  });
}

// ─── Open serial port & start ─────────────────────────────────────────────────

async function start() {
  if (!port) log('DarkLock Portable LED Bridge starting...');

  const portPath = PICO_PORT || await findPicoPort();

  if (!portPath) {
    log('No Pico detected — running in status-log-only mode.');
    log('Plug in your Pico W over USB and restart, or set PICO_PORT env var.');
    if (!checkInterval) {
      checkInterval = setInterval(runCheck, CHECK_INTERVAL);
    }
    // Keep scanning for the Pico every 10s
    setTimeout(() => start(), 10000);
    return;
  }

  tryOpenPort(portPath);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  log('Shutting down...');
  if (checkInterval) clearInterval(checkInterval);
  if (port && port.isOpen) {
    port.write('SHUTDOWN\n', () => port.close());
  }
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

start().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
