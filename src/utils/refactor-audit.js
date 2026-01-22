/**
 * HIGH-RISK REFACTOR AUDIT
 * Identifies remaining issues that need attention
 * Run with: node src/utils/refactor-audit.js
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// AUDIT CATEGORIES
// ═══════════════════════════════════════════════════════════════════

const AUDIT_RESULTS = {
    authCoverage: [],
    eventDoubleBinding: [],
    deadCode: [],
    securityTodos: [],
    hardcodedStrings: [],
    missingErrorHandling: []
};

// ═══════════════════════════════════════════════════════════════════
// 1. AUTH COVERAGE GAPS
// ═══════════════════════════════════════════════════════════════════

const AUTH_ISSUES = [
    {
        file: 'src/dashboard/dashboard.js',
        line: 'multiple',
        issue: 'Some API routes may bypass authMiddleware',
        severity: 'HIGH',
        recommendation: 'Audit all app.get/post/put/delete calls - ensure authMiddleware is applied'
    },
    {
        file: 'src/dashboard/routes/analytics.js',
        line: 'admin endpoints',
        issue: 'Admin endpoints should verify bot owner or dashboard admin role',
        severity: 'MEDIUM',
        recommendation: 'Add explicit admin check before accessing global stats'
    },
    {
        file: 'src/dashboard/websocket/handler.js',
        line: 'verifyClient',
        issue: 'WebSocket token validation relies solely on JWT - no session revocation check',
        severity: 'HIGH',
        recommendation: 'Cross-check sessionStore.get(decoded.sessionId) for revoked sessions'
    },
    {
        file: 'src/bot.js',
        line: '~86-100',
        issue: 'Both AntiNuke and AntiNukeManager are imported - duplicate systems',
        severity: 'MEDIUM',
        recommendation: 'Remove AntiNukeManager import, use only AntiNuke'
    }
];

// ═══════════════════════════════════════════════════════════════════
// 2. EVENT DOUBLE-BINDING RISKS
// ═══════════════════════════════════════════════════════════════════

const EVENT_BINDING_ISSUES = [
    {
        file: 'src/bot.js',
        event: 'guildMemberAdd',
        issue: 'Multiple handlers may be registered for same event across security modules',
        locations: [
            'src/security/antiraid.js',
            'src/security/userverification.js',
            'src/events/guildMemberAdd.js'
        ],
        recommendation: 'Consolidate into single event file with ordered handler calls'
    },
    {
        file: 'src/bot.js',
        event: 'messageCreate',
        issue: 'Message processing spread across multiple handlers',
        locations: [
            'src/security/antispam.js',
            'src/security/toxicity.js',
            'src/security/antiphishing.js',
            'src/events/messageCreate.js'
        ],
        recommendation: 'Create MessageProcessor class with pipeline pattern'
    },
    {
        file: 'src/dashboard/dashboard.js',
        event: 'WebSocket connection',
        issue: 'Old WSS setup may conflict with new WebSocketHandler',
        recommendation: 'Remove legacy this.wss setup, use only WebSocketHandler'
    }
];

// ═══════════════════════════════════════════════════════════════════
// 3. DEAD CODE CANDIDATES
// ═══════════════════════════════════════════════════════════════════

const DEAD_CODE = [
    {
        file: 'src/utils/AntiNukeManager.js',
        reason: 'Duplicate of src/security/antinuke.js',
        action: 'DELETE after verifying no active imports'
    },
    {
        file: 'src/utils/AntiNukeEngine.js',
        reason: 'Duplicate detection logic',
        action: 'DELETE after verifying no active imports'
    },
    {
        file: 'src/systems/rankCardGenerator.js',
        reason: 'Duplicate of src/utils/RankCardGenerator.js',
        action: 'DELETE after verifying no active imports'
    },
    {
        file: 'src/utils/EnhancedTicketManager.js',
        reason: 'Functionality merged into ticket-manager.js',
        action: 'DELETE after verifying no active imports'
    },
    {
        file: 'src/utils/HelpTicketSystem.js',
        reason: 'Subset of ticket-manager.js',
        action: 'DELETE after verifying no active imports'
    },
    {
        file: 'src/commands/economy/*',
        reason: 'Economy system scheduled for removal',
        action: 'DELETE entire directory per ECONOMY_REMOVAL_PLAN.md'
    },
    {
        file: 'SECURITY_INTEGRATION_GUIDE.js',
        reason: 'Documentation in wrong format (should be .md)',
        action: 'CONVERT to markdown or DELETE'
    },
    {
        file: 'src/database/migrations/MigrationFramework.js',
        reason: 'Replaced by src/database/MigrationRunner.js',
        action: 'DELETE after confirming MigrationRunner is integrated'
    }
];

// ═══════════════════════════════════════════════════════════════════
// 4. SECURITY-IMPACTING TODOS
// ═══════════════════════════════════════════════════════════════════

const SECURITY_TODOS = [
    {
        priority: 'CRITICAL',
        issue: 'JWT_SECRET validation',
        file: 'src/dashboard/dashboard.js',
        detail: 'validateSecrets() should enforce minimum key length (32+ bytes)',
        fix: 'Add: if (process.env.JWT_SECRET.length < 32) throw new Error(...)'
    },
    {
        priority: 'CRITICAL',
        issue: 'Session store cleanup',
        file: 'src/dashboard/security-utils.js',
        detail: 'sessionStore may grow unbounded - needs periodic cleanup',
        fix: 'Add setInterval to purge expired sessions every 15 minutes'
    },
    {
        priority: 'HIGH',
        issue: 'CSRF token per-session',
        file: 'src/dashboard/middleware.js',
        detail: 'CSRF tokens should be tied to session, not just generated once',
        fix: 'Regenerate CSRF on login, validate against session-stored value'
    },
    {
        priority: 'HIGH',
        issue: 'Rate limit by user ID',
        file: 'src/dashboard/middleware.js',
        detail: 'API rate limit uses IP which can be shared (NAT/proxy)',
        fix: 'Use req.user?.userId || req.ip as keyGenerator'
    },
    {
        priority: 'MEDIUM',
        issue: 'Audit log retention',
        file: 'src/dashboard/services/AuditLogService.js',
        detail: 'No automatic cleanup of old audit logs',
        fix: 'Add scheduled job to call cleanOldLogs(90) daily'
    },
    {
        priority: 'MEDIUM',
        issue: 'Error message leakage',
        file: 'multiple',
        detail: 'Some catch blocks return err.message in production',
        fix: 'Wrap in isDev check: process.env.NODE_ENV !== "production"'
    },
    {
        priority: 'LOW',
        issue: 'Cookie security flags',
        file: 'src/dashboard/routes/auth.js',
        detail: 'authToken cookie should have sameSite, httpOnly, secure flags',
        fix: 'res.cookie("authToken", token, { httpOnly: true, secure: true, sameSite: "strict" })'
    }
];

// ═══════════════════════════════════════════════════════════════════
// 5. HARDCODED ENGLISH STRINGS (Localization gaps)
// ═══════════════════════════════════════════════════════════════════

const HARDCODED_STRINGS = [
    {
        pattern: /res\.status\(\d+\)\.json\(\s*\{\s*error:\s*['"`][A-Z]/,
        files: ['src/dashboard/**/*.js'],
        issue: 'Error messages starting with capital letter are likely hardcoded',
        fix: 'Replace with t("dashboard.errors.xxx") from i18n'
    },
    {
        pattern: /message:\s*['"`][A-Z][^'"`]*successfully/i,
        files: ['src/dashboard/**/*.js'],
        issue: 'Success messages are hardcoded',
        fix: 'Replace with t("dashboard.xxx.success")'
    },
    {
        pattern: /\.send\(\s*['"`][^'"`]{20,}/,
        files: ['src/commands/**/*.js'],
        issue: 'Long string literals in commands may need localization',
        fix: 'Review and add to locale files'
    }
];

// ═══════════════════════════════════════════════════════════════════
// 6. MISSING ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════

const ERROR_HANDLING_GAPS = [
    {
        file: 'src/dashboard/routes/guild.js',
        issue: 'Database operations may throw without proper error boundaries',
        fix: 'Wrap all db.* calls in try/catch with proper HTTP status codes'
    },
    {
        file: 'src/dashboard/websocket/handler.js',
        issue: 'Message parsing can throw on malformed JSON',
        fix: 'Add try/catch around JSON.parse in handleMessage'
    },
    {
        file: 'src/bot.js',
        issue: 'initialize() has multiple async operations that could fail silently',
        fix: 'Add individual try/catch with specific error messages per module init'
    }
];

// ═══════════════════════════════════════════════════════════════════
// AUDIT RUNNER
// ═══════════════════════════════════════════════════════════════════

function runAudit() {
    console.log('═'.repeat(70));
    console.log('  DarkLock REFACTOR AUDIT REPORT');
    console.log('  Generated:', new Date().toISOString());
    console.log('═'.repeat(70));

    // 1. Auth Coverage
    console.log('\n🔐 AUTH COVERAGE GAPS\n');
    AUTH_ISSUES.forEach((issue, i) => {
        console.log(`  ${i + 1}. [${issue.severity}] ${issue.file}`);
        console.log(`     Issue: ${issue.issue}`);
        console.log(`     Fix: ${issue.recommendation}\n`);
    });

    // 2. Event Double-Binding
    console.log('\n⚡ EVENT DOUBLE-BINDING RISKS\n');
    EVENT_BINDING_ISSUES.forEach((issue, i) => {
        console.log(`  ${i + 1}. Event: ${issue.event}`);
        console.log(`     Locations: ${issue.locations?.join(', ') || issue.file}`);
        console.log(`     Fix: ${issue.recommendation}\n`);
    });

    // 3. Dead Code
    console.log('\n🗑️  DEAD CODE CANDIDATES\n');
    DEAD_CODE.forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.file}`);
        console.log(`     Reason: ${item.reason}`);
        console.log(`     Action: ${item.action}\n`);
    });

    // 4. Security TODOs
    console.log('\n🔒 SECURITY-IMPACTING TODOS\n');
    SECURITY_TODOS.forEach((todo, i) => {
        console.log(`  ${i + 1}. [${todo.priority}] ${todo.issue}`);
        console.log(`     File: ${todo.file}`);
        console.log(`     Detail: ${todo.detail}`);
        console.log(`     Fix: ${todo.fix}\n`);
    });

    // 5. Hardcoded Strings
    console.log('\n🌐 HARDCODED STRINGS (Localization)\n');
    HARDCODED_STRINGS.forEach((item, i) => {
        console.log(`  ${i + 1}. Pattern: ${item.pattern.toString().slice(0, 50)}...`);
        console.log(`     Files: ${item.files.join(', ')}`);
        console.log(`     Fix: ${item.fix}\n`);
    });

    // 6. Error Handling
    console.log('\n⚠️  MISSING ERROR HANDLING\n');
    ERROR_HANDLING_GAPS.forEach((gap, i) => {
        console.log(`  ${i + 1}. ${gap.file}`);
        console.log(`     Issue: ${gap.issue}`);
        console.log(`     Fix: ${gap.fix}\n`);
    });

    // Summary
    console.log('═'.repeat(70));
    console.log('  SUMMARY');
    console.log('═'.repeat(70));
    console.log(`  Auth Issues:        ${AUTH_ISSUES.length}`);
    console.log(`  Event Binding:      ${EVENT_BINDING_ISSUES.length}`);
    console.log(`  Dead Code Files:    ${DEAD_CODE.length}`);
    console.log(`  Security TODOs:     ${SECURITY_TODOS.length}`);
    console.log(`  Hardcoded Strings:  ${HARDCODED_STRINGS.length} patterns`);
    console.log(`  Error Handling:     ${ERROR_HANDLING_GAPS.length}`);
    console.log('═'.repeat(70));

    const criticalCount = SECURITY_TODOS.filter(t => t.priority === 'CRITICAL').length;
    const highCount = SECURITY_TODOS.filter(t => t.priority === 'HIGH').length 
                    + AUTH_ISSUES.filter(i => i.severity === 'HIGH').length;

    if (criticalCount > 0) {
        console.log(`\n  ⛔ ${criticalCount} CRITICAL issue(s) require immediate attention!`);
    }
    if (highCount > 0) {
        console.log(`  ⚠️  ${highCount} HIGH priority issue(s) should be addressed soon.`);
    }

    console.log('\n');
}

// Export for programmatic use
module.exports = {
    AUTH_ISSUES,
    EVENT_BINDING_ISSUES,
    DEAD_CODE,
    SECURITY_TODOS,
    HARDCODED_STRINGS,
    ERROR_HANDLING_GAPS,
    runAudit
};

// Run if executed directly
if (require.main === module) {
    runAudit();
}
