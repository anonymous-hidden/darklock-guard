/**
 * COMMAND ALLOWLIST - Security Bot Command Whitelist
 * 
 * Only commands explicitly listed here will be loaded.
 * This prevents accidental loading of economy, fun, or AI commands.
 * 
 * To add a command: Add it to the appropriate category Set below.
 * To disable a command: Remove it from the Set (file remains intact).
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// SECURITY COMMANDS - Core protection features
// ═══════════════════════════════════════════════════════════════════
const SECURITY_COMMANDS = new Set([
    // Unified automod (replaces anti-* commands)
    'automod',
    
    // Complex standalone features
    'antinuke',
    'wordfilter',
    'altdetect',
    
    // Security visibility
    'security',
    'status',
    
    // Specialized
    'baseline-update',
    'rolescan'
]);

// ═══════════════════════════════════════════════════════════════════
// MODERATION COMMANDS - Staff tools
// ═══════════════════════════════════════════════════════════════════
const MODERATION_COMMANDS = new Set([
    'ban',
    'unban',
    'kick',
    'timeout',
    'warn',
    'modnote',
    'cases',
    'purge',
    'lock',
    'unlock',
    'slowmode',
    'appeal',
    'strike',
    'quarantine',
    'redact'          // Context menu: Redact & Delete (privacy-focused message deletion)
]);

// ═══════════════════════════════════════════════════════════════════
// ADMIN COMMANDS - Server configuration (consolidated)
// ═══════════════════════════════════════════════════════════════════
const ADMIN_COMMANDS = new Set([
    // NEW: Consolidated commands
    'setup',           // Unified config: wizard, onboarding, roles, permissions, language, view
    'admin',           // Destructive actions: lockdown, unlock, slowmode, nuke, audit
    'settings',        // Alias → redirects to /setup
    
    // Complex standalone (keep separate)
    'serverbackup',
    'reactionroles',   // Standardized plural form
    'channelaccess',
    'serversetup',
    'voicemonitor',
    'xp'
]);

// ═══════════════════════════════════════════════════════════════════
// UTILITY COMMANDS - User-facing and mod tools
// ═══════════════════════════════════════════════════════════════════
const UTILITY_COMMANDS = new Set([
    'ticket-new',      // Unified ticket command (replaces ticket + ticket-manage)
    'help',
    'ping',
    'serverinfo',
    'userinfo',
    'announce',
    'poll',
    'invites',
    'schedule',
    'auditlog',
    'trustscore',
    'rank',
    'leaderboard',
    'analytics'
]);

// ═══════════════════════════════════════════════════════════════════
// DEPRECATED COMMANDS - Still load but show migration warnings
// Will be removed in future update
// ═══════════════════════════════════════════════════════════════════
const DEPRECATED_COMMANDS = new Set([
    // Moved to /automod
    'anti-phishing',   // → /automod phishing
    'anti-raid',       // → /automod raid
    'anti-spam',       // → /automod spam
    'anti-links',      // → /automod links
    'emojispam',       // → /automod emoji
    
    // Moved to /admin
    'lockdown',        // → /admin lockdown
    'unlockdown',      // → /admin unlock
    'server',          // → /admin
    'rolescan',        // → /admin audit type:roles
    
    // Moved to /setup
    'wizard',          // → /setup wizard
    'onboarding',      // → /setup onboarding
    'verified_setup',  // → /setup onboarding
    'autorole',        // → /setup roles
    'permissions',     // → /setup permissions
    'language',        // → /setup language
    'welcome',         // → /setup welcome
    'goodbye',         // → /setup goodbye
    
    // Merged into other commands
    'ticket',          // → /ticket-new (renamed, unified)
    'ticket-manage',   // → /ticket-new (subcommands)
    'reactionrole',    // → /reactionroles (standardized plural)
    'verification',    // → /setup onboarding
    'embed',           // → /announce (with embed option)
    'selfrole',        // → /reactionroles
    'modmail',         // → /ticket modmail
    'webhookprotect'   // → /security webhooks
]);

// ═══════════════════════════════════════════════════════════════════
// BLOCKED COMMANDS - Files deleted, kept for reference
// ═══════════════════════════════════════════════════════════════════
const BLOCKED_COMMANDS = new Set([
    // Economy (REMOVED - files deleted)
    'balance',
    'buy',
    'coinflip',
    'daily',
    'deposit',
    'inventory',
    'pay',
    'shop',
    'top10',
    'withdraw',
    'work',
    
    // Fun/Games (REMOVED - files deleted)
    '8ball',
    'roll',
    'avatar',
    
    // AI (REMOVED - files deleted)
    'ai',
    'ai_security_help',
    'ticket_ai_summarize',
    
    // Other removed
    'xp-boost',
    'rep'
]);

// ═══════════════════════════════════════════════════════════════════
// COMBINED ALLOWLIST
// ═══════════════════════════════════════════════════════════════════
const ALLOWED_COMMANDS = new Set([
    ...SECURITY_COMMANDS,
    ...MODERATION_COMMANDS,
    ...ADMIN_COMMANDS,
    ...UTILITY_COMMANDS,
    ...DEPRECATED_COMMANDS  // Still allowed, but will show warnings
]);

// ═══════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a command is allowed to load
 * @param {string} commandName - Name of command (without .js)
 * @returns {boolean}
 */
