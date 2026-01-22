/**
 * Bot Startup Integration
 * Copy these snippets into src/bot.js at the appropriate locations
 */

// ═══════════════════════════════════════════════════════════════════
// SNIPPET 1: Add at TOP of bot.js (after require('dotenv').config())
// ═══════════════════════════════════════════════════════════════════

/*
// Enable legacy system tripwire (detects deprecated module imports)
const { enableTripwire } = require('./utils/legacy-disabler');
enableTripwire();
*/


// ═══════════════════════════════════════════════════════════════════
// SNIPPET 2: Add in initialize() method, AFTER database initialization
// ═══════════════════════════════════════════════════════════════════

/*
// Run database migrations
const MigrationRunner = require('./database/MigrationRunner');
const migrationRunner = new MigrationRunner(this.database.db, this.logger);
try {
    const migrationResult = await migrationRunner.run();
    if (migrationResult.applied > 0) {
        this.logger.info(`✅ Applied ${migrationResult.applied} database migration(s)`);
    }
} catch (migrationError) {
    this.logger.error('❌ Migration failed:', migrationError);
    // Decide: fail hard or continue with warning
    // throw migrationError; // Uncomment to fail on migration error
}
*/


// ═══════════════════════════════════════════════════════════════════
// SNIPPET 3: Replace dashboard initialization in initialize() method
// ═══════════════════════════════════════════════════════════════════

/*
// Initialize dashboard with modular bootstrap
const SecurityDashboard = require('./dashboard/dashboard');
const { startServer } = require('./dashboard/bootstrap');

this.dashboard = new SecurityDashboard(this);
const dashboardPort = process.env.WEB_PORT || 3001;

try {
    await startServer(this.dashboard, dashboardPort);
    this.logger.info(`✅ Dashboard started on port ${dashboardPort}`);
} catch (dashboardError) {
    this.logger.error('Failed to start dashboard:', dashboardError);
    // Dashboard failure is non-fatal for bot operation
}
*/


// ═══════════════════════════════════════════════════════════════════
// SNIPPET 4: Add audit check on startup (optional, for dev)
// ═══════════════════════════════════════════════════════════════════

/*
// Run refactor audit in development
if (process.env.NODE_ENV !== 'production' && process.env.RUN_AUDIT === 'true') {
    const { runAudit } = require('./utils/refactor-audit');
    runAudit();
}
*/


// ═══════════════════════════════════════════════════════════════════
// SNIPPET 5: Remove duplicate imports from bot.js header
// ═══════════════════════════════════════════════════════════════════

/*
// REMOVE these duplicate imports:
// const AntiNukeManager = require('./security/AntiNukeManager');  // REMOVE - use AntiNuke
// const EnhancedTicketManager = require('./utils/EnhancedTicketManager');  // REMOVE - use ticket-manager
// const HelpTicketSystem = require('./utils/HelpTicketSystem');  // REMOVE - use ticket-manager
// const TicketSystem = require('./utils/TicketSystem');  // REMOVE - use ticket-manager

// KEEP only:
const AntiNuke = require('./security/antinuke');
const TicketManager = require('./utils/ticket-manager');
*/


// ═══════════════════════════════════════════════════════════════════
// FULL INTEGRATION EXAMPLE
// ═══════════════════════════════════════════════════════════════════

async function exampleInitialize() {
    // 1. Enable tripwire before any other requires
    const { enableTripwire, getTripwireLog } = require('./utils/legacy-disabler');
    enableTripwire();

    // 2. Initialize database
    this.database = new Database();
    await this.database.initialize();

    // 3. Run migrations (idempotent, safe for every startup)
    const MigrationRunner = require('./database/MigrationRunner');
    const migrationRunner = new MigrationRunner(this.database.db, this.logger || console);
    
    const migrationResult = await migrationRunner.run();
    console.log(`Migrations: ${migrationResult.applied} applied, ${migrationResult.skipped} skipped`);

    // 4. Initialize logger
    this.logger = new Logger(this);
    await this.logger.initialize();

    // 5. Check for deprecated imports
    const violations = getTripwireLog();
    if (violations.length > 0) {
        this.logger.warn(`⚠️ ${violations.length} deprecated module import(s) detected`);
        violations.forEach(v => this.logger.warn(`  - ${v.module}`));
    }

    // 6. Continue with rest of initialization...
}

module.exports = { exampleInitialize };
