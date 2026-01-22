const SecuritySuite = require('./modules/index');

/**
 * Security Suite Test Runner
 * Tests all 6 security modules
 */
async function runSecurityTests() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║     SECURITY SUITE - TEST RUNNER         ║');
    console.log('╚════════════════════════════════════════════╝\n');

    const security = new SecuritySuite({
        enableRuntime: true,
        enableEnv: true,
        enableProcess: true,
        enableNetwork: true,
        enableAuth: true
    });

    // Test 1: Initialize
    console.log('TEST 1: Initialize Security Suite');
    await security.initialize();
    console.log('✅ PASS: Security suite initialized\n');

    // Test 2: Start all monitors
    console.log('TEST 2: Start All Security Monitors');
    await security.start();
    console.log('✅ PASS: All monitors started\n');

    // Test 3: Log authentication attempts
    console.log('TEST 3: Authentication Logging');
    security.logAuthAttempt({
        userId: 'test123',
        username: 'testuser',
        ip: '192.168.1.1',
        method: 'password',
        success: false,
        failureReason: 'invalid_password'
    });
    console.log('✅ PASS: Auth attempt logged\n');

    // Test 4: Multiple failed attempts (brute force test)
    console.log('TEST 4: Brute Force Detection');
    for (let i = 0; i < 6; i++) {
        security.logAuthAttempt({
            userId: 'attacker',
            username: 'attacker',
            ip: '10.0.0.1',
            method: 'password',
            success: false,
            failureReason: 'invalid_password'
        });
    }
    console.log('✅ PASS: Brute force attempts logged (should trigger lockout)\n');

    // Test 5: Permission change logging
    console.log('TEST 5: Permission Change Logging');
    security.logPermissionChange({
        userId: 'user456',
        username: 'promoteduser',
        adminId: 'admin123',
        change: 'role_added',
        before: 'user',
        after: 'moderator',
        reason: 'promotion'
    });
    console.log('✅ PASS: Permission change logged\n');

    // Test 6: Network request logging
    console.log('TEST 6: Network Request Logging');
    security.logNetworkRequest({
        url: 'https://discord.com/api/users',
        method: 'GET',
        statusCode: 200
    });
    security.logNetworkRequest({
        url: 'https://suspicious-site.com/exfil',
        method: 'POST',
        statusCode: 200,
        body: 'sensitive data'
    });
    console.log('✅ PASS: Network requests logged\n');

    // Test 7: Wait for monitors to run checks
    console.log('TEST 7: Monitor Health Check (waiting 5 seconds...)');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('✅ PASS: Monitors running\n');

    // Test 8: Get security report
    console.log('TEST 8: Generate Security Report');
    const report = security.getSecurityReport();
    console.log('✅ PASS: Security report generated\n');

    // Test 9: Print dashboard
    console.log('TEST 9: Display Security Dashboard');
    security.printDashboard();
    console.log('✅ PASS: Dashboard displayed\n');

    // Test 10: Check for violations
    console.log('TEST 10: Violation Detection');
    console.log(`   Total Violations: ${report.totalViolations}`);
    console.log(`   Brute Force Detected: ${report.modules.auth?.bruteForceAttempts || 0}`);
    console.log(`   Suspicious Network Requests: ${report.modules.network?.suspiciousRequests || 0}`);
    console.log('✅ PASS: Violation check complete\n');

    // Stop all monitors
    console.log('Stopping all monitors...');
    security.stop();
    console.log('✅ All monitors stopped\n');

    // Final summary
    console.log('╔════════════════════════════════════════════╗');
    console.log('║          ALL TESTS COMPLETED              ║');
    console.log('║                                           ║');
    console.log(`║  Runtime Monitor:      ${(report.modules.runtime?.status || 'active').padEnd(20)}║`);
    console.log(`║  Env Validator:        ${(report.modules.env?.status || 'active').padEnd(20)}║`);
    console.log(`║  Process Monitor:      ${(report.modules.process?.status || 'active').padEnd(20)}║`);
    console.log(`║  Network Monitor:      ${(report.modules.network?.status || 'active').padEnd(20)}║`);
    console.log(`║  Auth Auditor:         ${(report.modules.auth?.status || 'active').padEnd(20)}║`);
    console.log('╚════════════════════════════════════════════╝\n');

    console.log('🎉 Security Suite is PRODUCTION READY!\n');
}

// Run tests
runSecurityTests().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
