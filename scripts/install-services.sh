#!/bin/bash
# DarkLock - Install & Enable Systemd Auto-Start Services
# Run with: sudo bash scripts/install-services.sh

set -e

SERVICE_DIR="/etc/systemd/system"
APP_DIR="/home/cayden/discord bot/discord bot"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "=========================================="
echo "  DarkLock - Installing Systemd Services"
echo "=========================================="
echo ""

# Must be run as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root: sudo bash scripts/install-services.sh"
    exit 1
fi

USER_NAME="cayden"
NODE_BIN="$(which node || echo /usr/bin/node)"

echo "Node.js path: $NODE_BIN"
echo "App directory: $APP_DIR"
echo ""

# Ensure log directory exists with correct permissions
mkdir -p "$APP_DIR/logs"
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR/logs"

# ---- darklock-platform.service ----
echo "Installing darklock-platform.service..."
cat > "$SERVICE_DIR/darklock-platform.service" << EOF
[Unit]
Description=DarkLock Platform Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN darklock/start.js
Restart=on-failure
RestartSec=10
StandardOutput=append:$APP_DIR/logs/darklock-startup.log
StandardError=append:$APP_DIR/logs/darklock-startup.log
Environment=NODE_ENV=production
EnvironmentFile=$APP_DIR/.env
MemoryMax=512M
CPUQuota=150%

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ darklock-platform.service installed"

# ---- darklock-bot.service ----
echo "Installing darklock-bot.service..."
cat > "$SERVICE_DIR/darklock-bot.service" << EOF
[Unit]
Description=DarkLock Discord Bot
After=network-online.target darklock-platform.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStartPre=/bin/bash -c '$NODE_BIN file-protection/agent/baseline-generator.js || true'
ExecStart=$NODE_BIN src/bot.js
Restart=on-failure
RestartSec=10
StandardOutput=append:$APP_DIR/logs/bot.log
StandardError=append:$APP_DIR/logs/bot.log
Environment=NODE_ENV=production
EnvironmentFile=$APP_DIR/.env
MemoryMax=512M
CPUQuota=150%

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ darklock-bot.service installed"

# Reload systemd daemon
echo ""
echo "Reloading systemd daemon..."
systemctl daemon-reload
echo "  ✓ daemon reloaded"

# Enable services for auto-start on boot
echo ""
echo "Enabling services for auto-start..."
systemctl enable darklock-platform.service
echo "  ✓ darklock-platform enabled"
systemctl enable darklock-bot.service
echo "  ✓ darklock-bot enabled"

echo ""
echo "=========================================="
echo "  Services installed & enabled!"
echo "=========================================="
echo ""
echo "Useful commands:"
echo "  sudo systemctl start darklock-platform    # Start platform"
echo "  sudo systemctl start darklock-bot         # Start bot"
echo "  sudo systemctl stop darklock-bot          # Stop bot"
echo "  sudo systemctl status darklock-bot        # Check status"
echo "  journalctl -u darklock-bot -f             # Follow bot logs"
echo "  journalctl -u darklock-platform -f        # Follow platform logs"
echo ""
echo "Or run the start script to start everything now:"
echo "  ./start-all.sh"
echo ""
