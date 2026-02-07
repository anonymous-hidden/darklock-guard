# ChatGPT Guide: Discord Bot + RGB LED Installation on Raspberry Pi 5

## Project Overview

This is a **Discord Security Bot** with an **RGB LED Status Monitor** for Raspberry Pi 5 running Ubuntu Server.

**What it does:**
- Runs a Discord bot that provides security features for Discord servers
- Uses an RGB LED connected to GPIO pins to display bot status in real-time
- Automatically starts on boot using systemd services

**LED Status Indicators:**
- 🟢 **GREEN** = Bot is running and online
- 🔴 **RED** = Bot is down or crashed
- 🔵 **BLUE** = Bot is restarting

---

## Hardware Setup Required

### Components Needed:
- Raspberry Pi 5
- RGB LED (Common Cathode type)
- 3x 330Ω resistors
- Breadboard
- Jumper wires
- Ubuntu Server running on Pi5

### GPIO Wiring (VERY IMPORTANT):

```
Raspberry Pi 5 GPIO Pins → Breadboard → LED

Pin 11 (GPIO 17)  ──[330Ω resistor]──→ Red LED pin
Pin 13 (GPIO 27)  ──[330Ω resistor]──→ Green LED pin
Pin 15 (GPIO 22)  ──[330Ω resistor]──→ Blue LED pin
Pin 14 (GND)      ──────────────────→ LED Common (-) pin
```

**CRITICAL:** 
- Use resistors to protect the GPIO pins (330Ω minimum)
- Pin 14 is **GROUND** - must connect to LED's negative/common pin
- Double-check your wiring before powering on

---

## Installation Files Provided

### Main Scripts:

1. **`install-pi5.sh`** (MAIN - Run this first!)
   - Automated installer that does everything
   - Installs Node.js, Python, libraries
   - Creates systemd services
   - Sets up permissions
   - Duration: ~10-15 minutes

2. **`quickstart-pi5.sh`** (Run after install)
   - Interactive setup helper
   - Creates .env configuration file
   - Starts services
   - Duration: ~2-3 minutes

3. **`rgb_led_status.py`** (LED Monitor)
   - Python script that controls the LED
   - Checks bot status every 10 seconds
   - Automatically started by systemd
   - No manual interaction needed

4. **`PI5_SETUP.md`** (Reference Guide)
   - Detailed troubleshooting guide
   - Service management commands
   - Testing procedures
   - Advanced configuration options

---

## Step-by-Step Installation Process

### **PHASE 1: Prepare Files**

Ask the user:
1. Do you have your Discord bot token ready? (If not, they need to create one on Discord Developer Portal)
2. Do you know your Discord user ID? (They can find this with developer mode on)
3. Have you wired the RGB LED correctly to the Pi5 GPIO pins?

### **PHASE 2: Run Installation**

**On the Raspberry Pi 5:**

```bash
# 1. Navigate to home directory
cd /home/ubuntu

# 2. Copy or create the install-pi5.sh file
# (If transferring from another computer use SCP)
scp install-pi5.sh ubuntu@<your-pi-ip>:/home/ubuntu/

# 3. Run the installation script
sudo bash install-pi5.sh
```

**What happens during installation:**
- System packages updated
- Node.js v20 installed
- Python 3 and pip installed
- GPIO libraries installed (RPi.GPIO)
- Bot dependencies installed
- Two systemd services created:
  - `discord-bot.service` - runs the bot
  - `rgb-led-status.service` - runs the LED monitor

**Monitor output:** Script should show [1/10] through [10/10] with each step

### **PHASE 3: Configuration**

```bash
# 1. Create .env file with bot credentials
nano /home/ubuntu/discord-bot/.env

# 2. Add these lines (user fills in actual values):
DISCORD_TOKEN=your_bot_token_here
OWNER_ID=your_discord_user_id_here
NODE_ENV=production
PORT=3000

# 3. Save file: Press Ctrl+X, then Y, then Enter
```

### **PHASE 4: Start Services**

Option A - Using quick-start script:
```bash
bash /home/ubuntu/discord-bot/quickstart-pi5.sh
```

Option B - Manual start:
```bash
sudo systemctl start discord-bot
sudo systemctl start rgb-led-status
sudo systemctl enable discord-bot
sudo systemctl enable rgb-led-status
```

---

## Verification Steps

### Check if services are running:
```bash
sudo systemctl status discord-bot
sudo systemctl status rgb-led-status
```

Expected output: Should show "active (running)" for both

### Check LED status:
```bash
sudo journalctl -u rgb-led-status -n 20
```

Look for status messages like "Status: LIVE (Green)"

### Check bot logs:
```bash
sudo journalctl -u discord-bot -n 20
```

Should show bot is logged in and ready

### Visual test:
- Look at the RGB LED on breadboard
- It should be **green** if bot is running
- It should be **red** if bot is stopped

---

## Common Issues & Solutions

### Issue 1: LED Not Lighting Up

**Check:**
1. Wiring - Verify pins 11, 13, 15, 14 are correct
2. Resistors - Make sure 330Ω resistors are in series
3. Service status - `sudo systemctl status rgb-led-status`
4. Logs - `sudo journalctl -u rgb-led-status -n 50`

**Fix:**
- Recheck breadboard connections
- Try manual test:
  ```bash
  sudo python3 << 'EOF'
  import RPi.GPIO as GPIO
  GPIO.setmode(GPIO.BCM)
  GPIO.setup([17, 27, 22], GPIO.OUT)
  GPIO.output(17, GPIO.HIGH)  # Red should light
  GPIO.cleanup()
  EOF
  ```

