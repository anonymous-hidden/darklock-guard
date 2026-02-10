#!/usr/bin/env node
/**
 * Test RFID client from bot's perspective
 */
const rfid = require('./rfid_client');

async function test() {
    console.log('Testing RFID client integration...\n');
    
    // Test 1: Get status
    console.log('1. Testing status query...');
    try {
        const status = await rfid.getStatus();
        console.log('   ✓ Status:', JSON.stringify(status, null, 2));
    } catch (err) {
        console.error('   ✗ Status failed:', err.message);
    }
    
    // Test 2: Scan for shutdown (requires card)
    console.log('\n2. Testing shutdown authorization (scan your card now)...');
    try {
        const result = await rfid.scanShutdown();
        if (result.allowed) {
            console.log('   ✓ Authorization granted!');
            console.log('     User:', result.user);
            console.log('     Expires:', new Date(result.expires * 1000).toISOString());
        } else {
            console.log('   ✗ Authorization denied:', result.reason);
        }
    } catch (err) {
        console.error('   ✗ Scan failed:', err.message);
    }
    
    console.log('\nTest complete!');
    process.exit(0);
}

test();
