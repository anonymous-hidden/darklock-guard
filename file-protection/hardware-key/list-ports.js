#!/usr/bin/env node

const { SerialPort } = require('serialport');

/**
 * List all available serial ports
 * Use this to identify your Raspberry Pi Pico
 */

async function listPorts() {
    console.log('🔍 Scanning for serial ports...\n');
    
    try {
        const ports = await SerialPort.list();
        
        if (ports.length === 0) {
            console.log('❌ No serial ports found');
            console.log('\nTroubleshooting:');
            console.log('  1. Make sure your Raspberry Pi Pico is plugged in');
            console.log('  2. Check if drivers are installed');
            console.log('  3. Try a different USB port');
            return;
        }
        
        console.log(`✅ Found ${ports.length} serial port(s):\n`);
        
        ports.forEach((port, index) => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Port ${index + 1}:`);
            console.log(`  Path:          ${port.path}`);
            console.log(`  Manufacturer:  ${port.manufacturer || 'N/A'}`);
            console.log(`  Serial Number: ${port.serialNumber || 'N/A'}`);
            console.log(`  Vendor ID:     ${port.vendorId || 'N/A'}`);
            console.log(`  Product ID:    ${port.productId || 'N/A'}`);
            console.log(`  PnP ID:        ${port.pnpId || 'N/A'}`);
            console.log(`  Location ID:   ${port.locationId || 'N/A'}`);
            
            // Check if this looks like a Pico
            const isPico = 
                (port.vendorId?.toLowerCase() === '2e8a') ||
                (port.manufacturer?.toLowerCase().includes('raspberry')) ||
                (port.manufacturer?.toLowerCase().includes('micropython'));
            
            if (isPico) {
                console.log(`  🎯 This appears to be a Raspberry Pi Pico!`);
            }
        });
        
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        // Find Pico
        const pico = ports.find(p => 
            p.vendorId?.toLowerCase() === '2e8a' ||
            p.manufacturer?.toLowerCase().includes('raspberry')
        );
        
        if (pico) {
            console.log('💡 Raspberry Pi Pico detected!');
            console.log('   You can use this configuration in start-protection.js:');
            console.log(`   customIdentifier: '${pico.serialNumber || pico.path}'`);
        } else {
            console.log('ℹ️  No Raspberry Pi Pico detected');
            console.log('   Expected Vendor ID: 2e8a (Raspberry Pi)');
            console.log('\n   If your Pico is connected but not detected:');
            console.log('   1. Make sure it\'s in the correct mode (not bootloader)');
            console.log('   2. Install the Pico USB drivers');
            console.log('   3. Try uploading a simple CircuitPython/MicroPython script first');
        }
        
    } catch (error) {
        console.error('❌ Error listing ports:', error.message);
        console.error('\nPossible solutions:');
        console.error('  1. Run: npm install serialport');
        console.error('  2. Check if you have permissions to access USB devices');
        console.error('  3. On Linux: Add your user to the dialout group');
    }
}

listPorts();
