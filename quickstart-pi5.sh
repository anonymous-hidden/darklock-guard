#!/bin/bash

#############################################################################
# Quick Start Script - Run after installation
#############################################################################

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BOT_DIR="/home/ubuntu/discord-bot"
ENV_FILE="$BOT_DIR/.env"

echo -e "${BLUE}Discord Bot Quick Start${NC}"
echo ""

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}No .env file found. Creating one...${NC}"
    echo ""
    echo "Enter your Discord Bot Token:"
    read -s BOT_TOKEN
    echo ""
    echo "Enter your Discord User ID (Owner):"
    read OWNER_ID
    echo ""
    
    cat > "$ENV_FILE" << EOF
# Discord Bot Configuration
DISCORD_TOKEN=$BOT_TOKEN
OWNER_ID=$OWNER_ID

# Database
DATABASE_URL=sqlite:///$BOT_DIR/data/bot.db

# Server settings
PORT=3001
WEB_PORT=3001
DASHBOARD_PORT=3001
ENABLE_WEB_DASHBOARD=true
XP_DASHBOARD_PORT=3007
NODE_ENV=production

# Add more configuration as needed
EOF
    
    chmod 600 "$ENV_FILE"
    chown ubuntu:ubuntu "$ENV_FILE"
    echo -e "${GREEN}.env file created${NC}"
else
    echo -e "${GREEN}.env file already exists${NC}"
fi

echo ""
echo -e "${YELLOW}Starting services...${NC}"
sudo systemctl enable discord-bot.service
sudo systemctl enable hardware-controller.service
sudo systemctl start discord-bot.service
sudo systemctl start hardware-controller.service

echo ""
echo -e "${GREEN}Services started!${NC}"
echo ""
echo "Check status:"
echo "  sudo systemctl status discord-bot"
echo "  sudo systemctl status hardware-controller"
echo ""
echo "View logs:"
echo "  sudo journalctl -u discord-bot -f"
echo "  sudo journalctl -u hardware-controller -f"