function isCommandAllowed(commandName) {
    const name = commandName.replace(/\.js$/, '');
    return ALLOWED_COMMANDS.has(name);
}

/**
 * Check if a command is explicitly blocked
 * @param {string} commandName - Name of command (without .js)
 * @returns {boolean}
 */
function isCommandBlocked(commandName) {
    const name = commandName.replace(/\.js$/, '');
    return BLOCKED_COMMANDS.has(name);
}

/**
 * Check if a command is deprecated
 * @param {string} commandName - Name of command (without .js)
 * @returns {boolean}
 */
function isCommandDeprecated(commandName) {
    const name = commandName.replace(/\.js$/, '');
    return DEPRECATED_COMMANDS.has(name);
}

/**
 * Get the category of an allowed command
 * @param {string} commandName - Name of command
 * @returns {string|null}
 */
function getCommandCategory(commandName) {
    const name = commandName.replace(/\.js$/, '');
    if (SECURITY_COMMANDS.has(name)) return 'security';
    if (MODERATION_COMMANDS.has(name)) return 'moderation';
    if (ADMIN_COMMANDS.has(name)) return 'admin';
    if (UTILITY_COMMANDS.has(name)) return 'utility';
    if (DEPRECATED_COMMANDS.has(name)) return 'deprecated';
    return null;
}

/**
 * Get statistics about the allowlist
 * @returns {Object}
 */
function getAllowlistStats() {
    return {
        security: SECURITY_COMMANDS.size,
        moderation: MODERATION_COMMANDS.size,
        admin: ADMIN_COMMANDS.size,
        utility: UTILITY_COMMANDS.size,
        deprecated: DEPRECATED_COMMANDS.size,
        total: ALLOWED_COMMANDS.size,
        blocked: BLOCKED_COMMANDS.size
    };
}

/**
 * Validate that no command appears in both allowed and blocked
 */
function validateAllowlist() {
    const conflicts = [];
    for (const cmd of BLOCKED_COMMANDS) {
        if (ALLOWED_COMMANDS.has(cmd)) {
            conflicts.push(cmd);
        }
    }
    if (conflicts.length > 0) {
        throw new Error(`Command allowlist conflict: ${conflicts.join(', ')} appear in both ALLOWED and BLOCKED`);
    }
    return true;
}

// Run validation on module load
validateAllowlist();

module.exports = {
    SECURITY_COMMANDS,
    MODERATION_COMMANDS,
    ADMIN_COMMANDS,
    UTILITY_COMMANDS,
    DEPRECATED_COMMANDS,
    ALLOWED_COMMANDS,
    BLOCKED_COMMANDS,
    isCommandAllowed,
    isCommandBlocked,
    isCommandDeprecated,
    getCommandCategory,
    getAllowlistStats,
    validateAllowlist
};
