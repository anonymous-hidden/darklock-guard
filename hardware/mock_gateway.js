#!/usr/bin/env node
const net = require('net');
const fs = require('fs');
const path = require('path');

const SOCKET_PATH = '/tmp/darklock_rfid.sock';
const TCP_PORT = 9999;
const TCP_HOST = '0.0.0.0';

function makeResponse(action) {
    const now = Math.floor(Date.now() / 1000);
    switch (action) {
        case 'status':
            return {
                online: true,
                cards: 1,
                stats: {
                    scans_total: 42,
                    valid_reads: 10,
                    denied_reads: 2,
                    auth_checks: 5,
                    shutdown_checks: 1
                },
                active_sessions: {
                    admin: { user: 'owner-main', remaining: 60 }
                }
            };
        case 'scan_admin':
            return { authorized: true, user: 'owner-main', expires: now + 60 };
        case 'scan_shutdown':
            return { authorized: true, user: 'owner-main', expires: now + 60 };
        default:
            return { error: 'unknown action' };
    }
}

function handleSocket(conn) {
    let buffer = '';
    conn.on('data', chunk => {
        buffer += chunk.toString();
        // Process each newline-terminated message
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
                const cmd = JSON.parse(line);
                const action = cmd.action;
                if (action === 'scan_admin' || action === 'scan_shutdown') {
                    setTimeout(() => {
                        conn.write(JSON.stringify(makeResponse(action)) + '\n');
                        // do not force-close; allow client to manage socket
                    }, 500);
                } else {
                    conn.write(JSON.stringify(makeResponse(action)) + '\n');
                }
            } catch (err) {
                conn.write(JSON.stringify({ error: 'invalid json' }) + '\n');
            }
        }
    });
    conn.on('error', () => {});
}

// Remove stale socket
try {
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
} catch (e) {}

// Unix socket server
const unixServer = net.createServer(handleSocket);
unixServer.listen(SOCKET_PATH, () => {
    try { fs.chmodSync(SOCKET_PATH, 0o666); } catch (e) {}
    console.log('[mock_gateway] Unix socket listening at', SOCKET_PATH);
});

// TCP server (optional)
const tcpServer = net.createServer(handleSocket);
tcpServer.listen(TCP_PORT, TCP_HOST, () => {
    console.log('[mock_gateway] TCP server listening on', TCP_HOST + ':' + TCP_PORT);
});

process.on('SIGINT', () => {
    try { unixServer.close(); } catch (e) {}
    try { tcpServer.close(); } catch (e) {}
    try { if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH); } catch (e) {}
    console.log('\n[mock_gateway] shutting down');
    process.exit(0);
});
