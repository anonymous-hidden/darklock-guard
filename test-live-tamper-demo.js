#!/usr/bin/env node
/**
 * LIVE TAMPER DEMO - Shows real-time detection
 * Run this while the bot is running to see live detection
 */

const fs = require('fs');
const path = require('path');

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║     LIVE TAMPER DETECTION DEMO                               ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Test with a medium-tier file (safest)
const TEST_FILE = path.join(__dirname, 'README.md');
const BACKUP_FILE = TEST_FILE + '.backup-live-test';

async function watchLogs(duration = 10000) {
    const logsDir = path.join(__dirname, 'file-protection', 'logs');
    if (!fs.existsSync(logsDir)) {
        console.log('⚠️  Logs directory not found - file protection may not be running');
        return;
    }

    const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.log')).sort().reverse();
    if (logFiles.length === 0) {
        console.log('⚠️  No log files found');
        return;
    }

    const logFile = path.join(logsDir, logFiles[0]);
    const initialSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    
    console.log(`📊 Monitoring log file: ${logFiles[0]}`);
    console.log(`   Initial size: ${initialSize} bytes\n`);

    const startTime = Date.now();
    let lastSize = initialSize;

    while (Date.now() - startTime < duration) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (fs.existsSync(logFile)) {
            const currentSize = fs.statSync(logFile).size;
            if (currentSize > lastSize) {
                const content = fs.readFileSync(logFile, 'utf8');
                const lines = content.split('\n');
                const newLines = lines.slice(-(Math.ceil((currentSize - lastSize) / 50)));
                
                console.log('🔔 NEW LOG ENTRY:');
                newLines.forEach(line => {
                    if (line.trim()) {
                        console.log('   ' + line);
                    }
                });
                console.log();
                lastSize = currentSize;
            }
        }
    }
}

async function runDemo() {
    console.log('⚠️  IMPORTANT: This test is designed to run while the bot is running\n');
    console.log('If the bot is not running, start it first with: npm start\n');
    
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise(resolve => {
        readline.question('Is the bot currently running? (y/n): ', resolve);
    });
    readline.close();

    if (answer.toLowerCase() !== 'y') {
        console.log('\n⚠️  Please start the bot first, then run this test again.\n');
        process.exit(0);
    }

    console.log('\n[1/4] Creating backup...');
    if (!fs.existsSync(TEST_FILE)) {
        console.log('❌ README.md not found');
        process.exit(1);
    }
    const original = fs.readFileSync(TEST_FILE, 'utf8');
    fs.writeFileSync(BACKUP_FILE, original, 'utf8');
    console.log('✓ Backup created\n');

    console.log('[2/4] Modifying file (simulated attack)...');
    fs.writeFileSync(TEST_FILE, original + '\n<!-- TAMPER TEST: ' + Date.now() + ' -->\n', 'utf8');
    console.log('✓ File tampered\n');

    console.log('[3/4] Watching for detection (10 seconds)...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    await watchLogs(10000);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('[4/4] Restoring original file...');
    fs.writeFileSync(TEST_FILE, original, 'utf8');
    fs.unlinkSync(BACKUP_FILE);
    console.log('✓ File restored\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ DEMO COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Check the bot console output for real-time detection messages!\n');
}

runDemo().catch(err => {
    console.error('❌ Error:', err.message);
    if (fs.existsSync(BACKUP_FILE)) {
        const original = fs.readFileSync(BACKUP_FILE, 'utf8');
        fs.writeFileSync(TEST_FILE, original, 'utf8');
        fs.unlinkSync(BACKUP_FILE);
        console.log('✓ Restored from backup\n');
    }
    process.exit(1);
});
