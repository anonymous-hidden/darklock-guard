#!/usr/bin/env node
/**
 * DarkLock Portable Launcher
 * Starts the Discord bot AND the Pico LED bridge together.
 * Run with: npm start   (or: node start-portable.js)
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');

const ROOT = __dirname;

function launch(label, cmd, args) {
  const proc = spawn(cmd, args, {
    cwd:   ROOT,
    stdio: 'inherit',
    env:   process.env,
  });

  proc.on('error', err => {
    console.error(`[${label}] Failed to start: ${err.message}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[${label}] exited (code=${code} signal=${signal})`);
    // Don't let the bridge crashing kill the whole process —
    // it has its own internal retry loop and should not reach here,
    // but if it does, just restart it.
    if (label === 'Bridge') {
      console.log('[Portable] Bridge stopped unexpectedly — restarting in 5s...');
      setTimeout(() => {
        const next = launch(label, cmd, args);
        // keep reference in outer scope (best-effort, process is still alive)
      }, 5000);
    }
  });

  return proc;
}

console.log('[Portable] Starting DarkLock bot + Pico bridge...');

const bot    = launch('Bot',    'node', ['src/bot.js']);
const bridge = launch('Bridge', 'node', ['pico-bridge.js']);

function shutdown() {
  console.log('\n[Portable] Shutting down...');
  bot.kill('SIGTERM');
  bridge.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
