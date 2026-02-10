/**
 * RFID Security IPC Client
 * Communicates with Pi RFID gateway over Unix socket or TCP
 */
const net = require('net');

// Use TCP if connecting from remote machine, Unix socket if local
const USE_TCP = process.env.RFID_HOST ? true : false;
const TCP_HOST = process.env.RFID_HOST || '192.168.50.2';
const TCP_PORT = process.env.RFID_PORT || 9999;
const SOCKET_PATH = '/tmp/darklock_rfid.sock';
const TIMEOUT = 20000; // 20 seconds for card scan

/**
 * Send command to RFID gateway and wait for response
 */
function sendCommand(action) {
    return new Promise((resolve, reject) => {
        const client = USE_TCP 
            ? net.createConnection(TCP_PORT, TCP_HOST)
            : net.createConnection(SOCKET_PATH);
        
        let timeout;

        timeout = setTimeout(() => {
            client.destroy();
            reject(new Error('RFID timeout - no card scanned'));
        }, TIMEOUT);

        client.on('connect', () => {
            client.write(JSON.stringify({ action }) + '\n');
        });

        client.on('data', (data) => {
            clearTimeout(timeout);
            try {
                const response = JSON.parse(data.toString());
                client.end();
                resolve(response);
            } catch (err) {
                reject(new Error('Invalid response from RFID gateway'));
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            if (err.code === 'ENOENT') {
                reject(new Error('RFID gateway offline'));
            } else {
                reject(err);
            }
        });

        client.on('timeout', () => {
            clearTimeout(timeout);
            client.destroy();
            reject(new Error('RFID connection timeout'));
        });
    });
}

/**
 * Request RFID scan for admin login
 */
async function scanAdmin() {
    try {
        const result = await sendCommand('scan_admin');
        if (result.authorized) {
            return {
                allowed: true,
                user: result.user,
                expires: result.expires,
                uid_hash: 'protected'
            };
        } else {
            return {
                allowed: false,
                reason: '❌ RFID card not recognized or timeout'
            };
        }
    } catch (error) {
        return {
            allowed: false,
            reason: `⚠️ ${error.message}`
        };
    }
}

/**
 * Request RFID scan for shutdown/restart
 */
async function scanShutdown() {
    try {
        const result = await sendCommand('scan_shutdown');
        if (result.authorized) {
            return {
                allowed: true,
                user: result.user,
                expires: result.expires,
                uid_hash: 'protected'
            };
        } else {
            return {
                allowed: false,
                reason: '❌ RFID card not recognized or timeout'
            };
        }
    } catch (error) {
        return {
            allowed: false,
            reason: `⚠️ ${error.message}`
        };
    }
}

/**
 * Get RFID gateway status (short timeout for health checks)
 */
async function getStatus() {
    return new Promise((resolve, reject) => {
        const client = USE_TCP 
            ? net.createConnection(TCP_PORT, TCP_HOST)
            : net.createConnection(SOCKET_PATH);
        
        const timeout = setTimeout(() => {
            client.destroy();
            reject(new Error('Gateway timeout'));
        }, 3000); // 3 second timeout for status checks

        client.on('connect', () => {
            client.write(JSON.stringify({ action: 'status' }) + '\n');
        });

        client.on('data', (data) => {
            clearTimeout(timeout);
            try {
                const response = JSON.parse(data.toString());
                client.end();
                resolve(response);
            } catch (err) {
                reject(new Error('Invalid response'));
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error('Gateway offline'));
        });
    });
}

module.exports = {
    scanAdmin,
    scanShutdown,
    getStatus
};
