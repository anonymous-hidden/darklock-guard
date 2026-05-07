#!/usr/bin/env node

// === ANTI-TAMPER PRE-FLIGHT (auto-generated, do not edit by hand) ===
// Regenerate via: node scripts/update-antitamper-manifest.js
(function antiTamperPreflight() {
    const _fs = require('fs');
    const _path = require('path');
    const _crypto = require('crypto');
    const REQUIRED = {
        "file-protection/index.js": "48eab394765491a34ef7c8d8de4504c7b887f1aedf0c36f0203e247cb880eab6",
        "file-protection/agent/watcher.js": "a468e4d3d470ff5dda094bbe83b251b811c07f6f01048961bf4f3078c2badeee",
        "file-protection/agent/validator.js": "df803b1329264fb28b26f1772392a98aa25ff6dd0a62329fdf96ce6769124ec6",
        "file-protection/agent/baseline-manager.js": "7a1d2ef23cab7de954279f2cd3a7045a0e6ebcba260fe60e8587b43173ac68be",
        "file-protection/agent/protector.js": "baec13203d3efbf16d8a80cfdcf3edd60f54c27f6dbb72510e09d37667ff80f7",
        "file-protection/agent/response-handler.js": "39473a827e2982901b725abd42698002292ad5b2f74cad10799196d41a310e17",
        "file-protection/agent/file-enumerator.js": "ec90cb0812b7a1fba628e03ebf3faa57c66db18f0e6268f10f386dab54ec2752",
        "file-protection/agent/environment-guard.js": "80779afb4f2173fb95e13ec6f3d074f3adcb5ca4a1868cd0832a33373ae6d6f1",
        "file-protection/agent/hasher.js": "34ad46b31b89b845f300c7548b8d1da161df0aa78b65c919536bc058c55145ca",
        "file-protection/agent/constants.js": "ec37c4e3e5c2801e4f0d01167d7617874df0cc2ba31e06aa2a95dbee73ec54d4",
        "src/utils/antiTamperGuard.js": "57afe060518fcaa913688e5b4cd8c0a03791faab4df3da0f3fa6b89bbf226054"
    };
    const failures = [];
    for (const rel of Object.keys(REQUIRED)) {
        const abs = _path.join(__dirname, rel);
        if (!_fs.existsSync(abs)) { failures.push(`MISSING: ${rel}`); continue; }
        try {
            const h = _crypto.createHash('sha256').update(_fs.readFileSync(abs)).digest('hex');
            if (h !== REQUIRED[rel]) failures.push(`MODIFIED: ${rel} (expected ${REQUIRED[rel].slice(0,12)}.., got ${h.slice(0,12)}..)`);
        } catch (e) { failures.push(`UNREADABLE: ${rel} - ${e.message}`); }
    }
    if (failures.length) {
        process.stderr.write('\n\x1b[1;31m╔══════════════════════════════════════════════════════════════╗\n');
        process.stderr.write('║   ANTI-TAMPER PRE-FLIGHT FAILED — REFUSING TO START BOT      ║\n');
        process.stderr.write('╚══════════════════════════════════════════════════════════════╝\x1b[0m\n');
        for (const f of failures) process.stderr.write(`  • ${f}\n`);
        process.stderr.write('\nThe file-integrity protection system has been tampered with or removed.\n');
        process.stderr.write('If this change was intentional, run:\n');
        process.stderr.write('   node scripts/update-antitamper-manifest.js\n');
        process.stderr.write('and restart.\n\n');
        process.exit(7);
    }
})();
// === END ANTI-TAMPER PRE-FLIGHT ===


const { spawn } = require('child_process');
const path = require('path');

/**
 * Smart Bot Launcher
 * Tries to start with hardware watchdog, falls back to normal mode if unavailable
 */

const logger = {
    info: (...args) => console.log(`[${new Date().toISOString()}]`, ...args),
    warn: (...args) => console.warn(`[${new Date().toISOString()}]`, ...args),
    error: (...args) => console.error(`[${new Date().toISOString()}]`, ...args)
};

async function checkWatchdogAvailable() {
    try {
        const { SerialPort } = require('serialport');
        const ports = await SerialPort.list();
        
        // Check for Raspberry Pi Pico
        const pico = ports.find(p => 
            p.vendorId?.toLowerCase() === '2e8a' &&
            p.productId?.toLowerCase() === '0005'
        );
        
        return !!pico;
    } catch (error) {
        // serialport module not installed or error checking
        return false;
    }
}

async function startWithWatchdog() {
    logger.info('🔒 Starting with Hardware Watchdog protection...');
    
    // Use advanced watchdog system
    const AdvancedServerWatchdog = require('./file-protection/hardware-key/watchdog/advanced-server-watchdog');
    
    const watchdog = new AdvancedServerWatchdog({
        serverScript: path.join(__dirname, 'src', 'bot.js'),
        heartbeatInterval: 3000,  // Faster heartbeat
        restartDelay: 3000,
        maxRestarts: 10,
        restartWindow: 300000,  // 5 minute window
        logger
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Shutdown signal received...');
        await watchdog.shutdown();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        await watchdog.shutdown();
        process.exit(0);
    });
    
    try {
        await watchdog.start();
        logger.info('Press Ctrl+C to stop');
    } catch (error) {
        logger.error('Watchdog failed to start:', error.message);
        logger.warn('Falling back to normal mode...');
        startNormalMode();
    }
}

function startNormalMode() {
    logger.info('🚀 Starting bot in normal mode (no watchdog)...');
    
    const bot = spawn('node', ['src/bot.js'], {
        stdio: 'inherit',
        cwd: __dirname
    });
    
    bot.on('exit', (code) => {
        logger.warn(`Bot exited with code ${code}`);
        process.exit(code);
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Stopping bot...');
        bot.kill('SIGTERM');
    });
    
    process.on('SIGTERM', () => {
        bot.kill('SIGTERM');
    });
}

// Main startup logic
(async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 DarkLock Security Bot');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Check if watchdog dependencies are available
    const hasWatchdogModule = (() => {
        try {
            require.resolve('./file-protection/hardware-key/watchdog/server-watchdog');
            require.resolve('serialport');
            return true;
        } catch {
            return false;
        }
    })();
    
    if (!hasWatchdogModule) {
        logger.info('ℹ️  Hardware watchdog module not available');
        startNormalMode();
        return;
    }
    
    // Check if Pico is connected
    const watchdogAvailable = await checkWatchdogAvailable();
    
    if (watchdogAvailable) {
        logger.info('✅ Hardware watchdog detected');
        await startWithWatchdog();
    } else {
        logger.warn('⚠️  No hardware watchdog detected');
        logger.info('   Running in normal mode (no auto-restart protection)');
        logger.info('   Tip: Connect Raspberry Pi Pico for auto-recovery\n');
        startNormalMode();
    }
})().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
