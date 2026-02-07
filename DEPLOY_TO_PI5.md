# Deploy Hardware Controller to Raspberry Pi 5

## Prerequisites Check

### 1. Verify Pi is Connected and Booted
On your Pi, run:
```bash
hostname -I
```
This should show you the Pi's IP address. Verify it matches: `192.168.50.2`

### 2. Test SSH Connection from Your Laptop
```bash
ssh ubuntu@192.168.50.2
# Use password: 0131106761Cb
```

---

## Automated Deployment (Run from Your Laptop)

Once SSH is working, run this:

```bash
cd "/home/cayden/discord bot/discord bot"

# Copy files to Pi
sshpass -p '0131106761Cb' scp -o StrictHostKeyChecking=no \
  hardware_controller.py ubuntu@192.168.50.2:/tmp/

sshpass -p '0131106761Cb' scp -o StrictHostKeyChecking=no \
  /tmp/hardware-controller.service ubuntu@192.168.50.2:/tmp/

# Deploy on Pi
sshpass -p '0131106761Cb' ssh -o StrictHostKeyChecking=no ubuntu@192.168.50.2 << 'EOFSH'
set -e

echo "Creating project directory..."
sudo mkdir -p /home/ubuntu/discord-bot/data
sudo chown -R ubuntu:ubuntu /home/ubuntu/discord-bot

echo "Installing hardware controller..."
sudo cp /tmp/hardware_controller.py /home/ubuntu/discord-bot/
sudo chmod +x /home/ubuntu/discord-bot/hardware_controller.py
sudo chown ubuntu:ubuntu /home/ubuntu/discord-bot/hardware_controller.py

echo "Installing systemd service..."
sudo mv /tmp/hardware-controller.service /etc/systemd/system/
sudo chmod 644 /etc/systemd/system/hardware-controller.service

echo "Stopping old services..."
sudo systemctl stop rgb-led-status.service 2>/dev/null || true
sudo systemctl disable rgb-led-status.service 2>/dev/null || true

echo "Enabling hardware controller..."
sudo systemctl daemon-reload
sudo systemctl enable hardware-controller.service
sudo systemctl start hardware-controller.service

echo ""
echo "=== Hardware Controller Status ==="
sudo systemctl status hardware-controller.service --no-pager -l
EOFSH
```

---

## Manual Deployment (If Automated Fails)

### Step 1: Copy Files to Pi
On your laptop:
```bash
scp hardware_controller.py ubuntu@192.168.50.2:/tmp/
scp /tmp/hardware-controller.service ubuntu@192.168.50.2:/tmp/
```

### Step 2: SSH into Pi
```bash
ssh ubuntu@192.168.50.2
```

### Step 3: Install on Pi
On the Pi, run:
```bash
# Create project directory
sudo mkdir -p /home/ubuntu/discord-bot/data
sudo chown -R ubuntu:ubuntu /home/ubuntu/discord-bot

# Install hardware controller
sudo cp /tmp/hardware_controller.py /home/ubuntu/discord-bot/
sudo chmod +x /home/ubuntu/discord-bot/hardware_controller.py

# Install systemd service
sudo mv /tmp/hardware-controller.service /etc/systemd/system/
sudo chmod 644 /etc/systemd/system/hardware-controller.service

# Stop old rgb-led-status if exists
sudo systemctl stop rgb-led-status.service 2>/dev/null || true
sudo systemctl disable rgb-led-status.service 2>/dev/null || true

# Enable new hardware controller
sudo systemctl daemon-reload
sudo systemctl enable hardware-controller.service
sudo systemctl start hardware-controller.service

# Check status
sudo systemctl status hardware-controller.service
```

---

## Verify Installation

### Check Service Status
```bash
sudo systemctl status hardware-controller.service
sudo systemctl status discord-bot.service
```

### View Live Logs
```bash
# Hardware controller logs
sudo journalctl -u hardware-controller.service -f

# Bot logs
sudo journalctl -u discord-bot.service -f

# Combined
sudo journalctl -u hardware-controller.service -u discord-bot.service -f
```

### Test Hardware

**RGB LED should show:**
- 🔵 BLUE = Bot starting/restarting
- 🟢 GREEN = Bot running healthy
- 🔴 RED = Bot crashed/stopped

**Clear LED should:**
- Solid ON during boot
- Slow blink (1s on/off) when running
- OFF on shutdown

**Buttons:**
- Button 1 (GPIO5) = Restart bot service
- Button 2 (GPIO6) = Toggle maintenance mode
- Button 3 (GPIO12) = LED test cycle (R→G→B→Clear)

### Test Button 3 (LED Test)
Press button connected to GPIO12. You should see:
1. Red LED for 1 second
2. Green LED for 1 second
3. Blue LED for 1 second
4. Clear LED solid for 1 second
5. Return to normal status

---

## Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u hardware-controller.service -n 50

# Check Python dependencies
python3 -c "import RPi.GPIO; print('GPIO OK')"

# Check file permissions
ls -la /home/ubuntu/discord-bot/hardware_controller.py
```

### GPIO Permission Denied
```bash
# Service runs as root, but if testing manually:
sudo python3 /home/ubuntu/discord-bot/hardware_controller.py
```

### Bot Service Missing
If discord-bot.service doesn't exist yet, create it:
```bash
sudo nano /etc/systemd/system/discord-bot.service
```

Paste:
```ini
[Unit]
Description=Discord Security Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
ExecStart=/usr/bin/node src/bot.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=discord-bot

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-bot.service
sudo systemctl start discord-bot.service
```

---

## Quick Reference Commands

```bash
# Restart hardware controller
sudo systemctl restart hardware-controller.service

# Restart bot
sudo systemctl restart discord-bot.service

# Stop everything
sudo systemctl stop hardware-controller.service discord-bot.service

# Start everything
sudo systemctl start discord-bot.service hardware-controller.service

# View all logs
sudo journalctl -u hardware-controller.service -u discord-bot.service -f
```
