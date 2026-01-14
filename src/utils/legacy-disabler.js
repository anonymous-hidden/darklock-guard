/**
 * Legacy System Disabler
 * Hard-disables duplicate systems and provides tripwire detection
 */

const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// CANONICAL SYSTEMS (the ones to KEEP)
// ═══════════════════════════════════════════════════════════════════

const CANONICAL_SYSTEMS = {
    // AntiNuke: Keep only the main system
    antinuke: 'src/security/antinuke.js',
    
    // Tickets: Keep the main ticket manager
    tickets: 'src/utils/ticket-manager.js',
    
    // Rank: Keep both (logic + rendering are separate concerns)
    rankSystem: 'src/utils/RankSystem.js',
    rankCard: 'src/utils/RankCardGenerator.js'
};

// ═══════════════════════════════════════════════════════════════════
// DEPRECATED FILES (should NOT be imported)
// ═══════════════════════════════════════════════════════════════════

const DEPRECATED_FILES = [
    // AntiNuke duplicates
    'src/utils/AntiNukeManager.js',
    'src/utils/AntiNukeEngine.js',
    'src/security/AntiNukeManager.js',
    
    // Ticket duplicates
    'src/utils/EnhancedTicketManager.js',
    'src/utils/HelpTicketSystem.js',
    'src/systems/TicketSystem.js',
    'src/systems/EnhancedTicketManager.js',
    'src/systems/HelpTicketSystem.js',
    
    // Rank duplicates
    'src/systems/rankCardGenerator.js'
];

// ═══════════════════════════════════════════════════════════════════
// TRIPWIRE: Detect hidden imports of deprecated modules
// ═══════════════════════════════════════════════════════════════════

const Module = require('module');
const originalRequire = Module.prototype.require;

let tripwireEnabled = false;
const tripwireLog = [];

/**
 * Enable tripwire detection for deprecated module imports
 * Call this early in bot.js to detect any legacy imports
 */
function enableTripwire() {
    if (tripwireEnabled) return;
    tripwireEnabled = true;

    Module.prototype.require = function(id) {
        const resolvedPath = resolveModulePath(this, id);
        
        if (resolvedPath) {
            const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
            
            for (const deprecated of DEPRECATED_FILES) {
                if (relativePath === deprecated || relativePath.endsWith(deprecated)) {
                    const error = new Error(`TRIPWIRE: Deprecated module imported: ${deprecated}`);
                    const stack = error.stack.split('\n').slice(2, 6).join('\n');
                    
                    tripwireLog.push({
                        module: deprecated,
                        timestamp: new Date().toISOString(),
                        stack
                    });

                    console.warn(`\n⚠️  TRIPWIRE TRIGGERED ⚠️`);
                    console.warn(`Deprecated module imported: ${deprecated}`);
                    console.warn(`Stack trace:\n${stack}`);
                    console.warn(`\nUse canonical system instead: ${getCanonicalAlternative(deprecated)}\n`);
                }
            }
        }

        return originalRequire.apply(this, arguments);
    };

    console.log('🔍 Legacy system tripwire enabled');
}

/**
 * Resolve module path safely
 */
function resolveModulePath(parentModule, id) {
    try {
        return require.resolve(id, { paths: [path.dirname(parentModule.filename)] });
    } catch {
        return null;
    }
}

/**
 * Get canonical alternative for deprecated module
 */
function getCanonicalAlternative(deprecated) {
    if (deprecated.includes('AntiNuke')) return CANONICAL_SYSTEMS.antinuke;
    if (deprecated.includes('Ticket')) return CANONICAL_SYSTEMS.tickets;
    if (deprecated.includes('rank') || deprecated.includes('Rank')) {
        return `${CANONICAL_SYSTEMS.rankSystem} or ${CANONICAL_SYSTEMS.rankCard}`;
    }
    return 'See CANONICAL_SYSTEMS in legacy-disabler.js';
}

/**
 * Get tripwire violations log
 */
function getTripwireLog() {
    return [...tripwireLog];
}

/**
 * Disable tripwire (for testing)
 */
function disableTripwire() {
    if (!tripwireEnabled) return;
    Module.prototype.require = originalRequire;
    tripwireEnabled = false;
}

