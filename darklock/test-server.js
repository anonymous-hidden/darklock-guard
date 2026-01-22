/**
 * Test script to run Darklock Platform standalone
 */

const DarklockPlatform = require('./server');

// Create and start server
const darklock = new DarklockPlatform({ port: 3002 });

darklock.start()
    .then(() => {
        console.log('\n✅ Darklock Platform is running!');
        console.log('📍 Visit: http://localhost:3002/platform');
        console.log('\n🔐 To test Darklock Guard launch:');
        console.log('   1. Create an account at http://localhost:3002/platform/auth/signup');
        console.log('   2. Login at http://localhost:3002/platform/auth/login');
        console.log('   3. Go to http://localhost:3002/platform');
        console.log('   4. Click "Launch Desktop App" on Darklock Guard card');
        console.log('\n⚠️  Note: You must be logged in to launch Darklock Guard');
        console.log('\nPress Ctrl+C to stop the server\n');
    })
    .catch(err => {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    darklock.stop();
    process.exit(0);
});
