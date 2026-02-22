#!/bin/bash
# DarkLock - Deploy latest changes to Pi5
# Usage: bash scripts/deploy-to-pi5.sh [pi5-host]
# Example: bash scripts/deploy-to-pi5.sh cayden@darklock.local

set -e

PI_HOST="${1:-darklock@darklock.local}"
APP_DIR="/home/cayden/discord bot/discord bot"
REMOTE_DIR="/mnt/nvme/discord-bot"

echo "=========================================="
echo "  Deploying to Pi5: $PI_HOST"
echo "=========================================="

# Copy SSH key to Pi5 for passwordless future deploys (runs once)
echo ""
echo "Step 1: Setting up passwordless SSH (if not already done)..."
ssh-copy-id "$PI_HOST" 2>/dev/null && echo "  ✓ SSH key copied" || echo "  ✓ SSH key already present (or skipping)"

echo ""
echo "Step 2: Pulling latest code on Pi5..."
ssh "$PI_HOST" bash << 'REMOTE'
set -e
APP="/mnt/nvme/discord-bot"
cd "$APP"

echo "  Current branch: $(git branch --show-current)"
echo "  Fetching latest..."
git fetch origin

echo "  Resetting to origin/main..."
git reset --hard origin/main

echo "  Cleaning untracked files (excluding data/, logs/, .env)..."
git clean -fd --exclude=data/ --exclude=logs/ --exclude=.env

echo "  Installing/updating npm dependencies..."
npm install --production --silent

echo "  ✓ Code updated"
REMOTE

echo ""
echo "Step 3: Installing systemd auto-start services..."
ssh "$PI_HOST" bash << 'REMOTE'
APP="/mnt/nvme/discord-bot"
cd "$APP"
# Install service files directly (correct paths for darklock user)
cp /tmp/darklock-platform.service /etc/systemd/system/darklock-platform.service 2>/dev/null || true
cp /tmp/darklock-bot.service /etc/systemd/system/darklock-bot.service 2>/dev/null || true
echo "0131106761Cb" | sudo -S systemctl daemon-reload 2>/dev/null || true
echo "0131106761Cb" | sudo -S systemctl enable darklock-platform darklock-bot 2>/dev/null || true
echo "  ✓ Services enabled"
REMOTE

echo ""
echo "Step 4: Restarting services..."
ssh "$PI_HOST" bash << 'REMOTE'
# Try systemd first, fallback to manual restart
if systemctl is-enabled darklock-bot.service &>/dev/null; then
    echo "  Restarting via systemd..."
    sudo systemctl restart darklock-platform.service
    sleep 2
    sudo systemctl restart darklock-bot.service
    sleep 3
    echo ""
    echo "  Service status:"
    systemctl is-active darklock-platform.service && echo "  ✓ darklock-platform: running" || echo "  ✗ darklock-platform: stopped"
    systemctl is-active darklock-bot.service && echo "  ✓ darklock-bot: running" || echo "  ✗ darklock-bot: stopped"
else
    echo "  Systemd not set up yet — restarting manually..."
    APP="/mnt/nvme/discord-bot"
    pkill -f "node src/bot.js" 2>/dev/null || true
    pkill -f "node darklock/start.js" 2>/dev/null || true
    sleep 2
    cd "$APP"
    node darklock/start.js >> logs/darklock-startup.log 2>&1 &
    sleep 2
    node src/bot.js >> logs/bot.log 2>&1 &
    sleep 4
    pgrep -f "node darklock/start.js" && echo "  ✓ Platform running" || echo "  ✗ Platform failed"
    pgrep -f "node src/bot.js" && echo "  ✓ Bot running" || echo "  ✗ Bot failed"
fi
REMOTE

echo ""
echo "=========================================="
echo "  Deploy complete!"
echo "=========================================="
echo ""
echo "Pi5 access points:"
echo "  Bot dashboard:      http://darklock.local:3001"
echo "  Darklock platform:  http://darklock.local:3002"
echo ""
echo "SSH to Pi5 and watch logs:"
echo "  ssh $PI_HOST"
echo "  journalctl -u darklock-bot -f"
echo "  tail -f /mnt/nvme/discord-bot/logs/bot.log"
echo ""
