#!/usr/bin/env node
/**
 * MANUAL TAMPER TEST - Simple script to test tamper protection
 * This script safely modifies a file, waits, then restores it
 */

const fs = require('fs');
const path = require('path');

const TEST_FILE = path.join(__dirname, 'src', 'commands', 'admin', 'admin.js');
const BACKUP_FILE = TEST_FILE + '.backup-tamper-test';

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║           MANUAL TAMPER TEST                                 ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

async function runTest() {
    // Check if file exists
    if (!fs.existsSync(TEST_FILE)) {
        console.error('❌ Test file not found:', TEST_FILE);
        process.exit(1);
    }

    console.log('📁 Target File:', path.basename(TEST_FILE));
    console.log('🔒 Tier Level: MEDIUM\n');

    // Backup
    console.log('[1/5] Creating backup...');
    const originalContent = fs.readFileSync(TEST_FILE, 'utf8');
    fs.writeFileSync(BACKUP_FILE, originalContent, 'utf8');
    console.log('✓ Backup created\n');

    // Modify file (simulate attack)
    console.log('[2/5] Simulating attack - modifying file...');
    const tamperedContent = originalContent + '\n// TAMPERED: ' + new Date().toISOString() + '\n';
    fs.writeFileSync(TEST_FILE, tamperedContent, 'utf8');
    console.log('✓ File modified (attack simulated)\n');

    // Wait for detection
    console.log('[3/5] Waiting for tamper detection...');
    const waitSeconds = 8;
    for (let i = waitSeconds; i > 0; i--) {
        process.stdout.write(`⏱️  ${i} seconds remaining...\r`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('✓ Wait complete                    \n');

    // Check logs
    console.log('[4/5] Checking for detection logs...');
    const logsDir = path.join(__dirname, 'file-protection', 'logs');
    if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir)
            .filter(f => f.endsWith('.log'))
            .sort()
            .reverse()
            .slice(0, 1);
        
        if (logFiles.length > 0) {
            const logPath = path.join(logsDir, logFiles[0]);
            const logContent = fs.readFileSync(logPath, 'utf8');
            const recentLines = logContent.split('\n').slice(-10).filter(l => l.trim());
            
            console.log('📄 Recent log entries:');
            recentLines.forEach(line => {
                if (line.includes('admin.js') || line.includes('tamper') || line.includes('integrity')) {
                    console.log('   ' + line.substring(0, 100));
                }
            });
        } else {
            console.log('⚠️  No log files found');
        }
    } else {
        console.log('⚠️  Logs directory not found');
    }
    console.log();

    // Restore
    console.log('[5/5] Restoring original file...');
    fs.writeFileSync(TEST_FILE, originalContent, 'utf8');
    fs.unlinkSync(BACKUP_FILE);
    console.log('✓ File restored\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n📊 What to check:');
    console.log('   1. Check file-protection/logs/ for tamper detection');
    console.log('   2. Check if backup was created in file-protection/backups/');
    console.log('   3. Check console output for security warnings');
    console.log('   4. If bot is running, check Discord for alerts\n');
}

runTest().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    
    // Try to restore backup
    if (fs.existsSync(BACKUP_FILE)) {
        console.log('🔧 Attempting to restore from backup...');
        try {
            fs.copyFileSync(BACKUP_FILE, TEST_FILE);
            fs.unlinkSync(BACKUP_FILE);
            console.log('✓ Restored successfully\n');
        } catch (restoreErr) {
            console.error('❌ Restore failed:', restoreErr.message);
            console.error('⚠️  Manual restore needed from:', BACKUP_FILE, '\n');
        }
    }
    
    process.exit(1);
});
