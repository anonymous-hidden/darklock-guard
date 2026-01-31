/**
 * Darklock Platform - Standalone Server Starter
 * Simple entry point to run the Darklock Platform independently
 */

// Load environment variables from parent directory
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DarklockPlatform = require('./server');

// Create and start the platform
// Prefer Render/host-provided PORT, then DARKLOCK_PORT, fallback to 3002
const platform = new DarklockPlatform({
    port: process.env.PORT || process.env.DARKLOCK_PORT || 3002
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
