#!/bin/bash

#############################################################################
# Discord Bot + RGB LED Status Monitor Installation Script for Raspberry Pi 5
# Ubuntu Server Edition
# 
# Usage: sudo bash install-pi5.sh
#############################################################################

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BOT_DIR="/home/ubuntu/discord-bot"
SERVICE_NAME="discord-bot"
LED_SERVICE_NAME="hardware-controller"
CURRENT_USER=$(whoami)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Discord Bot + RGB LED Installation${NC}"
echo -e "${BLUE}Raspberry Pi 5 - Ubuntu Server${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}[1/10] Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

echo -e "${YELLOW}[2/10] Installing Node.js and npm...${NC}"
apt-get install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo -e "${YELLOW}[3/10] Installing Python and pip...${NC}"
apt-get install -y python3 python3-pip python3-dev

echo -e "${YELLOW}[4/10] Installing GPIO libraries...${NC}"
apt-get install -y python3-rpi.gpio python3-gpiozero
pip3 install RPi.GPIO requests --break-system-packages

echo -e "${YELLOW}[5/10] Installing build tools and native deps...${NC}"
apt-get install -y build-essential git pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libvips-dev

echo -e "${YELLOW}[6/10] Setting up bot directory...${NC}"
if [ ! -d "$BOT_DIR" ]; then
    mkdir -p "$BOT_DIR"
    echo "Created $BOT_DIR"
fi

# Copy bot files if in different location
if [ "$(pwd)" != "$BOT_DIR" ] && [ -f "package.json" ]; then
    echo "Copying bot files to $BOT_DIR..."
    cp -r * "$BOT_DIR/" 2>/dev/null || true
    cd "$BOT_DIR"
fi

echo -e "${YELLOW}[7/10] Installing Node.js dependencies...${NC}"
npm install

echo -e "${YELLOW}[8/10] Creating systemd service for Discord Bot...${NC}"
cat > /etc/systemd/system/${SERVICE_NAME}.service << 'EOF'
[Unit]
Description=Discord Security Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
EnvironmentFile=-/home/ubuntu/discord-bot/.env
ExecStart=/usr/bin/node src/bot.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=discord-bot

# Security settings
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/ubuntu/discord-bot/data /home/ubuntu/discord-bot/logs /home/ubuntu/discord-bot/uploads /home/ubuntu/discord-bot/temp

[Install]
WantedBy=multi-user.target
EOF

echo -e "${YELLOW}[9/10] Creating systemd service for Hardware Controller...${NC}"
cat > /etc/systemd/system/${LED_SERVICE_NAME}.service << 'EOF'
[Unit]
Description=Darklock Hardware Controller (GPIO)
After=network.target discord-bot.service

[Service]
Type=simple
User=root
WorkingDirectory=/home/ubuntu/discord-bot
ExecStart=/usr/bin/python3 /home/ubuntu/discord-bot/hardware_controller.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hardware-controller

[Install]
WantedBy=multi-user.target
EOF

echo -e "${YELLOW}[10/10] Setting up permissions and finalizing...${NC}"

# Add ubuntu user to gpio groups if they exist
usermod -a -G gpio ubuntu 2>/dev/null || true
usermod -a -G dialout ubuntu 2>/dev/null || true

# Reload systemd
systemctl daemon-reload

# Create data and logs directories
mkdir -p /home/ubuntu/discord-bot/data
mkdir -p /home/ubuntu/discord-bot/logs
chown -R ubuntu:ubuntu /home/ubuntu/discord-bot

# Set permissions for GPIO access
chmod 644 /sys/class/gpio/*/value 2>/dev/null || true

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Setup Instructions:${NC}"
echo ""
echo "1. Create a .env file with your Discord token:"
echo "   nano /home/ubuntu/discord-bot/.env"
echo ""
echo "2. Add your bot configuration (TOKEN, OWNER_ID, etc.)"
echo ""
echo "3. Enable and start the services:"
echo "   sudo systemctl enable ${SERVICE_NAME}.service"
echo "   sudo systemctl enable ${LED_SERVICE_NAME}.service"
echo "   sudo systemctl start ${SERVICE_NAME}.service"
echo "   sudo systemctl start ${LED_SERVICE_NAME}.service"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo "   sudo systemctl status ${SERVICE_NAME}"
echo "   sudo systemctl status ${LED_SERVICE_NAME}"
echo "   sudo journalctl -u ${SERVICE_NAME} -f"
echo "   sudo journalctl -u ${LED_SERVICE_NAME} -f"
echo "   sudo systemctl stop ${SERVICE_NAME}"
echo "   sudo systemctl restart ${SERVICE_NAME}"
echo ""
echo -e "${YELLOW}RGB LED Pin Configuration:${NC}"
echo "   Pin 11 (GPIO 17) → Red"
echo "   Pin 13 (GPIO 27) → Green"
echo "   Pin 15 (GPIO 22) → Blue"
echo "   Pin 14 (GND)     → Ground"
echo ""
echo -e "${GREEN}Ready to run!${NC}"
