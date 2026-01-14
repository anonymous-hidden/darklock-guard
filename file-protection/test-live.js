const TamperProtectionSystem = require('./index');

/**
 * Live test - runs continuously until you press Ctrl+C
 */
async function startProtection() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   LIVE TAMPER PROTECTION TEST             ║');
    console.log('║   Press Ctrl+C to stop                    ║');
    console.log('╚════════════════════════════════════════════╝\n');

    const tps = new TamperProtectionSystem();

    // Initialize
    const initialized = await tps.initialize();
    if (!initialized) {
        console.log('❌ Failed to initialize. Run baseline generator first:');
        console.log('   node file-protection/agent/baseline-generator.js');
        process.exit(1);
    }

    // Start watching
    await tps.start();

    console.log('\n✅ Protection is now ACTIVE and monitoring files!');
    console.log('📝 Try modifying a protected file in another terminal:\n');
    console.log('   Add-Content -Path "config.json" -Value "`n// HACKED"\n');
    console.log('🔍 Watching for changes... (Press Ctrl+C to stop)\n');

    // Print status every 30 seconds
    setInterval(() => {
        tps.printStatus();
    }, 30000);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Stopping protection...');
        await tps.stop();
        process.exit(0);
    });
}

startProtection().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
