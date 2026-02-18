#!/usr/bin/env node
/**
 * DESTRUCTIVE TAMPER TEST - REAL FILE DAMAGE
 * 
 * ⚠️  WARNING: This will ACTUALLY damage files!
 * ⚠️  This will trigger REAL shutdown for critical files!
 * ⚠️  DO NOT RUN ON PRODUCTION SYSTEMS!
 * 
 * This test proves the tamper protection works by:
 * - Actually modifying protected files
 * - Triggering real detection
 * - Causing real system responses (including shutdown)
 * - Testing actual restoration mechanisms
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║     ⚠️  DESTRUCTIVE TAMPER TEST - REAL FILE DAMAGE  ⚠️      ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const TESTS = {
    high: {
        file: path.join(__dirname, 'src', 'utils', 'logger.js'),
        tier: 'HIGH',
        risk: 'MODERATE - Will trigger alert and auto-restore',
        backup: null
    },
    critical: {
        file: path.join(__dirname, 'config.json'),
        tier: 'CRITICAL',
        risk: '🚨 EXTREME - WILL SHUTDOWN THE SYSTEM! 🚨',
        backup: null
    }
};

function createBackup(testName) {
    const test = TESTS[testName];
    if (!fs.existsSync(test.file)) {
        console.error(`❌ File not found: ${test.file}`);
        return false;
    }
    
    test.backup = test.file + '.EMERGENCY_BACKUP_' + Date.now();
    fs.copyFileSync(test.file, test.backup);
    console.log(`✓ Emergency backup created: ${path.basename(test.backup)}`);
    return true;
}

function damageFile(testName) {
    const test = TESTS[testName];
    const content = fs.readFileSync(test.file, 'utf8');
    
    // REAL DAMAGE - Corrupt the file with invalid content
    const damaged = content + '\n\n// ===== REAL TAMPERING ATTACK =====\n' +
                   '// This is actual file corruption!\n' +
                   '// Timestamp: ' + new Date().toISOString() + '\n' +
                   '// Attacker: Destructive Test Suite\n' +
                   'console.log("SYSTEM COMPROMISED");\n' +
                   '// ===== END ATTACK =====\n';
    
    fs.writeFileSync(test.file, damaged, 'utf8');
    console.log(`💥 FILE ACTUALLY DAMAGED: ${path.basename(test.file)}`);
    console.log(`   Added ${damaged.length - content.length} bytes of malicious code`);
    return true;
}

function restoreFromBackup(testName) {
    const test = TESTS[testName];
    if (!test.backup || !fs.existsSync(test.backup)) {
        console.error('❌ No backup found! Manual restore required!');
        return false;
    }
    
    fs.copyFileSync(test.backup, test.file);
    fs.unlinkSync(test.backup);
    console.log(`✓ Restored from emergency backup`);
    return true;
}

async function runHighTierTest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     TEST 1: HIGH TIER FILE - REAL DAMAGE                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    console.log('Target: src/utils/logger.js');
    console.log('Tier: HIGH');
    console.log('Expected Response:');
    console.log('  🔔 Alert notification');
    console.log('  🔄 Automatic file restoration');
    console.log('  📝 Security log entry');
    console.log('  ⏱️  Detection time: < 5 seconds\n');
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const answer = await new Promise(resolve => {
        rl.question('Proceed with REAL file damage? (type YES in capitals): ', resolve);
    });
    rl.close();
    
    if (answer !== 'YES') {
        console.log('\n❌ Test cancelled\n');
        return false;
    }
    
    console.log('\n[1/5] Creating emergency backup...');
    if (!createBackup('high')) return false;
    
    console.log('\n[2/5] DAMAGING FILE NOW...');
    damageFile('high');
    
    console.log('\n[3/5] Waiting for tamper detection...');
    console.log('⏱️  The system should detect this within 5 seconds...\n');
    
    for (let i = 15; i > 0; i--) {
        process.stdout.write(`   Waiting ${i} seconds for detection... Check logs and console!\r`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');
    
    console.log('[4/5] Checking logs...');
    const logsDir = path.join(__dirname, 'file-protection', 'logs');
    if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.log')).sort().reverse();
        if (logFiles.length > 0) {
            const logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
            const recentLines = logContent.split('\n').slice(-15);
            console.log('\n📄 Recent log entries:');
            recentLines.forEach(line => {
                if (line.trim() && (line.includes('logger') || line.includes('tamper') || line.includes('TAMPER'))) {
                    console.log('   ' + line);
                }
            });
        }
    }
    
    console.log('\n[5/5] Restoring from emergency backup...');
    restoreFromBackup('high');
    
    console.log('\n✅ HIGH TIER TEST COMPLETE\n');
    return true;
}

async function runCriticalTierTest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     ⚠️  TEST 2: CRITICAL TIER - SYSTEM SHUTDOWN TEST  ⚠️    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    console.log('🚨🚨🚨 EXTREME WARNING 🚨🚨🚨\n');
    console.log('Target: config.json');
    console.log('Tier: CRITICAL');
    console.log('Expected Response:');
    console.log('  🚨 IMMEDIATE SYSTEM SHUTDOWN');
    console.log('  🔄 Automatic file restoration');
    console.log('  📧 Alert to owner');
    console.log('  ⏱️  Detection time: < 1 second');
    console.log('  💀 BOT WILL CRASH/RESTART!\n');
    
    console.log('This test will:');
    console.log('  1. Damage config.json (core configuration file)');
    console.log('  2. Trigger immediate system shutdown');
    console.log('  3. Bot will stop running');
    console.log('  4. You will need to manually restart\n');
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const answer1 = await new Promise(resolve => {
        rl.question('Do you understand the bot will SHUTDOWN? (type YES): ', resolve);
    });
    
    if (answer1 !== 'YES') {
        rl.close();
        console.log('\n❌ Test cancelled\n');
        return false;
    }
    
    const answer2 = await new Promise(resolve => {
        rl.question('Type "SHUTDOWN" to confirm you want to crash the system: ', resolve);
    });
    rl.close();
    
    if (answer2 !== 'SHUTDOWN') {
        console.log('\n❌ Test cancelled\n');
        return false;
    }
    
    console.log('\n[1/4] Creating emergency backup...');
    if (!createBackup('critical')) return false;
    
    console.log('\n[2/4] DAMAGING CRITICAL FILE NOW...');
    console.log('🚨 THIS WILL TRIGGER IMMEDIATE SHUTDOWN! 🚨\n');
    damageFile('critical');
    
    console.log('[3/4] File damaged. Detection should be IMMEDIATE...');
    console.log('⏱️  System should shutdown in < 1 second...\n');
    
    // Wait a moment to see if system shuts down
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('🤔 If you\'re still seeing this, either:');
    console.log('   a) Bot is not running (start it to see shutdown)');
    console.log('   b) Tamper protection is not initialized');
    console.log('   c) Detection hasn\'t triggered yet (wait longer)\n');
    
    console.log('[4/4] Restoring from emergency backup...');
    restoreFromBackup('critical');
    
    console.log('\n✅ CRITICAL TIER TEST COMPLETE');
    console.log('⚠️  If bot is running, it should have shutdown!\n');
    return true;
}

async function runDatabaseTest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     TEST 3: DATABASE FILE - REAL CORRUPTION                  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const dbFile = path.join(__dirname, 'darklock', 'data', 'darklock.db');
    
    if (!fs.existsSync(dbFile)) {
        console.log('⚠️  Database file not found, skipping this test\n');
        return false;
    }
    
    console.log('Target: darklock/data/darklock.db');
    console.log('Tier: CRITICAL');
    console.log('Risk: WILL SHUTDOWN SYSTEM + Corrupt database\n');
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
        rl.question('Corrupt the database file? (type YES): ', resolve);
    });
    rl.close();
    
    if (answer !== 'YES') {
        console.log('\n❌ Test cancelled\n');
        return false;
    }
    
    console.log('\n[1/4] Creating emergency backup...');
    const backupFile = dbFile + '.EMERGENCY_BACKUP_' + Date.now();
    fs.copyFileSync(dbFile, backupFile);
    console.log(`✓ Backup: ${path.basename(backupFile)}`);
    
    console.log('\n[2/4] CORRUPTING DATABASE...');
    const dbContent = fs.readFileSync(dbFile);
    // Append garbage data to corrupt the SQLite database
    const corrupted = Buffer.concat([dbContent, Buffer.from('\n\nCORRUPTED_BY_TEST\n')]);
    fs.writeFileSync(dbFile, corrupted);
    console.log('💥 Database file corrupted!');
    
    console.log('\n[3/4] Waiting for detection (15 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    console.log('\n[4/4] Restoring database...');
    fs.copyFileSync(backupFile, dbFile);
    fs.unlinkSync(backupFile);
    console.log('✓ Database restored\n');
    
    return true;
}

async function showManualTest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     MANUAL DESTRUCTIVE TEST INSTRUCTIONS                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    console.log('For maximum confidence, do this MANUALLY:\n');
    
    console.log('1. Start the bot in one terminal:');
    console.log('   npm start\n');
    
    console.log('2. While bot is running, open another terminal and run:');
    console.log('   Copy-Item config.json config.json.backup');
    console.log('   Add-Content config.json "TAMPERED"\n');
    
    console.log('3. Watch the bot terminal - you should see:');
    console.log('   🚨 [CRITICAL] Tampering detected: config.json');
    console.log('   🚨 System shutdown initiated');
    console.log('   💀 Bot process exits\n');
    
    console.log('4. Restore the file:');
    console.log('   Move-Item config.json.backup config.json -Force\n');
    
    console.log('5. Restart the bot to verify it works\n');
}

async function main() {
    console.log('⚠️  REAL DESTRUCTIVE TESTING ⚠️\n');
    console.log('This suite will ACTUALLY damage files to prove tamper protection works.\n');
    console.log('Choose a test:\n');
    console.log('  1. HIGH tier test (logger.js) - Moderate risk');
    console.log('  2. CRITICAL tier test (config.json) - WILL SHUTDOWN SYSTEM');
    console.log('  3. DATABASE test (darklock.db) - WILL SHUTDOWN + Corrupt DB');
    console.log('  4. Show manual test instructions (safest way)');
    console.log('  5. Run ALL tests (maximum destruction)\n');
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const choice = await new Promise(resolve => {
        rl.question('Enter choice (1-5): ', resolve);
    });
    rl.close();
    
    console.log('\n');
    
    switch(choice) {
        case '1':
            await runHighTierTest();
            break;
        case '2':
            await runCriticalTierTest();
            break;
        case '3':
            await runDatabaseTest();
            break;
        case '4':
            await showManualTest();
            break;
        case '5':
            console.log('🚨 RUNNING ALL DESTRUCTIVE TESTS 🚨\n');
            await runHighTierTest();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await runDatabaseTest();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await runCriticalTierTest();
            break;
        default:
            console.log('Invalid choice\n');
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('Check file-protection/logs/ for detection logs');
    console.log('Check file-protection/backups/ for auto-created backups');
    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('\n❌ Error:', err.message);
    console.error('\n🆘 EMERGENCY RESTORE:');
    console.error('Find backups: Get-ChildItem . -Recurse -Filter "*.EMERGENCY_BACKUP_*"');
    console.error('Restore: Copy-Item backup_file original_file -Force\n');
    process.exit(1);
});
