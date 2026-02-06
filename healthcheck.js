#!/usr/bin/env node
/**
 * Docker health check for DarkLock
 * Tests if the application is responsive
 */

const http = require('http');

const options = {
    host: 'localhost',
    port: process.env.WEB_PORT || 3001,
    path: '/',
    timeout: 5000,
    method: 'GET'
};

const req = http.request(options, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 500) {
        // Any non-5xx response means the app is alive
        process.exit(0);
    } else {
        console.error(`Health check failed: HTTP ${res.statusCode}`);
        process.exit(1);
    }
});

req.on('error', (err) => {
    console.error('Health check failed:', err.message);
    process.exit(1);
});

req.on('timeout', () => {
    console.error('Health check timeout');
    req.destroy();
    process.exit(1);
});

req.end();
