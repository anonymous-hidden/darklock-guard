#!/bin/bash
# Deploy Pico Guild Display System to Pi5

set -e

# Configuration
PI_IP="${1:-192.168.50.2}"
PI_USER="ubuntu"
PI_PASSWORD="0131106761Cb"
BOT_DIR="/home/ubuntu/discord-bot"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Pico Guild Display Deployment Script                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Target: ${PI_USER}@${PI_IP}${NC}"
echo -e "${YELLOW}Bot Directory: ${BOT_DIR}${NC}"
echo ""

# Check if sshpass is installed (for password authentication)
if ! command -v sshpass &> /dev/null; then
    echo -e "${YELLOW}Installing sshpass for password authentication...${NC}"
    sudo apt-get update -qq && sudo apt-get install -y sshpass
fi

# Function to run SSH commands with password
ssh_cmd() {
    sshpass -p "${PI_PASSWORD}" ssh -o StrictHostKeyChecking=no ${PI_USER}@${PI_IP} "$@"
}

# Function to copy files with password
scp_copy() {
    sshpass -p "${PI_PASSWORD}" scp -o StrictHostKeyChecking=no -r "$@"
}

echo -e "${BLUE}[1/8] Testing connection to Pi5...${NC}"
if ssh_cmd "echo 'Connected successfully'"; then
    echo -e "${GREEN}✓ Connection successful${NC}"
else
    echo -e "${RED}✗ Failed to connect to Pi5${NC}"
    echo "Please check:"
    echo "  - Pi5 is powered on and connected to network"
    echo "  - IP address is correct: ${PI_IP}"
    echo "  - Password is correct"
    exit 1
fi
echo ""

echo -e "${BLUE}[2/8] Creating directories on Pi5...${NC}"
ssh_cmd "mkdir -p ${BOT_DIR}/hardware/pico_guild_display ${BOT_DIR}/src/hardware ${BOT_DIR}/data"
echo -e "${GREEN}✓ Directories created${NC}"
echo ""

echo -e "${BLUE}[3/8] Uploading Pico firmware...${NC}"
scp_copy "hardware/pico_guild_display/main.py" \
         "${PI_USER}@${PI_IP}:${BOT_DIR}/hardware/pico_guild_display/"
echo -e "${GREEN}✓ Pico firmware uploaded${NC}"
echo ""

echo -e "${BLUE}[4/8] Uploading bridge script...${NC}"
scp_copy "hardware/pico_guild_display/pico_bridge.py" \
         "hardware/pico_guild_display/test_display.py" \
         "hardware/pico_guild_display/install.sh" \
         "${PI_USER}@${PI_IP}:${BOT_DIR}/hardware/pico_guild_display/"
echo -e "${GREEN}✓ Bridge scripts uploaded${NC}"
echo ""

echo -e "${BLUE}[5/8] Uploading documentation...${NC}"
scp_copy "hardware/pico_guild_display/README.md" \
         "hardware/pico_guild_display/WIRING.txt" \
         "hardware/pico_guild_display/QUICKSTART.txt" \
         "${PI_USER}@${PI_IP}:${BOT_DIR}/hardware/pico_guild_display/"
echo -e "${GREEN}✓ Documentation uploaded${NC}"
echo ""

echo -e "${BLUE}[6/8] Uploading bot status writer...${NC}"
scp_copy "src/hardware/statusWriter.js" \
         "${PI_USER}@${PI_IP}:${BOT_DIR}/src/hardware/"
echo -e "${GREEN}✓ Status writer uploaded${NC}"
echo ""

echo -e "${BLUE}[7/8] Updating bot ready event...${NC}"
scp_copy "src/events/ready.js" \
         "${PI_USER}@${PI_IP}:${BOT_DIR}/src/events/"
echo -e "${GREEN}✓ Bot event updated${NC}"
echo ""

