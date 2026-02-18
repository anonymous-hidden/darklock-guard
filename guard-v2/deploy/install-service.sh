#!/usr/bin/env bash
# install-service.sh — Install Darklock Guard as a systemd service on Linux.
set -euo pipefail

BINARY_SRC="${1:-./target/release/guard-service}"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/darklock"
SERVICE_FILE="darklock-guard.service"

echo "=== Darklock Guard Service Installer ==="

# 1. Install binary
echo "[1/4] Installing binary to $INSTALL_DIR ..."
sudo install -m 0755 "$BINARY_SRC" "$INSTALL_DIR/guard-service"

# 2. Create data directory
echo "[2/4] Creating data directory at $DATA_DIR ..."
sudo mkdir -p "$DATA_DIR"
sudo chmod 0700 "$DATA_DIR"

# 3. Install systemd unit
echo "[3/4] Installing systemd unit ..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sudo cp "$SCRIPT_DIR/$SERVICE_FILE" /etc/systemd/system/
sudo systemctl daemon-reload

# 4. Enable and (optionally) start
echo "[4/4] Enabling service ..."
sudo systemctl enable darklock-guard.service

echo ""
echo "Service installed. Before starting, initialize the vault:"
echo "  sudo guard-service init --data-dir $DATA_DIR"
echo ""
echo "Then start the service:"
echo "  sudo systemctl start darklock-guard"
echo "  sudo journalctl -u darklock-guard -f"
