#!/usr/bin/env node

// Render entrypoint: starts the web platform (Express) and the Discord bot.
// Ensures the platform binds to Render's provided PORT and stays alive until either child exits.

const { spawn } = require('child_process');
const path = require('path');

const env = {
  ...process.env,
  DARKLOCK_PORT: process.env.PORT || process.env.DARKLOCK_PORT || 3000,
  ENABLE_WEB_DASHBOARD: process.env.ENABLE_WEB_DASHBOARD || 'true',
};

const children = [];

function start(name, args) {
  const child = spawn('node', args, { env, stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code, signal) => {
    console.error(`[render-start] ${name} exited with code ${code} signal ${signal}`);
    // If either child dies, terminate the container to let Render restart.
    shutdown(code || 1);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('platform', [path.join(__dirname, '..', 'darklock', 'start.js')]);
start('bot', [path.join(__dirname, '..', 'start-bot.js')]);
