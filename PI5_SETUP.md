# Discord Bot + RGB LED Status Monitor - Raspberry Pi 5 Setup Guide

## Quick Installation (Ubuntu Server)

### Prerequisites
- Raspberry Pi 5 running Ubuntu Server
- SSH access or keyboard/monitor
- Discord Bot Token
- Internet connection

### Step-by-Step Installation

#### 1. Download Installation Files
```bash
cd /tmp
# Copy the install-pi5.sh file to your Pi (if not already there)
# You can use SCP: scp install-pi5.sh ubuntu@<pi-ip>:/home/ubuntu/
```

#### 2. Run Installation Script
```bash
cd /home/ubuntu
sudo bash install-pi5.sh
```

This script will automatically:
- ✅ Update system packages
- ✅ Install Node.js 20
- ✅ Install Python 3 and pip
- ✅ Install GPIO libraries (RPi.GPIO)
- ✅ Install all bot dependencies
- ✅ Create systemd services for auto-start
- ✅ Configure proper permissions

#### 3. Configure Your Bot
```bash
nano /home/ubuntu/discord-bot/.env
```

Add your Discord bot configuration:
```env
DISCORD_TOKEN=your_bot_token_here
OWNER_ID=your_discord_user_id_here
NODE_ENV=production
PORT=3000
```

Save with `Ctrl+X`, then `Y`, then `Enter`

#### 4. Start the Services
```bash
sudo systemctl start discord-bot
sudo systemctl start rgb-led-status
```

Or use the quick-start script:
```bash
bash /home/ubuntu/discord-bot/quickstart-pi5.sh
```

## RGB LED Hardware Setup

### Wiring (Raspberry Pi 5)
```
RGB LED Common Cathode (-)
├── Pin 11 (GPIO 17)  → Red
├── Pin 13 (GPIO 27)  → Green
├── Pin 15 (GPIO 22)  → Blue
└── Pin 14 (GND)      → Ground

IMPORTANT: Use 330Ω resistors in series with each LED pin!
```

### Breadboard Diagram
```
Pi5 GPIO     Resistor    LED Cathode    LED Common (-)
  17 ----[330Ω]----→|----+ (Red)
  27 ----[330Ω]----→|----+ (Green)
  22 ----[330Ω]----→|----+ (Blue)
  GND --------------------+
```

## LED Status Meanings

| Color | Status | Meaning |
|-------|--------|---------|
| 🟢 Green | LIVE | Bot is running and responsive |
| 🔵 Blue | RESTARTING | Bot is restarting |
| 🔴 Red | DOWN | Bot has crashed or stopped |
| ⚫ Off | IDLE | LED monitor not running |

## Service Management

### View Service Status
```bash
sudo systemctl status discord-bot
sudo systemctl status rgb-led-status
```

### View Live Logs
```bash
# Bot logs
sudo journalctl -u discord-bot -f

# LED monitor logs
sudo journalctl -u rgb-led-status -f

# Combined logs
sudo journalctl -u discord-bot -u rgb-led-status -f
```

### Control Services
```bash
# Restart bot
sudo systemctl restart discord-bot

# Restart LED monitor
sudo systemctl restart rgb-led-status

# Stop services
sudo systemctl stop discord-bot
sudo systemctl stop rgb-led-status

# Enable auto-start on boot
sudo systemctl enable discord-bot
sudo systemctl enable rgb-led-status

# Disable auto-start
sudo systemctl disable discord-bot
sudo systemctl disable rgb-led-status
```

## Troubleshooting

### LED Not Working

**Problem:** LED doesn't light up or doesn't respond
```bash
# Check if service is running
sudo systemctl status rgb-led-status

# Check for errors
sudo journalctl -u rgb-led-status -n 50

# Verify GPIO access
ls -la /sys/class/gpio/gpio17/
```

**Solution:**
1. Check wiring and resistors
2. Verify GPIO pins (11, 13, 15 for data; 14 for ground)
3. Ensure proper ground connection
4. Try manually testing:
   ```bash
   sudo python3 /home/ubuntu/discord-bot/rgb_led_status.py
   ```

### Bot Not Starting

