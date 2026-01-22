# 🔒 Hardware Watchdog System

Use your Raspberry Pi Pico as a hardware watchdog to monitor your Discord bot server and automatically restart it if it crashes!

## 🎯 How It Works

```
Server Running → Sends Heartbeat (every 5s) → Pico Receives
     ↓                                            ↓
Server Crashes                                Pico Waits
     ↓                                            ↓
No Heartbeat                                  30s Timeout
     ↓                                            ↓
Pico Detects ← LED Blinks SOS ← Triggers Restart → Server Restarts
```

## 📋 Setup

### 1. Install Dependencies

```bash
cd file-protection/hardware-key/watchdog
npm install
```

### 2. Program Your Pico

**Upload the watchdog code to your Raspberry Pi Pico:**

1. Download [Thonny IDE](https://thonny.org/)
2. Install MicroPython on your Pico:
   - Hold BOOTSEL button while plugging in Pico
   - Drag MicroPython .uf2 file to RPI-RP2 drive
3. Open `pico-code/watchdog.py` in Thonny
4. Save it to the Pico as `main.py`
5. Unplug and replug the Pico

### 3. Start the Watchdog

```bash
npm start
```

## 🚦 LED Status Indicators

| Pattern | Meaning |
|---------|---------|
| 3 quick blinks on startup | Watchdog initialized |
| Slow pulse (every 2s) | Server alive and healthy |
| Single quick blink | Heartbeat received |
| SOS pattern (... --- ...) | Server crash detected! |
| 1 second solid | Restart triggered |

## ⚙️ Configuration

Edit `start-watchdog.js`:

```javascript
const config = {
    serverScript: 'path/to/your/bot.js',
    heartbeatInterval: 5000,    // Send heartbeat every 5s
    restartDelay: 5000,         // Wait 5s before restart
    maxRestarts: 10             // Give up after 10 restarts
};
```

Edit `pico-code/watchdog.py`:

```python
HEARTBEAT_TIMEOUT = 30  # Trigger restart after 30s without heartbeat
```

## 🧪 Testing

**Test 1: Normal Operation**
```bash
npm start
# Watch for slow LED pulse - server is healthy
```

**Test 2: Simulate Crash**
```bash
# In another terminal, kill the server process
taskkill /F /IM node.exe

# Watch the Pico:
# - LED blinks SOS
# - After 30s, triggers restart
# - Server comes back up
# - LED returns to slow pulse
```

**Test 3: Manual Restart**
```bash
# The Pico will detect and auto-restart
```

## 📊 How It Protects Your Server

**Without Watchdog:**
```
Server Crashes → Stays Down → Users Can't Connect → Manual Restart Needed
```

**With Watchdog:**
```
Server Crashes → Pico Detects (30s) → Auto Restart → Back Online!
```

## 🔌 Serial Communication

The system uses serial communication at 115200 baud:

**Messages Server → Pico:**
- `HEARTBEAT` - Server is alive
- `PING` - Test connection
- `RESTART_ACK` - Restart acknowledged

**Messages Pico → Server:**
- `RESTART` - Trigger server restart
- `PONG` - Connection test response

## 🛠️ Troubleshooting

**Pico Not Detected:**
```bash
# Run from hardware-key folder:
npm run list-ports
# Make sure you see COM port with Vendor ID: 2E8A
```

**Serial Connection Failed:**
- Check no other program (like Thonny) is connected to the Pico
- Unplug and replug the Pico
- Restart the watchdog service

**False Restarts:**
- Increase `HEARTBEAT_TIMEOUT` in watchdog.py
- Increase `heartbeatInterval` in start-watchdog.js

**Server Won't Restart:**
- Check `maxRestarts` limit hasn't been reached
- Verify serverScript path is correct
- Check logs for errors

## 📝 Integration with Existing Bot

To add heartbeat to your existing bot:

```javascript
// In your src/bot.js or main file
const HardwareWatchdog = require('../file-protection/hardware-key/watchdog/hardware-watchdog');

const watchdog = new HardwareWatchdog({
    heartbeatInterval: 5000
});

// Connect and start heartbeats
watchdog.connect().catch(err => {
    console.log('Watchdog not available:', err.message);
});

// Handle restart command
watchdog.on('restart', () => {
    console.log('Restart requested by watchdog');
    // Clean shutdown before restart
    client.destroy();
    process.exit(0);
});
```

## 🎯 Use Cases

- **Production Servers**: Auto-recovery from crashes
- **Remote Deployments**: No manual intervention needed
- **24/7 Bots**: Maximum uptime
- **Development**: Quick recovery during testing

## 🔐 Security

The watchdog runs as a separate process and can restart the server even if:
- The main process hangs
- Node.js crashes
- The event loop blocks
- Memory leaks cause slowdown

## 📊 Status Monitoring

Check status programmatically:

```javascript
const status = watchdog.getStatus();
console.log(status);
// {
//   connected: true,
//   port: 'COM11',
//   heartbeatInterval: 5000
// }
```

## 🆘 Emergency Stop

To stop the watchdog:
1. Press `Ctrl+C` in the terminal
2. Or unplug the Pico (server keeps running but no auto-restart)

## 📜 License

Part of your Discord Bot project - same license applies.