echo -e "${BLUE}[8/8] Installing Python dependencies on Pi5...${NC}"
ssh_cmd "pip3 install pyserial requests --break-system-packages 2>/dev/null || pip3 install pyserial requests"
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Files Deployed Successfully! ✓                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                   NEXT STEPS                                  ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Step 1: Upload MicroPython code to Pico${NC}"
echo "  You can do this from your local machine or the Pi5:"
echo ""
echo "  ${YELLOW}Option A - From Pi5 using ampy:${NC}"
echo "    ssh ubuntu@${PI_IP}"
echo "    pip3 install adafruit-ampy --break-system-packages"
echo "    ampy --port /dev/ttyACM0 put ${BOT_DIR}/hardware/pico_guild_display/main.py /main.py"
echo ""
echo "  ${YELLOW}Option B - From Pi5 using Thonny:${NC}"
echo "    1. Install GUI: sudo apt-get install thonny"
echo "    2. Use VNC/HDMI to access Pi5 desktop"
echo "    3. Open Thonny → Open main.py → Save to Pico"
echo ""
echo "  ${YELLOW}Option C - From your local machine:${NC}"
echo "    1. Download main.py from Pi5"
echo "    2. Use Thonny on your local machine to upload to Pico"
echo ""
echo -e "${BLUE}Step 2: Run installation script on Pi5${NC}"
echo "  ${GREEN}ssh ubuntu@${PI_IP} << 'EOF'${NC}"
echo "  cd ${BOT_DIR}/hardware/pico_guild_display"
echo "  chmod +x install.sh"
echo "  sudo ./install.sh"
echo "  ${GREEN}EOF${NC}"
echo ""
echo -e "${BLUE}Step 3: Start the bridge service${NC}"
echo "  ${GREEN}ssh ubuntu@${PI_IP} 'sudo systemctl start pico-guild-display'${NC}"
echo ""
echo -e "${BLUE}Step 4: Restart the Discord bot${NC}"
echo "  ${GREEN}ssh ubuntu@${PI_IP} 'sudo systemctl restart discord-bot'${NC}"
echo ""
echo -e "${BLUE}Step 5: Check everything is working${NC}"
echo "  ${GREEN}ssh ubuntu@${PI_IP} 'sudo systemctl status pico-guild-display discord-bot'${NC}"
echo "  ${GREEN}ssh ubuntu@${PI_IP} 'journalctl -u pico-guild-display -f'${NC}"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Would you like me to run these steps automatically? (requires Pico already flashed)${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop, or Enter to continue with automatic setup...${NC}"
read -r

echo ""
echo -e "${BLUE}Running automatic setup...${NC}"
echo ""

# Check if Pico is connected
echo -e "${BLUE}Checking for Pico connection...${NC}"
PICO_CHECK=$(ssh_cmd "ls /dev/ttyACM0 2>/dev/null || ls /dev/ttyUSB0 2>/dev/null || echo 'NOT_FOUND'")

if [ "$PICO_CHECK" == "NOT_FOUND" ]; then
    echo -e "${RED}✗ Pico not detected on Pi5${NC}"
    echo "Please connect your Pico via USB to the Pi5"
    echo ""
    echo "After connecting, you can manually run:"
    echo "  ssh ubuntu@${PI_IP}"
    echo "  cd ${BOT_DIR}/hardware/pico_guild_display"
    echo "  sudo ./install.sh"
    exit 1
else
    echo -e "${GREEN}✓ Pico detected at ${PICO_CHECK}${NC}"
fi
echo ""

# Make install script executable and run it
echo -e "${BLUE}Running installation on Pi5...${NC}"
ssh_cmd "cd ${BOT_DIR}/hardware/pico_guild_display && chmod +x install.sh"
echo ""
echo -e "${YELLOW}You'll need to manually upload the Pico firmware using Thonny or ampy.${NC}"
echo -e "${YELLOW}Press Enter when you've uploaded main.py to your Pico...${NC}"
read -r

# Enable and start service
echo -e "${BLUE}Starting bridge service...${NC}"
ssh_cmd "sudo systemctl daemon-reload"
ssh_cmd "sudo systemctl enable pico-guild-display" || true
ssh_cmd "sudo systemctl start pico-guild-display" || true
sleep 2
echo ""

# Check service status
echo -e "${BLUE}Checking service status...${NC}"
ssh_cmd "sudo systemctl status pico-guild-display --no-pager -l" || true
echo ""

# Restart bot
echo -e "${BLUE}Restarting Discord bot...${NC}"
ssh_cmd "sudo systemctl restart discord-bot"
sleep 3
echo ""

# Final status check
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Deployment Complete! ✓                             ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Service Status:${NC}"
ssh_cmd "sudo systemctl is-active discord-bot pico-guild-display" || true
echo ""

echo -e "${BLUE}Recent Logs:${NC}"
ssh_cmd "sudo journalctl -u pico-guild-display -n 10 --no-pager" || true
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Your display should now be showing your bot's server count!"
echo ""
echo "Monitor logs with:"
echo "  ${YELLOW}ssh ubuntu@${PI_IP} 'sudo journalctl -u pico-guild-display -f'${NC}"
echo ""
echo "Check bot status file:"
echo "  ${YELLOW}ssh ubuntu@${PI_IP} 'cat ${BOT_DIR}/data/bot_status.json'${NC}"
echo ""
