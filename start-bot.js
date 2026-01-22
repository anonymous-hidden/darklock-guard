#!/usr/bin/env node

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
