#!/usr/bin/env node

const ServerWatchdog = require('./server-watchdog');
const path = require('path');

/**
 * Start script for Hardware Watchdog system
 */

// Configuration
const config = {
    serverScript: path.join(__dirname, '..', '..', '..', 'src', 'bot.js'),
    heartbeatInterval: 5000,    // Send heartbeat every 5 seconds
    restartDelay: 5000,         // Wait 5 seconds before restart
    maxRestarts: 10             // Max 10 restarts before giving up
};

// Logger with timestamps
const logger = {
    info: (...args) => console.log(`[${new Date().toISOString()}] [INFO]`, ...args),
    warn: (...args) => console.warn(`[${new Date().toISOString()}] [WARN]`, ...args),
    error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...args)
};

// Create watchdog manager
const watchdog = new ServerWatchdog({
    ...config,
    logger
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutdown signal received...');
    await watchdog.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await watchdog.stop();
    process.exit(0);
});

// Handle errors
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    watchdog.stop().then(() => process.exit(1));
});

// Start the system
(async () => {
    try {
        await watchdog.start();
        
        logger.info('Press Ctrl+C to stop the watchdog system');
        
        // Keep process alive
        setInterval(() => {
            // Optionally log status periodically
        }, 60000);
        
    } catch (error) {
        logger.error('Failed to start watchdog system:', error);
        process.exit(1);
    }
})();
