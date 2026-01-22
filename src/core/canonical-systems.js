/**
 * CANONICAL SYSTEMS REGISTRY
 * 
 * This module enforces ONE canonical system per domain.
 * Any attempt to import a deprecated duplicate will HARD FAIL.
 * 
 * Run BEFORE any other imports in bot.js
 */

'use strict';

const Module = require('module');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// CANONICAL SYSTEMS - The ONE true implementation per domain
// ═══════════════════════════════════════════════════════════════════
const CANONICAL_SYSTEMS = {
    // Ticket system - use ONLY ticket-manager.js
    tickets: {
        canonical: 'src/utils/ticket-manager.js',
        description: 'Unified ticket management'
    },
    
    // Anti-nuke - use ONLY antinuke.js
    antinuke: {
        canonical: 'src/security/antinuke.js',
        description: 'Anti-nuke protection'
    },
    
    // Trust Score - behavior-based trust scoring (replaced gamification rank system)
    trust: {
        canonical: 'src/utils/TrustScore.js',
        description: 'Behavior-based user trust scoring'
    }
};

// ═══════════════════════════════════════════════════════════════════
// DEPRECATED SYSTEMS - HARD FAIL on import (or files already deleted)
// ═══════════════════════════════════════════════════════════════════
const DEPRECATED_SYSTEMS = new Map([
    // DELETED: Duplicate ticket systems removed in Phase 2
    // EnhancedTicketManager.js, HelpTicketSystem.js, TicketSystem.js have been deleted
    // Use ticket-manager.js instead
    
    // DELETED: Anti-nuke duplicates removed in Phase 1
    // AntiNukeManager.js and AntiNukeEngine.js have been deleted
    
    // DELETED: Rank system removed in Phase 1
    // RankSystem.js, RankCardGenerator.js have been deleted
    // Replaced with TrustScore.js
    
    // Economy system (entire removal)
    ['src/systems/EconomySystem.js', { 
        domain: 'economy', 
        reason: 'Economy system removed from security bot' 
    }],
    ['src/utils/EconomyManager.js', { 
        domain: 'economy', 
        reason: 'Economy system removed from security bot' 
    }]
]);

// ═══════════════════════════════════════════════════════════════════
// AI SYSTEM CONTROLS
// ═══════════════════════════════════════════════════════════════════
const AI_SYSTEMS = new Map([
    ['src/utils/OpenAIClient.js', { 
        domain: 'ai', 
        action: 'sandbox',
        reason: 'AI should not run in security bot process'
    }]
]);

// Track what gets blocked
const blockLog = [];
let enforcing = false;

// ═══════════════════════════════════════════════════════════════════
// ENFORCEMENT HOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize a require path to a relative project path
 */
function normalizeToProjectPath(requestedPath, parentPath) {
    try {
        // If it's a relative path, resolve it
        if (requestedPath.startsWith('.')) {
            const resolved = path.resolve(path.dirname(parentPath), requestedPath);
            const projectRoot = path.resolve(__dirname, '../..');
            return path.relative(projectRoot, resolved).replace(/\\/g, '/');
        }
        return requestedPath;
    } catch {
        return requestedPath;
    }
}

/**
 * Enable system enforcement - MUST be called at very top of bot.js
 */
function enforceCanonicalSystems() {
    if (enforcing) return; // Already active
    enforcing = true;

    const originalLoad = Module._load;
    const projectRoot = path.resolve(__dirname, '../..');

    Module._load = function(request, parent, isMain) {
        const parentFile = parent?.filename || '';
        const normalizedPath = normalizeToProjectPath(request, parentFile);
        
        // Check if this is a deprecated system
        for (const [deprecatedPath, info] of DEPRECATED_SYSTEMS) {
            if (normalizedPath.includes(deprecatedPath.replace('src/', '')) || 
                request.includes(path.basename(deprecatedPath, '.js'))) {
                
                const canonical = CANONICAL_SYSTEMS[info.domain]?.canonical || 'N/A';
                const errorMsg = `
═══════════════════════════════════════════════════════════════════
🚫 DEPRECATED SYSTEM IMPORT BLOCKED
═══════════════════════════════════════════════════════════════════
Attempted:  ${request}
From:       ${parentFile}
Domain:     ${info.domain}
Reason:     ${info.reason}
Canonical:  ${canonical}

FIX: Update import to use the canonical system.
═══════════════════════════════════════════════════════════════════`;
                
                blockLog.push({
                    blocked: request,
                    from: parentFile,
                    domain: info.domain,
                    reason: info.reason,
                    timestamp: new Date().toISOString()
                });

                // HARD FAIL - throw error to prevent bot from starting with duplicates
                throw new Error(errorMsg);
            }
        }

        // Check if this is an AI system (warn but allow for now)
        for (const [aiPath, info] of AI_SYSTEMS) {
            if (normalizedPath.includes(aiPath.replace('src/', '')) ||
                request.includes(path.basename(aiPath, '.js'))) {
                
                console.warn(`
⚠️  AI SYSTEM LOADED: ${request}
    Consider sandboxing AI into a separate process.
    Security bots should minimize AI exposure.
`);
                blockLog.push({
                    warned: request,
                    from: parentFile,
                    domain: info.domain,
                    reason: info.reason,
                    timestamp: new Date().toISOString()
                });
            }
        }

        return originalLoad.apply(this, arguments);
    };

    console.log('✅ Canonical system enforcement ACTIVE');
    return true;
}

/**
 * Get the block/warn log
 */
function getEnforcementLog() {
    return [...blockLog];
}

/**
 * Check if enforcement is active
 */
function isEnforcing() {
    return enforcing;
}

/**
 * Get canonical system for a domain
 */
function getCanonical(domain) {
    return CANONICAL_SYSTEMS[domain] || null;
}

/**
 * List all canonical systems
 */
function listCanonicalSystems() {
    return Object.entries(CANONICAL_SYSTEMS).map(([domain, info]) => ({
        domain,
        ...info
    }));
}

/**
 * Validate that canonical files exist
 */
function validateCanonicalFilesExist() {
    const fs = require('fs');
    const projectRoot = path.resolve(__dirname, '../..');
    const missing = [];

    for (const [domain, info] of Object.entries(CANONICAL_SYSTEMS)) {
        const fullPath = path.join(projectRoot, info.canonical);
        if (!fs.existsSync(fullPath)) {
            missing.push({ domain, path: info.canonical });
        }
    }

    if (missing.length > 0) {
        console.error('❌ Missing canonical system files:');
        missing.forEach(m => console.error(`   - ${m.domain}: ${m.path}`));
        return false;
    }

    return true;
}

module.exports = {
    CANONICAL_SYSTEMS,
    DEPRECATED_SYSTEMS,
    AI_SYSTEMS,
    enforceCanonicalSystems,
    getEnforcementLog,
    isEnforcing,
    getCanonical,
    listCanonicalSystems,
    validateCanonicalFilesExist
};
