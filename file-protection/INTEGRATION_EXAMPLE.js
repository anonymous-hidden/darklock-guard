/**
 * EXAMPLE: Integrate Tamper Protection with Your Discord Bot
 * 
 * Add this code to your src/bot.js file
 */

const TamperProtectionSystem = require('./file-protection');

// Initialize tamper protection system
const tamperProtection = new TamperProtectionSystem({
    logger: console // Replace with your bot's logger if available
});

// Start protection before bot initialization
async function startBotWithProtection() {
    try {
        console.log('🔒 Starting File Tamper Protection System...\n');
        
        // Initialize and start tamper protection
        const started = await tamperProtection.start();
        
        if (!started) {
            console.error('❌ Failed to start tamper protection');
            // Decide: continue without protection or exit
            // process.exit(1); // Uncomment to require protection
        }

        // Print protection status
        tamperProtection.printStatus();

        // Now start your Discord bot as normal
        // ... your existing bot code ...
        
        console.log('🤖 Starting Discord bot...\n');
        
        // Your existing bot login
        // await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    
    // Stop tamper protection
    await tamperProtection.stop();
    
    // Stop your bot
    // await client.destroy();
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    await tamperProtection.stop();
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await tamperProtection.stop();
    process.exit(1);
});

// Start everything
startBotWithProtection();

// ============================================
// OPTIONAL: Manual Controls During Runtime
// ============================================

// Pause protection (during legitimate updates)
// tamperProtection.pause();

// Resume protection
// tamperProtection.resume();

// Get current status
// const status = tamperProtection.getStatus();
// console.log(status);

// Check if specific file is protected
// const isProtected = tamperProtection.validator.isProtected('path/to/file.js');

// Manually validate all files
// const issues = tamperProtection.validator.validateAll();
// if (issues.length > 0) {
//     console.error('Integrity issues found:', issues);
// }
