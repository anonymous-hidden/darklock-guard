/**
 * DARKLOCK INTEGRATION EXAMPLE
 * =============================
 * 
 * Shows how to integrate hardware security gate with:
 * 1) Discord bot lifecycle
 * 2) Express admin dashboard
 * 
 * This is a complete working example that can be adapted to your existing code.
 */

const express = require('express');
const { HardwareSecurityGate, requireHardwareKey, hardwareSecurityContext } = require('./services/hardware-security-gate');

// ============================================================================
// INITIALIZE HARDWARE SECURITY GATE
// ============================================================================

const securityGate = new HardwareSecurityGate({
  serialPort: process.env.HARDWARE_SERIAL_PORT || '/dev/ttyACM0',
  baudRate: 115200,
  failClosed: true,              // CRITICAL: Fail closed for security
  requireHardwareForBoot: true,  // Cannot start without hardware key
});

// ============================================================================
// DISCORD BOT INTEGRATION
// ============================================================================

let discordClient = null;
let botShutdownInProgress = false;

async function startDiscordBot() {
  console.log('[Bot] Starting Discord bot...');
  
  // SECURITY: Check hardware key before starting
  if (!securityGate.isKeyPresent()) {
    console.error('[Bot] SECURITY: Cannot start bot - hardware key not present');
    return false;
  }
  
  // Your existing Discord bot initialization
  // const { Client, GatewayIntentBits } = require('discord.js');
  // discordClient = new Client({ intents: [...] });
  // await discordClient.login(process.env.DISCORD_TOKEN);
  
  console.log('[Bot] ✓ Bot started successfully');
  return true;
}

async function shutdownDiscordBot(reason) {
  if (botShutdownInProgress) {
    return; // Already shutting down
  }
  
  botShutdownInProgress = true;
  console.log(`[Bot] Shutting down Discord bot (${reason})...`);
  
  if (discordClient) {
    // Graceful shutdown
    try {
      // 1. Set presence to "offline" or "maintenance"
      // await discordClient.user.setPresence({ status: 'invisible' });
      
      // 2. Send shutdown notification to admin channel
      // const adminChannel = await discordClient.channels.fetch(ADMIN_CHANNEL_ID);
      // await adminChannel.send(`🔒 Bot shutting down: ${reason}`);
      
      // 3. Destroy client
      // await discordClient.destroy();
      
      console.log('[Bot] ✓ Bot shut down gracefully');
    } catch (error) {
      console.error('[Bot] Error during shutdown:', error);
    }
    
    discordClient = null;
  }
  
  botShutdownInProgress = false;
}

// ============================================================================
// HARDWARE SECURITY EVENT HANDLERS
// ============================================================================

securityGate.on('key-granted', (reason) => {
  console.log(`[Security] 🔓 Hardware key granted (${reason})`);
  
  // If bot is not running, optionally auto-start it
  if (!discordClient && !botShutdownInProgress) {
    console.log('[Security] Auto-starting bot...');
    startDiscordBot();
  }
});

securityGate.on('key-revoked', (reason) => {
  console.log(`[Security] 🔒 Hardware key revoked (${reason})`);
  
  // Bot shutdown is triggered automatically by triggerBotShutdown()
  // This event is just for logging/notifications
});

securityGate.on('shutdown-required', async ({ reason, gracePeriod }) => {
  console.error(`[Security] ⚠️  SECURITY LOCKOUT: Shutdown required (${reason})`);
  console.log(`[Security] Grace period: ${gracePeriod}ms`);
  
  // Trigger bot shutdown
  await shutdownDiscordBot(reason);
});

securityGate.on('invalid-card', () => {
  console.warn('[Security] ⚠️  Invalid RFID card detected - possible intrusion attempt');
  
  // Optionally send alert to admin
  // if (discordClient) {
  //   const adminChannel = await discordClient.channels.fetch(ADMIN_CHANNEL_ID);
  //   await adminChannel.send('⚠️ Invalid RFID card scanned - check security logs');
  // }
});

securityGate.on('hardware-error', (error) => {
  console.error(`[Security] Hardware error: ${error}`);
});

securityGate.on('connected', () => {
  console.log('[Security] ✓ Hardware connected');
});

securityGate.on('disconnected', () => {
  console.warn('[Security] ⚠️  Hardware disconnected');
});

// ============================================================================
// EXPRESS WEB DASHBOARD
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add hardware security context to all routes
app.use(hardwareSecurityContext(securityGate));