### Issue 2: Bot Service Won't Start

**Check:**
1. .env file exists: `ls -la /home/ubuntu/discord-bot/.env`
2. Token is correct (no spaces or typos)
3. Logs for errors: `sudo journalctl -u discord-bot -n 100`

**Fix:**
- Verify .env file: `cat /home/ubuntu/discord-bot/.env`
- Check permissions: `chmod 600 /home/ubuntu/discord-bot/.env`
- Reinstall dependencies: `cd /home/ubuntu/discord-bot && npm install`

### Issue 3: Permission Denied on GPIO

**Fix:**
```bash
sudo usermod -a -G gpio ubuntu
newgrp gpio
sudo systemctl restart rgb-led-status
```

### Issue 4: Services Don't Start on Boot

**Fix:**
```bash
sudo systemctl enable discord-bot
sudo systemctl enable rgb-led-status
sudo reboot
```

---

## Daily Usage Commands

**Start bot manually:**
```bash
sudo systemctl start discord-bot
```

**Stop bot:**
```bash
sudo systemctl stop discord-bot
```

**Restart bot:**
```bash
sudo systemctl restart discord-bot
```

**View live logs (bot):**
```bash
sudo journalctl -u discord-bot -f
```

**View live logs (LED):**
```bash
sudo journalctl -u rgb-led-status -f
```

**Check service status:**
```bash
sudo systemctl status discord-bot
sudo systemctl status rgb-led-status
```

---

## What Each Service Does

### `discord-bot.service`
- Runs `/home/ubuntu/discord-bot/src/bot.js`
- This is the Discord bot with security features
- Runs as `ubuntu` user
- Auto-restarts if it crashes
- Logs to journalctl

### `rgb-led-status.service`
- Runs `/home/ubuntu/discord-bot/rgb_led_status.py`
- Monitors if the Discord bot is running
- Updates LED color based on bot status
- Checks status every 10 seconds
- Also logs to journalctl

---

## Important File Locations

```
/home/ubuntu/discord-bot/              ← Main bot directory
├── .env                               ← Configuration (keep secret!)
├── src/bot.js                         ← Main bot code
├── rgb_led_status.py                  ← LED control script
├── package.json                       ← Bot dependencies
├── data/                              ← Bot data files
└── logs/                              ← Log files

/etc/systemd/system/
├── discord-bot.service                ← Bot service definition
└── rgb-led-status.service             ← LED service definition
```

---

## For ChatGPT: Context Information

### What I Can Help With:
- ✅ Troubleshooting installation
- ✅ Explaining what each file does
- ✅ Helping interpret error messages
- ✅ Guiding through commands
- ✅ Testing individual components
- ✅ Understanding service status
- ✅ Verifying LED wiring

### What I Need From User:
- Error messages from logs
- Output from status commands
- Photos of breadboard wiring (if GPIO issues)
- Their Discord bot token (they have it, I just reference it)

### Quick Diagnostic Questions:
1. "Does the LED light up at all?"
2. "What does `sudo systemctl status discord-bot` show?"
3. "Can you paste the last 20 lines of `sudo journalctl -u rgb-led-status -n 20`?"
4. "Have you verified the GPIO wiring with a diagram?"
5. "Does the .env file exist and contain your token?"

---

## Testing Individual Components

### Test 1: GPIO Hardware
```bash
sudo python3 << 'EOF'
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup([17, 27, 22], GPIO.OUT)

# Test each color
print("Testing Red...")
GPIO.output(17, GPIO.HIGH)
time.sleep(1)
GPIO.output(17, GPIO.LOW)

print("Testing Green...")
GPIO.output(27, GPIO.HIGH)
time.sleep(1)
GPIO.output(27, GPIO.LOW)

print("Testing Blue...")
GPIO.output(22, GPIO.HIGH)
time.sleep(1)
GPIO.output(22, GPIO.LOW)

GPIO.cleanup()
print("Done!")
EOF
```

### Test 2: Bot Process
```bash
ps aux | grep "node src/bot.js"
```

### Test 3: Python LED Script
```bash
sudo python3 /home/ubuntu/discord-bot/rgb_led_status.py
# Should show status checks, Ctrl+C to stop
```

---

## Emergency Commands

**If something goes wrong:**

```bash
# Stop everything
sudo systemctl stop discord-bot
sudo systemctl stop rgb-led-status

# Check what's running
ps aux | grep -E "node|python" | grep -v grep

# Kill a stuck process
sudo pkill -f "node src/bot.js"
sudo pkill -f "rgb_led_status.py"

# View all recent logs
sudo journalctl -n 100

# Reboot the Pi
sudo reboot
```

---

## Success Indicators

You'll know it worked when:

✅ Both services show "active (running)" when you check status
✅ The LED is **green** (bot is online)
✅ You can see bot activity in Discord
✅ Logs show "Bot is ready" message
✅ Services auto-start after reboot

---

## Next Steps After Installation

1. **Test the bot** - Make sure it responds to commands in Discord
2. **Test the LED** - Stop the bot and verify LED turns red
3. **Reboot** - Verify services start automatically
4. **Set up monitoring** - Bookmark the log commands for future reference
5. **Document credentials** - Save your bot token somewhere safe

---

**Created:** February 3, 2026
**For:** Raspberry Pi 5 with Ubuntu Server
**Bot Version:** 1.0.1
**Python Version:** 3.x
**Node.js Version:** 20.x
