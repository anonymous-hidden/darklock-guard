#!/usr/bin/env node

const HardwareKeyProtection = require('./index');
const path = require('path');
const fs = require('fs');

/**
 * Test script for Hardware Key Protection System
 */

const logger = {
    info: (...args) => console.log(`[TEST]`, ...args),
    warn: (...args) => console.warn(`[TEST]`, ...args),
    error: (...args) => console.error(`[TEST]`, ...args)
};

async function runTests() {
    console.log('🧪 Hardware Key Protection System - Test Suite\n');
    
    const protection = new HardwareKeyProtection({
        projectRoot: path.join(__dirname, '..', '..'),
        logger,
        watchPaths: ['test-files/**/*'],
        ignorePaths: ['**/node_modules/**']
    });
    
    try {
        // Test 1: List available ports
        console.log('📋 Test 1: Listing available serial ports...');
        await protection.listPorts();
        console.log('');
        
        // Test 2: Check initial status
        console.log('📊 Test 2: Checking initial status...');
        const initialStatus = protection.getStatus();
        console.log('Detector connected:', initialStatus.detector.connected);
        console.log('');
        
        // Test 3: Start protection
        console.log('🚀 Test 3: Starting protection system...');
        await protection.start();
        console.log('Protection started successfully');
        console.log('');
        
        // Test 4: Create a test directory and file
        console.log('📝 Test 4: Creating test file...');
        const testDir = path.join(__dirname, '..', '..', 'test-files');
        const testFile = path.join(testDir, 'test.txt');
        
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        console.log('⏳ Waiting 3 seconds before creating test file...');
        await sleep(3000);
        
        const currentStatus = protection.getStatus();
        if (currentStatus.detector.connected) {
            console.log('✅ Hardware key is connected - file creation should be allowed');
        } else {
            console.log('⚠️  Hardware key is NOT connected - file creation should be blocked');
        }
        
        fs.writeFileSync(testFile, 'Test content: ' + Date.now());
        console.log('Test file created at:', testFile);
        console.log('');
        
        // Test 5: Wait and modify file
        console.log('✏️  Test 5: Modifying test file in 3 seconds...');
        await sleep(3000);
        
        fs.appendFileSync(testFile, '\nModified: ' + Date.now());
        console.log('Test file modified');
        console.log('');
        
        // Test 6: Show final status
        console.log('📊 Test 6: Final status...');
        protection.showStatus();
        console.log('');
        
        // Wait a bit for events to process
        await sleep(2000);
        
        // Test 7: Violation report
        const finalStatus = protection.getStatus();
        console.log('📈 Violation Report:');
        console.log(`   Total violations: ${finalStatus.fileGuard.violationCount}`);
        if (finalStatus.fileGuard.recentViolations.length > 0) {
            console.log('   Recent violations:');
            finalStatus.fileGuard.recentViolations.forEach(v => {
                console.log(`      - ${v.type}: ${v.path} (${v.timestamp})`);
            });
        }
        console.log('');
        
        // Cleanup
        console.log('🧹 Cleaning up test files...');
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
        if (fs.existsSync(testDir)) {
            fs.rmdirSync(testDir);
        }
        
        await protection.stop();
        console.log('');
        console.log('✅ All tests completed!');
        console.log('');
        console.log('📝 Instructions:');
        console.log('   1. Try disconnecting your Raspberry Pi Pico');
        console.log('   2. Run this test again - you should see violations');
        console.log('   3. Reconnect the Pico and try again');
        
    } catch (error) {
        logger.error('Test failed:', error);
        await protection.stop();
        process.exit(1);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run tests
runTests().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
