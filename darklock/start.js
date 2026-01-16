/**
 * Darklock Platform - Standalone Server Starter
 * Simple entry point to run the Darklock Platform independently
 */

const DarklockPlatform = require('./server');

// Create and start the platform
const platform = new DarklockPlatform({
    port: process.env.DARKLOCK_PORT || 3002
});

platform.start().then(() => {
    console.log('[Darklock] ✅ Platform started successfully');
}).catch(err => {
    console.error('[Darklock] ❌ Failed to start:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Darklock] Shutting down gracefully...');
    platform.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[Darklock] Shutting down gracefully...');
    platform.stop();
    process.exit(0);
});