// ═══════════════════════════════════════════════════════════════════
// STUB GENERATORS: Create disabled stubs for deprecated modules
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate stub content for a deprecated module
 */
function generateStub(moduleName, canonicalPath) {
    return `/**
 * ⚠️ DEPRECATED MODULE - DO NOT USE ⚠️
 * 
 * This module has been deprecated and disabled.
 * Use the canonical system instead: ${canonicalPath}
 * 
 * This stub exists to prevent silent failures.
 * Any attempt to use this module will throw an error.
 */

const DEPRECATED_MESSAGE = \`
╔══════════════════════════════════════════════════════════════╗
║  DEPRECATED MODULE: ${moduleName.padEnd(40)} ║
║  This module has been disabled during refactoring.           ║
║  Please update your import to use:                           ║
║  ${canonicalPath.padEnd(58)} ║
╚══════════════════════════════════════════════════════════════╝
\`;

class DeprecatedModule {
    constructor() {
        console.error(DEPRECATED_MESSAGE);
        throw new Error(\`Module ${moduleName} is deprecated. Use ${canonicalPath} instead.\`);
    }
}

module.exports = DeprecatedModule;
module.exports.default = DeprecatedModule;

// Throw on any property access
module.exports = new Proxy(DeprecatedModule, {
    get(target, prop) {
        if (prop === 'prototype' || prop === 'constructor') return target[prop];
        console.error(DEPRECATED_MESSAGE);
        throw new Error(\`Module ${moduleName} is deprecated. Use ${canonicalPath} instead.\`);
    },
    construct() {
        console.error(DEPRECATED_MESSAGE);
        throw new Error(\`Module ${moduleName} is deprecated. Use ${canonicalPath} instead.\`);
    }
});
`;
}

/**
 * Write stub files to disable deprecated modules
 */
function writeStubs(baseDir = process.cwd()) {
    const fs = require('fs');
    const written = [];

    for (const deprecated of DEPRECATED_FILES) {
        const fullPath = path.join(baseDir, deprecated);
        const canonical = getCanonicalAlternative(deprecated);
        const moduleName = path.basename(deprecated, '.js');

        // Backup original if it exists
        if (fs.existsSync(fullPath)) {
            const backupPath = fullPath + '.deprecated.bak';
            if (!fs.existsSync(backupPath)) {
                fs.copyFileSync(fullPath, backupPath);
            }
        }

        // Write stub
        fs.writeFileSync(fullPath, generateStub(moduleName, canonical));
        written.push(deprecated);
    }

    return written;
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate that canonical systems exist
 */
function validateCanonicalSystems(baseDir = process.cwd()) {
    const fs = require('fs');
    const issues = [];

    for (const [name, relativePath] of Object.entries(CANONICAL_SYSTEMS)) {
        const fullPath = path.join(baseDir, relativePath);
        if (!fs.existsSync(fullPath)) {
            issues.push(`Missing canonical system: ${name} at ${relativePath}`);
        }
    }

    return {
        valid: issues.length === 0,
        issues
    };
}

/**
 * Check for duplicate imports in a file
 */
function checkDuplicateImports(filePath) {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = [];

    for (const deprecated of DEPRECATED_FILES) {
        const moduleName = path.basename(deprecated, '.js');
        const patterns = [
            new RegExp(`require\\s*\\(\\s*['"\`].*${moduleName}['"\`]\\s*\\)`, 'g'),
            new RegExp(`from\\s+['"\`].*${moduleName}['"\`]`, 'g')
        ];

        for (const pattern of patterns) {
            const matches = content.match(pattern);
            if (matches) {
                issues.push({
                    file: filePath,
                    deprecated: moduleName,
                    matches: matches.length,
                    canonical: getCanonicalAlternative(deprecated)
                });
            }
        }
    }

    return issues;
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    CANONICAL_SYSTEMS,
    DEPRECATED_FILES,
    enableTripwire,
    disableTripwire,
    getTripwireLog,
    generateStub,
    writeStubs,
    validateCanonicalSystems,
    checkDuplicateImports,
    getCanonicalAlternative
};
