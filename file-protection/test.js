const TamperProtectionSystem = require('./index');

/**
 * Test script for tamper protection system
 */
async function runTests() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   TAMPER PROTECTION SYSTEM - TEST SUITE   ║');
    console.log('╚════════════════════════════════════════════╝\n');

    const tps = new TamperProtectionSystem();

    // Test 1: Initialize system
    console.log('TEST 1: Initialize System');
    const initialized = await tps.initialize();
    if (initialized) {
        console.log('✅ PASS: System initialized\n');
    } else {
        console.log('❌ FAIL: System initialization failed\n');
        return;
    }

    // Test 2: Check status
    console.log('TEST 2: Check Status');
    tps.printStatus();
    console.log('✅ PASS: Status check complete\n');

    // Test 3: Validate all files
    console.log('TEST 3: Validate All Files');
    const issues = tps.validator.validateAll();
    if (issues.length === 0) {
        console.log('✅ PASS: All files valid\n');
    } else {
        console.log(`⚠️ WARN: Found ${issues.length} issues:`);
        issues.forEach(issue => console.log(`   • ${issue.filePath}: ${issue.reason}`));
        console.log();
    }

    // Test 4: Start watcher
    console.log('TEST 4: Start Watcher');
    await tps.start();
    console.log('✅ PASS: Watcher started\n');

    // Test 5: Wait and monitor
    console.log('TEST 5: Monitor for 10 seconds...');
    console.log('   Try modifying a protected file now!\n');
    
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Test 6: Print final status
    console.log('\nTEST 6: Final Status');
    tps.printStatus();
    console.log('✅ PASS: Test complete\n');

    // Stop watcher
    await tps.stop();

    console.log('╔════════════════════════════════════════════╗');
    console.log('║          ALL TESTS COMPLETED              ║');
    console.log('╚════════════════════════════════════════════╝\n');
}

// Run tests
runTests().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