**Problem:** Service shows failed status
```bash
# Check logs
sudo journalctl -u discord-bot -n 100

# Check if .env file exists and has correct permissions
ls -la /home/ubuntu/discord-bot/.env

# Try running manually for debugging
cd /home/ubuntu/discord-bot
node src/bot.js
```

**Solution:**
1. Verify .env file exists with correct token
2. Check file permissions: `chmod 600 .env`
3. Ensure Node.js is installed: `node --version`
4. Reinstall dependencies: `cd /home/ubuntu/discord-bot && npm install`

### Permission Denied on GPIO

**Problem:** "Permission denied" when accessing GPIO pins
```bash
# Add ubuntu user to gpio group
sudo usermod -a -G gpio ubuntu

# Log out and back in, or use:
newgrp gpio
```

### Service Not Auto-Starting

**Problem:** Services don't start on boot
```bash
# Check if enabled
systemctl is-enabled discord-bot

# Enable auto-start
sudo systemctl enable discord-bot
sudo systemctl enable rgb-led-status

# Reboot and check
sudo reboot
sudo systemctl status discord-bot
```

## Testing

### Manual LED Test
```bash
# Connect via SSH and run:
sudo python3 << 'EOF'
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup([17, 27, 22], GPIO.OUT)

# Test red
GPIO.output(17, GPIO.HIGH)
time.sleep(2)
GPIO.output(17, GPIO.LOW)

# Test green
GPIO.output(27, GPIO.HIGH)
time.sleep(2)
GPIO.output(27, GPIO.LOW)

# Test blue
GPIO.output(22, GPIO.HIGH)
time.sleep(2)
GPIO.output(22, GPIO.LOW)

GPIO.cleanup()
EOF
```

### Bot Process Test
```bash
# Check if bot process is running
ps aux | grep "node src/bot.js"

# Check bot logs
sudo journalctl -u discord-bot --since "10 minutes ago"
```

## Advanced Configuration

### Change LED Monitoring Interval
Edit `/home/ubuntu/discord-bot/rgb_led_status.py`:
```python
monitor.monitor(
    check_function=lambda: monitor.check_discord_bot("node"),
    interval=5  # Check every 5 seconds instead of 10
)
```

### Monitor HTTP Server Instead of Process
Edit `/home/ubuntu/discord-bot/rgb_led_status.py`:
```python
# Uncomment this section:
monitor.monitor(
    check_function=lambda: monitor.check_server_http("http://localhost:3000"),
    interval=10
)
```

### Change GPIO Pins
Edit both files:
- `rgb_led_status.py` - Change `RED_PIN`, `GREEN_PIN`, `BLUE_PIN` values
- `/etc/systemd/system/rgb-led-status.service` - Update GPIO export pins

Then restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart rgb-led-status
```

## Security Notes

- Bot token is stored in `.env` with restricted permissions (600)
- Services run as `ubuntu` user, not root
- GPIO access is properly sandboxed in systemd service
- Logs are journaled and can be audited

## Support

For issues or questions:
1. Check logs: `sudo journalctl -u discord-bot -f`
2. Verify wiring matches the diagram
3. Test components individually
4. Check file permissions
5. Ensure no other process is using the GPIO pins

## Uninstalling

To remove the bot and LED monitor:
```bash
sudo systemctl stop discord-bot
sudo systemctl stop rgb-led-status
sudo systemctl disable discord-bot
sudo systemctl disable rgb-led-status
sudo rm /etc/systemd/system/discord-bot.service
sudo rm /etc/systemd/system/rgb-led-status.service
sudo systemctl daemon-reload
rm -rf /home/ubuntu/discord-bot
```

## Files Created

- `/home/ubuntu/discord-bot/` - Main bot directory
- `/etc/systemd/system/discord-bot.service` - Bot service
- `/etc/systemd/system/rgb-led-status.service` - LED service
- `/home/ubuntu/discord-bot/.env` - Configuration file
- `/home/ubuntu/discord-bot/logs/` - Log files
- `/home/ubuntu/discord-bot/data/` - Data files

---

**Installation Date:** [Your Date]
**Pi Model:** Raspberry Pi 5
**OS:** Ubuntu Server (Latest)
**Bot Version:** 1.0.1
