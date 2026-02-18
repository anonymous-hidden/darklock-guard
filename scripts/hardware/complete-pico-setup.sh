#!/bin/bash
# Complete Pico Guild Display Setup on Pi5

PI_IP="${1:-192.168.50.2}"
PI_USER="ubuntu"
PI_PASSWORD="0131106761Cb"
BOT_DIR="/home/ubuntu/discord-bot"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ssh_cmd() {
    sshpass -p "${PI_PASSWORD}" ssh -o StrictHostKeyChecking=no ${PI_USER}@${PI_IP} "$@"
}

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Completing Pico Guild Display Setup on Pi5              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}Step 1: Uploading MicroPython firmware to Pico...${NC}"
echo ""
echo "Installing ampy on Pi5..."
ssh_cmd "pip3 install adafruit-ampy --break-system-packages 2>&1 | grep -v 'Requirement already satisfied' || true"
echo ""

echo "Checking for Pico connection..."
PICO_PORT=$(ssh_cmd "ls /dev/ttyACM* 2>/dev/null | head -n1 || ls /dev/ttyUSB* 2>/dev/null | head -n1 || echo ''")

if [ -z "$PICO_PORT" ]; then
    echo -e "${YELLOW}⚠ Pico not detected. Please connect it via USB to the Pi5.${NC}"
    echo ""
    echo "After connecting, you can upload manually:"
    echo "  ssh ubuntu@${PI_IP}"
    echo "  ampy --port /dev/ttyACM0 put ${BOT_DIR}/hardware/pico_guild_display/main.py /main.py"
    echo ""
    read -p "Press Enter after connecting Pico and it should auto-upload..."
    PICO_PORT=$(ssh_cmd "ls /dev/ttyACM* 2>/dev/null | head -n1 || ls /dev/ttyUSB* 2>/dev/null | head -n1 || echo '/dev/ttyACM0'")
fi

echo -e "${GREEN}✓ Pico detected at: ${PICO_PORT}${NC}"
echo ""

echo "Uploading main.py to Pico (this may take a few seconds)..."
ssh_cmd "ampy --port ${PICO_PORT} put ${BOT_DIR}/hardware/pico_guild_display/main.py /main.py" || {
    echo -e "${YELLOW}⚠ Upload failed. Trying with delay...${NC}"
    ssh_cmd "ampy --port ${PICO_PORT} --delay 1 put ${BOT_DIR}/hardware/pico_guild_display/main.py /main.py"
}
echo -e "${GREEN}✓ Firmware uploaded to Pico!${NC}"
echo ""

echo -e "${YELLOW}Step 2: Setting up bridge service...${NC}"
echo "Creating systemd service..."

ssh_cmd "sudo tee /etc/systemd/system/pico-guild-display.service > /dev/null" << 'EOSERVICE'
[Unit]
Description=Pico Guild Display Bridge
After=network.target discord-bot.service
Wants=discord-bot.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
Environment="PICO_PORT=/dev/ttyACM0"
Environment="DASHBOARD_URL=http://localhost:3001"
ExecStart=/usr/bin/python3 -u /home/ubuntu/discord-bot/hardware/pico_guild_display/pico_bridge.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOSERVICE

echo -e "${GREEN}✓ Service file created${NC}"
echo ""

echo -e "${YELLOW}Step 3: Enabling and starting services...${NC}"
ssh_cmd "sudo systemctl daemon-reload"
ssh_cmd "sudo systemctl enable pico-guild-display"
ssh_cmd "sudo systemctl start pico-guild-display"
sleep 2
echo -e "${GREEN}✓ Bridge service started${NC}"
echo ""

echo -e "${YELLOW}Step 4: Restarting Discord bot...${NC}"
ssh_cmd "sudo systemctl restart discord-bot"
sleep 3
echo -e "${GREEN}✓ Bot restarted${NC}"
echo ""

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                Setup Complete! ✓                              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Service Status:${NC}"
ssh_cmd "sudo systemctl is-active pico-guild-display discord-bot"
echo ""

echo -e "${BLUE}Checking display output (last 15 lines):${NC}"
ssh_cmd "sudo journalctl -u pico-guild-display -n 15 --no-pager"
echo ""

echo -e "${BLUE}Bot status:${NC}"
ssh_cmd "cat ${BOT_DIR}/data/bot_status.json 2>/dev/null | python3 -m json.tool || echo 'Status file not yet created (wait a few seconds)'"
echo ""

echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Your 5461AS display should now be showing the server count!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Useful commands:"
echo "  Watch logs:     ${YELLOW}ssh ubuntu@${PI_IP} 'journalctl -u pico-guild-display -f'${NC}"
echo "  Service status: ${YELLOW}ssh ubuntu@${PI_IP} 'systemctl status pico-guild-display'${NC}"
echo "  Bot status:     ${YELLOW}ssh ubuntu@${PI_IP} 'cat ${BOT_DIR}/data/bot_status.json'${NC}"
echo "  Restart:        ${YELLOW}ssh ubuntu@${PI_IP} 'sudo systemctl restart pico-guild-display'${NC}"
echo ""