// ============================================================================
// PUBLIC ROUTES (No hardware key required)
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Darklock Security System',
    hardwareKeyPresent: req.hardwareSecurity.keyPresent,
    hardwareConnected: req.hardwareSecurity.hardwareConnected,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    bot: {
      running: discordClient !== null,
      shutdownInProgress: botShutdownInProgress,
    },
    hardware: {
      keyPresent: req.hardwareSecurity.keyPresent,
      connected: req.hardwareSecurity.hardwareConnected,
      stats: req.hardwareSecurity.stats,
    },
  });
});

// ============================================================================
// ADMIN ROUTES (Hardware key required)
// ============================================================================

// SECURITY: All /admin routes require hardware key
app.use('/admin', requireHardwareKey(securityGate));

// Admin login page
app.get('/admin/login', (req, res) => {
  // If we get here, hardware key is present
  // Now show normal login page (password authentication)
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Darklock Admin Login</title>
    </head>
    <body>
      <h1>🔓 Hardware Key Verified</h1>
      <p>Enter admin password:</p>
      <form method="POST" action="/admin/auth">
        <input type="password" name="password" required>
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `);
});

// Admin authentication endpoint
app.post('/admin/auth', (req, res) => {
  const { password } = req.body;
  
  // SECURITY: Hardware key already verified by middleware
  // Now verify password (replace with your real auth logic)
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
  
  if (password === ADMIN_PASSWORD) {
    // In production, set session cookie here
    res.json({ success: true, message: 'Authenticated' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Admin dashboard
app.get('/admin/dashboard', (req, res) => {
  // Hardware key verified by middleware
  // Session would be checked here in production
  
  res.json({
    message: 'Welcome to admin dashboard',
    bot: {
      running: discordClient !== null,
    },
    hardware: req.hardwareSecurity.stats,
  });
});

// Admin bot control
app.post('/admin/bot/start', async (req, res) => {
  if (discordClient) {
    return res.status(400).json({ error: 'Bot already running' });
  }
  
  const started = await startDiscordBot();
  
  if (started) {
    res.json({ success: true, message: 'Bot started' });
  } else {
    res.status(500).json({ error: 'Failed to start bot' });
  }
});

app.post('/admin/bot/stop', async (req, res) => {
  if (!discordClient) {
    return res.status(400).json({ error: 'Bot not running' });
  }
  
  await shutdownDiscordBot('MANUAL_ADMIN_STOP');
  res.json({ success: true, message: 'Bot stopped' });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  console.error('[Express] Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// ============================================================================
// STARTUP SEQUENCE
// ============================================================================

async function startup() {
  console.log('═══════════════════════════════════════════════');
  console.log('  DARKLOCK PHYSICAL SECURITY SYSTEM');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  
  // 1. Start hardware security gate
  console.log('[1/3] Starting hardware security gate...');
  await securityGate.start();
  
  // Wait for Arduino to boot
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 2. Check if hardware key is present
  console.log('[2/3] Checking hardware key...');
  if (securityGate.isKeyPresent()) {
    console.log('✓ Hardware key detected');
  } else {
    console.warn('⚠️  No hardware key detected');
    
    if (securityGate.config.requireHardwareForBoot) {
      console.error('ERROR: Hardware key required for boot (failClosed mode)');
      console.log('Waiting for hardware key...');
      
      // Wait for key to be inserted
      await new Promise((resolve) => {
        securityGate.once('key-granted', resolve);
      });
      
      console.log('✓ Hardware key inserted');
    }
  }
  
  // 3. Start Discord bot
  console.log('[3/3] Starting Discord bot...');
  await startDiscordBot();
  
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  ✓ System started successfully');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`Web dashboard: http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/login`);
  console.log('');
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal} - shutting down gracefully...`);
  
  // 1. Shutdown Discord bot
  await shutdownDiscordBot('PROCESS_SIGNAL');
  
  // 2. Shutdown hardware gate
  await securityGate.shutdown();
  
  // 3. Close Express server
  if (server) {
    server.close(() => {
      console.log('✓ Express server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// START APPLICATION
// ============================================================================

let server = null;

startup()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Express server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
  });

// ============================================================================
// EXPORTS (for testing)
// ============================================================================

module.exports = {
  app,
  securityGate,
  startDiscordBot,
  shutdownDiscordBot,
};
