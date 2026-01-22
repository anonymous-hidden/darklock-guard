# 🔐 Hardware Key Protection System

A physical security system that requires a Raspberry Pi Pico to be connected before allowing file modifications to your Discord bot project.

## 🎯 Features

- **Physical Key Required**: Files can only be modified when the Raspberry Pi Pico is plugged in
- **Automatic Detection**: Continuously monitors for hardware key connection/disconnection
- **File Protection**: Watches critical project files and blocks unauthorized changes
- **Automatic Backups**: Creates backups before enforcement begins
- **Violation Logging**: Tracks all unauthorized modification attempts
- **Auto-Revert**: Attempts to restore files from backup when unauthorized changes are detected

## 📋 Requirements

- Raspberry Pi Pico (any model: Pico, Pico W, Pico H)
- Node.js 14+ 
- Windows, macOS, or Linux

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd file-protection/hardware-key
npm install
```

### 2. Identify Your Pico

First, plug in your Raspberry Pi Pico, then run:

```bash
npm run list-ports
```

This will show all connected serial devices and identify your Pico.

### 3. Configure (Optional)

Edit `start-protection.js` to customize:

```javascript
const config = {
    // Paths to protect
    watchPaths: [
        'src/**/*.js',
        'config.json',
        // Add your important files
    ],
    
    // Paths to ignore
    ignorePaths: [
        '**/node_modules/**',
        '**/logs/**',
        // Add paths that should not be protected
    ],
    
    // Optional: Use your Pico's serial number for extra security
    customIdentifier: 'YOUR_PICO_SERIAL_NUMBER'
};
```

### 4. Test the System

```bash
npm test
```

This will:
- Detect your Raspberry Pi Pico
- Start the protection system
- Create test files to verify blocking works
- Show you the results

### 5. Start Protection

```bash
npm start
```

Or run it as a background service:

```bash
# Linux/Mac
nohup npm start > protection.log 2>&1 &

# Windows (PowerShell)
Start-Process -NoNewWindow npm "start" -RedirectStandardOutput protection.log
```

## 🔧 How It Works

### 1. Hardware Detection
The system continuously scans USB ports for your Raspberry Pi Pico by:
- Vendor ID: `2e8a` (Raspberry Pi)
- Product IDs: `0003`, `0005`, `000a` (various Pico models)
- Manufacturer name matching

### 2. File Monitoring
When active, the system watches all configured paths and:
- **Pico Connected**: Allows all file operations normally
- **Pico Disconnected**: Blocks and logs any file changes

### 3. Violation Response
When unauthorized changes are detected:
1. Log the violation with details
2. Attempt to restore from backup
3. Emit events for additional alerts
4. Increment violation counter

### 4. Automatic Backups
On startup, the system:
- Scans all protected paths
- Creates a backup snapshot
- Stores in `file-protection/backups/hardware-key/`

## 📊 Usage Examples

### Basic Usage

```javascript
const HardwareKeyProtection = require('./file-protection/hardware-key');

const protection = new HardwareKeyProtection({
    projectRoot: __dirname,
    watchPaths: ['src/**/*.js', 'config.json'],
    ignorePaths: ['**/node_modules/**']
});

await protection.start();
```

### With Custom Logger

```javascript
const winston = require('winston');

const logger = winston.createLogger({
    // Your winston config
});

const protection = new HardwareKeyProtection({
    logger: logger,
    projectRoot: __dirname
});

await protection.start();
```

### Event Handling

```javascript
// Listen for violations
protection.fileGuard.on('violation', (violation) => {
    // Send Discord alert
    // Send email notification
    // Trigger alarm
    console.error('SECURITY BREACH:', violation);
});

// Listen for hardware key events
protection.detector.on('disconnected', () => {
    console.warn('Hardware key removed! Protection active!');
});
```

### Integration with Existing System

```javascript
// In your main bot file
const HardwareKeyProtection = require('./file-protection/hardware-key');
const TamperProtectionSystem = require('./file-protection');

// Start hardware key protection
const hwProtection = new HardwareKeyProtection({
    projectRoot: __dirname,
    logger: yourLogger
});

await hwProtection.start();

// Your existing tamper protection
const tamperProtection = new TamperProtectionSystem({
    logger: yourLogger,
    bot: client
});

await tamperProtection.initialize();
```

## 🛠️ Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRoot` | String | `process.cwd()` | Root directory of your project |
| `checkInterval` | Number | `2000` | How often to check for Pico (ms) |
| `customIdentifier` | String | `null` | Specific Pico serial number |
| `watchPaths` | Array | See config | Paths to protect |
| `ignorePaths` | Array | See config | Paths to ignore |
| `logger` | Object | `console` | Custom logger instance |

## 🔍 Troubleshooting

### Pico Not Detected

1. **Check USB Connection**: Try different ports
2. **Install Drivers**: Some systems need USB serial drivers
3. **Check Mode**: Pico should not be in bootloader mode
4. **Run List Ports**: `npm run list-ports` to see all devices

### Files Still Being Modified

1. **Check Pico Status**: Verify it's actually detected
2. **Review Watch Paths**: Ensure paths are correct
3. **Check Permissions**: System might need elevated privileges
4. **Verify Installation**: Run `npm test` to verify functionality

### Permission Errors

**Linux/Mac:**
```bash
# Add your user to dialout group
sudo usermod -a -G dialout $USER
# Log out and back in
```

**Windows:**
- Run as Administrator
- Check antivirus isn't blocking

### High CPU Usage

- Increase `checkInterval` to 5000 or 10000 ms
- Reduce the number of `watchPaths`
- Add more patterns to `ignorePaths`

## 🎓 Raspberry Pi Pico Setup

Your Pico doesn't need any special code! Just:

1. Plug it into a USB port
2. Make sure it's not in bootloader mode (don't hold BOOTSEL while plugging in)
3. The system will detect it automatically

**Optional**: You can upload a simple script to make the LED blink as a visual indicator:

```python
# main.py (MicroPython)
import machine
import time

led = machine.Pin(25, machine.Pin.OUT)

while True:
    led.toggle()
    time.sleep(1)
```

## 🔒 Security Considerations

- **Physical Security**: Store your Pico in a secure location when not in use
- **Backup Security**: Protect the backup directory with permissions
- **Multi-Layer**: Use this with your existing tamper protection
- **Unique Identifier**: Set `customIdentifier` to your Pico's serial number for extra security
- **Logging**: Monitor violation logs regularly

## 📦 Integration with Discord Bot

Add to your main bot startup:

```javascript
// At the top of your main file
const HardwareKeyProtection = require('./file-protection/hardware-key');

// Before starting the bot
(async () => {
    const protection = new HardwareKeyProtection({
        projectRoot: __dirname,
        logger: console
    });
    
    await protection.start();
    
    // Now start your Discord bot
    client.login(process.env.DISCORD_TOKEN);
})();
```

## 📝 Scripts

- `npm start` - Start the protection system
- `npm test` - Run test suite
- `npm run list-ports` - List all serial ports and detect Pico

## 🆘 Support

If you encounter issues:

1. Run `npm run list-ports` to verify Pico detection
2. Run `npm test` to verify system functionality
3. Check the logs for error messages
4. Ensure all dependencies are installed: `npm install`

## 📜 License

Part of your Discord Bot project - same license applies.

## 🤝 Contributing

This is a security-critical component. Test thoroughly before deploying to production!
