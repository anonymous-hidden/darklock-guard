const fs = require('fs');
const path = require('path');
const TPS = require('./file-protection');

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║     TAMPER PROTECTION - ATTACK SIMULATION SUITE             ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Test files for each tier
const TEST_TARGETS = {
    critical: {
        file: path.join(__dirname, 'config.json'),
        description: 'Critical file - Should trigger immediate shutdown'
    },
    high: {
        file: path.join(__dirname, 'src', 'utils', 'logger.js'),
        description: 'High priority - Should trigger alert & backup restoration'
    },
    medium: {
        file: path.join(__dirname, 'src', 'commands', 'admin', 'admin.js'),
        description: 'Medium priority - Should log warning'
    }
};

// Backup storage
const backups = new Map();

function backupFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File doesn't exist: ${filePath}`);
        return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    backups.set(filePath, content);
    console.log(`✓ Backed up: ${path.basename(filePath)}`);
    return content;
}

function restoreFile(filePath) {
    if (backups.has(filePath)) {
        fs.writeFileSync(filePath, backups.get(filePath), 'utf8');
        console.log(`✓ Restored: ${path.basename(filePath)}`);
        return true;
    }
    return false;
}

function tamperFile(filePath, testName) {
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const tamperedContent = content + '\n// TAMPER TEST: ' + testName + ' - ' + new Date().toISOString();
    fs.writeFileSync(filePath, tamperedContent, 'utf8');
    return true;
}

async function runTest(tier, target) {
    console.log(`\n${'='.repeat(65)}`);
    console.log(`🔴 TEST ${tier.toUpperCase()}: ${target.description}`);
    console.log(`${'='.repeat(65)}`);
    console.log(`Target: ${path.basename(target.file)}`);
    
    // Backup original
    const backup = backupFile(target.file);
    if (!backup) {
        console.log('❌ Cannot proceed - backup failed\n');
        return;
    }

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 500));

    // Execute tampering
    console.log('\n🔨 Tampering with file...');
    if (!tamperFile(target.file, `${tier}-tier-test`)) {
        console.log('❌ Tampering failed\n');
        restoreFile(target.file);
        return;
    }
    console.log('✓ File modified (attack simulated)');

    // Give time for detection
    console.log('⏱️  Waiting for tamper detection (5 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Restore immediately
    console.log('\n🔧 Restoring original file...');
    restoreFile(target.file);
    
    console.log('\n📊 Expected Response:');
    if (tier === 'critical') {
        console.log('   ⚠️  CRITICAL: System should shutdown/restart');
        console.log('   ⚠️  Alert sent to owner');
        console.log('   ⚠️  File should be auto-restored from backup');
    } else if (tier === 'high') {
        console.log('   ⚠️  HIGH: Alert sent + backup restored');
        console.log('   ⚠️  Logged to security logs');
    } else {
        console.log('   ℹ️  MEDIUM: Warning logged');
        console.log('   ℹ️  Notification generated');
    }

    console.log('\n✓ Test complete - File restored');
}

async function testValidation() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     TEST 1: BASELINE VALIDATION                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const tps = new TPS();
    
    console.log('Building protected file set...');
    tps.buildProtectedSet();
    console.log(`✓ Monitoring ${tps.protectedFiles.length} files`);

    console.log('\nLoading baseline...');
    try {
        tps.loadBaseline();
        console.log('✓ Baseline loaded successfully');
    } catch (err) {
        console.log('❌ Baseline load failed:', err.message);
        return false;
    }

    console.log('\nRunning integrity validation...');
    const issues = tps.validator.validateAll();
    
    if (issues.length === 0) {
        console.log('✅ ALL FILES VERIFIED - No tampering detected');
    } else {
        console.log(`⚠️  TAMPERING DETECTED: ${issues.length} issues found`);
        issues.slice(0, 5).forEach(issue => {
            console.log(`   - ${path.basename(issue.filePath)}: ${issue.error}`);
        });
    }

    return issues.length === 0;
}

async function testFileMonitoring() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     TEST 2: REAL-TIME FILE MONITORING                        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log('⚠️  WARNING: This test will start the file watcher.');
    console.log('⚠️  Press Ctrl+C to stop after observing the tests.\n');

    const tps = new TPS();
    await tps.initialize();
    
    console.log('✓ Tamper protection initialized');
    console.log('✓ Starting file watcher...\n');

    await tps.startWatcher();
    console.log('✅ File watcher is now active and monitoring changes\n');

    console.log('You can now run the attack tests in another terminal:\n');
    console.log('  node test-tamper-attack.js attack\n');
}

// Main execution
async function main() {
    const arg = process.argv[2];

    if (arg === 'monitor') {
        // Start monitoring mode
        await testFileMonitoring();
        return;
    }

    if (arg === 'attack') {
        console.log('⚠️  ATTACK MODE: Testing tamper detection\n');
        console.log('Make sure monitoring is running in another terminal first!\n');
        
        // Run attack tests
        await runTest('medium', TEST_TARGETS.medium);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await runTest('high', TEST_TARGETS.high);
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\n⚠️  CRITICAL TEST SKIPPED');
        console.log('Critical tier test would shutdown the system.');
        console.log('To test critical tier, manually modify a critical file like config.json');
        console.log('and observe the system response.\n');

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('Check file-protection/logs/ for detection logs');
        console.log('═══════════════════════════════════════════════════════════════\n');
        process.exit(0);
    }

    // Default: Run validation only
    console.log('Running baseline validation test...\n');
    const isValid = await testValidation();

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     HOW TO RUN FULL ATTACK TESTS                             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log('1. Terminal 1 - Start monitoring:');
    console.log('   node test-tamper-attack.js monitor\n');
    console.log('2. Terminal 2 - Run attacks:');
    console.log('   node test-tamper-attack.js attack\n');
    console.log('3. Watch for detection logs and alerts\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
