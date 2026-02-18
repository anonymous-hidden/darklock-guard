#!/bin/bash
# Install and configure Pico Guild Display System

set -e

echo "========================================"
echo "Pico Guild Display Installer"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BOT_DIR="$(dirname $(dirname "$SCRIPT_DIR"))"

echo "Bot directory: $BOT_DIR"
echo "Script directory: $SCRIPT_DIR"
echo ""

# Step 1: Check Python dependencies
echo -e "${YELLOW}[1/6] Checking Python dependencies...${NC}"
pip3 install pyserial requests --quiet
echo -e "${GREEN}✓ Python dependencies installed${NC}"
echo ""

# Step 2: Check Pico connection
echo -e "${YELLOW}[2/6] Checking for Raspberry Pi Pico...${NC}"
if [ -e /dev/ttyACM0 ]; then
    echo -e "${GREEN}✓ Pico detected at /dev/ttyACM0${NC}"
    PICO_PORT="/dev/ttyACM0"
elif [ -e /dev/ttyUSB0 ]; then
    echo -e "${GREEN}✓ Pico detected at /dev/ttyUSB0${NC}"
    PICO_PORT="/dev/ttyUSB0"
else
    echo -e "${RED}✗ Pico not detected!${NC}"
    echo "Please connect your Raspberry Pi Pico via USB"
    echo "Make sure the Pico has MicroPython firmware installed"
    exit 1
fi
echo ""

# Step 3: Add user to dialout group for serial access
echo -e "${YELLOW}[3/6] Configuring serial port permissions...${NC}"
if ! groups $USER | grep -q dialout; then
    echo "Adding $USER to dialout group..."
    sudo usermod -a -G dialout $USER
    echo -e "${GREEN}✓ Added to dialout group (you may need to log out and back in)${NC}"
else
    echo -e "${GREEN}✓ User already in dialout group${NC}"
fi
echo ""

# Step 4: Install MicroPython code to Pico
echo -e "${YELLOW}[4/6] Installing firmware to Pico...${NC}"
echo "Please install the MicroPython firmware manually:"
echo ""
echo "Method 1 - Using Thonny IDE (Recommended for beginners):"
echo "  1. Install Thonny: sudo apt-get install thonny"
echo "  2. Open Thonny and connect to your Pico"
echo "  3. Open: $SCRIPT_DIR/main.py"
echo "  4. Save it to the Pico as 'main.py'"
echo ""
echo "Method 2 - Using ampy (Command line):"
echo "  1. Install ampy: pip3 install adafruit-ampy"
echo "  2. Run: ampy --port $PICO_PORT put $SCRIPT_DIR/main.py /main.py"
echo ""
echo "Method 3 - Using rshell:"
echo "  1. Install rshell: pip3 install rshell"
echo "  2. Run: rshell -p $PICO_PORT"
echo "  3. In rshell: cp $SCRIPT_DIR/main.py /pyboard/"
echo ""
read -p "Press Enter when you have uploaded the firmware to your Pico..."
echo ""

# Step 5: Create systemd service
echo -e "${YELLOW}[5/6] Creating systemd service...${NC}"

SERVICE_FILE="/etc/systemd/system/pico-guild-display.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Pico Guild Display Bridge
After=network.target discord-bot.service
Wants=discord-bot.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$BOT_DIR
Environment="PICO_PORT=$PICO_PORT"
Environment="DASHBOARD_URL=http://localhost:3001"
ExecStart=/usr/bin/python3 -u $SCRIPT_DIR/pico_bridge.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✓ Service file created: $SERVICE_FILE${NC}"
echo ""

# Step 6: Enable and start service
echo -e "${YELLOW}[6/6] Enabling service...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable pico-guild-display.service
echo -e "${GREEN}✓ Service enabled${NC}"
echo ""

echo "========================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "========================================"
echo ""
echo "Commands:"
echo "  Start:   sudo systemctl start pico-guild-display"
echo "  Stop:    sudo systemctl stop pico-guild-display"
echo "  Status:  sudo systemctl status pico-guild-display"
echo "  Logs:    journalctl -u pico-guild-display -f"
echo ""
echo "To start the display now:"
echo "  sudo systemctl start pico-guild-display"
echo ""
echo -e "${YELLOW}Note: If you just added yourself to the dialout group,${NC}"
echo -e "${YELLOW}you may need to log out and back in for it to take effect.${NC}"
echo ""
