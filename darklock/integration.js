/**
 * Darklock Platform - Integration with Existing Bot
 * 
 * This file provides instructions and code for integrating the Darklock
 * platform shell with the existing Discord Security Bot without modifying
 * any of the bot's existing code.
 */

const DarklockPlatform = require('./server');
const path = require('path');

/**
 * INTEGRATION INSTRUCTIONS
 * ========================
 * 
 * The Darklock platform is designed to work alongside the existing Discord
 * Security Bot dashboard without any modifications to the bot's code.
 * 
 * There are TWO ways to integrate:
 * 
 * 1. MOUNT ON EXISTING EXPRESS APP (Recommended)
 *    - Add the platform routes to your existing dashboard
 *    - Single port, unified system
 *    - Platform lives under /platform/* routes
 * 
 * 2. RUN AS SEPARATE SERVER
 *    - Platform runs on its own port
 *    - Complete separation
 *    - Use reverse proxy to unify
 */

// ============================================================================
// OPTION 1: Mount on Existing Express App
// ============================================================================

/**
 * Add this code to your existing dashboard.js AFTER all other routes
 * but BEFORE starting the server:
 * 
 * ```javascript
 * // Near the top, with other requires
 * const DarklockPlatform = require('../darklock/server');
 * 
 * // After setting up all existing routes, before server.listen()
 * const darklock = new DarklockPlatform();
 * darklock.mountOn(this.app);
 * ```
 * 
 * This mounts the Darklock platform at /platform/* while leaving all
 * existing routes untouched.
 */

function integrateWithExistingDashboard(existingExpressApp) {
    const darklock = new DarklockPlatform();
    darklock.mountOn(existingExpressApp);
    
    console.log('[Integration] Darklock platform mounted successfully');
    console.log('[Integration] Existing bot routes: UNCHANGED');
    console.log('[Integration] New platform routes:');
    console.log('  - /platform (Homepage)');
    console.log('  - /platform/auth/login');
    console.log('  - /platform/auth/signup');
    console.log('  - /platform/dashboard');
    
    return darklock;
}

// ============================================================================
// OPTION 2: Run as Separate Server
// ============================================================================

/**
 * Run the Darklock platform on a separate port.
 * Useful if you want complete isolation or use a reverse proxy.
 */

async function runStandalone(port = 3002) {
    const darklock = new DarklockPlatform({ port });
    await darklock.start();
    
    console.log(`[Standalone] Darklock platform running on port ${port}`);
    console.log('[Standalone] Use a reverse proxy to unify with bot dashboard');
    
    return darklock;
}

// ============================================================================
// ROUTE STRUCTURE
// ============================================================================

/**
 * The Darklock platform adds these routes WITHOUT touching existing routes:
 * 
 * PLATFORM ROUTES (New):
 * - GET  /platform               -> Homepage
 * - GET  /platform/auth/login    -> Login page
 * - GET  /platform/auth/signup   -> Signup page
 * - POST /platform/auth/login    -> Handle login
 * - POST /platform/auth/signup   -> Handle signup
 * - POST /platform/auth/logout   -> Handle logout
 * - GET  /platform/auth/me       -> Current user info
 * - GET  /platform/auth/sessions -> User's sessions
 * - DELETE /platform/auth/sessions/:id -> Revoke session
 * - GET  /platform/dashboard     -> Dashboard (SPA)
 * - GET  /platform/dashboard/api/stats -> Dashboard stats
 * - GET  /platform/dashboard/api/apps  -> Available apps
 * - GET  /platform/profile/api/* -> Profile management
 * - Static: /platform/static/*   -> CSS, JS, icons
 * 
 * EXISTING BOT ROUTES (Unchanged):
 * - GET  /                       -> Bot landing page
 * - GET  /dashboard              -> Bot dashboard
 * - GET  /login                  -> Bot login
 * - All /api/* routes            -> Bot API
 * - All /admin/* routes          -> Bot admin
 * - All /setup/* routes          -> Bot setup
 * - Everything else              -> Unchanged
 * 
 * The platform and bot dashboards are completely separate:
 * - /platform/dashboard = Darklock Platform Dashboard
 * - /dashboard = Discord Bot Dashboard
 */

// ============================================================================
// DATA STORAGE
// ============================================================================

/**
 * Darklock stores data in:
 * - /darklock/data/users.json    -> User accounts
 * - /darklock/data/sessions.json -> Active sessions
 * 
 * This is separate from the bot's database (SQLite).
 * 
 * For Render deployment:
 * - Set DATA_PATH environment variable to /data
 * - Files will persist across deploys
 */

// ============================================================================
// EXAMPLE: Full Integration Code for dashboard.js
// ============================================================================

const INTEGRATION_EXAMPLE = `
// ============================================================
// ADD TO src/dashboard/dashboard.js
// ============================================================

// At the top, with other requires:
const DarklockPlatform = require('../../darklock/server');

// In the start() method, AFTER all existing routes are set up:

async start(port) {
    // ... existing setup code ...
    
    // Mount Darklock Platform (after all existing routes)
    const darklock = new DarklockPlatform();
    darklock.mountOn(this.app);
    
    // Start the server (existing code)
    return new Promise((resolve) => {
        this.server = this.app.listen(port, () => {
            console.log(\`Dashboard running on port \${port}\`);
            console.log('Darklock Platform available at /platform');
            resolve(this.server);
        });
    });
}
`;

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    DarklockPlatform,
    integrateWithExistingDashboard,
    runStandalone,
    INTEGRATION_EXAMPLE
};

// If run directly, start standalone server
if (require.main === module) {
    const port = process.env.DARKLOCK_PORT || 3002;
    runStandalone(port).catch(console.error);
}
