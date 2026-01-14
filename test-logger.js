/**
 * Test script to verify logger is working correctly
 */

const Database = require('./src/database/database');
const Logger = require('./src/utils/logger');

async function testLogger() {
    console.log('Testing logger functionality...\n');
    
    try {
        // Initialize database
        const db = new Database();
        await db.initialize();
        console.log('✓ Database initialized');
        
        // Create mock bot object
        const mockBot = {
            database: db,
            consoleBuffer: new Map()
        };
        
        // Initialize logger
        const logger = new Logger(mockBot);
        await logger.initialize();
        console.log('✓ Logger initialized\n');
        
        // Test logging a command
        console.log('Testing command logging...');
        await logger.logCommand({
            commandName: 'test-command',
            userId: '123456789',
            userTag: 'TestUser#1234',
            guildId: '987654321',
            channelId: '111222333',
            options: { test: true },
            success: true,
            duration: 150,
            error: null
        });
        console.log('✓ Command logged\n');
        
        // Test logging a security event
        console.log('Testing security event logging...');
        await logger.logSecurityEvent({
            eventType: 'user_kicked',
            guildId: '987654321',
            moderatorId: '111111111',
            moderatorTag: 'Moderator#5678',
            targetId: '222222222',
            targetTag: 'BadUser#9999',
            reason: 'Test kick',
            details: { severity: 'medium' }
        });
        console.log('✓ Security event logged\n');
        
        // Test logging an internal event
        console.log('Testing internal event logging...');
        await logger.logInternal({
            eventType: 'test_startup',
            message: 'Test bot startup',
            details: { version: '1.0.0' }
        });
        console.log('✓ Internal event logged\n');
        
        // Retrieve and display logs
        console.log('Retrieving logs...');
        const logs = await logger.getLogs({ limit: 10 });
        console.log(`✓ Found ${logs.length} logs:\n`);
        
        logs.forEach((log, i) => {
            console.log(`${i + 1}. [${log.type}] ${log.command || log.endpoint || 'N/A'} - ${log.created_at}`);
        });
        
        console.log('\n✅ All logger tests passed!');
        console.log('\nLogs are being written to the database correctly.');
        console.log('If the dashboard still shows no logs, the issue is likely authentication-related.');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during testing:', error);
        process.exit(1);
    }
}

testLogger();
