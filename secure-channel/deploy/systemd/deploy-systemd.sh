#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-systemd.sh — Install Darklock Secure Channel systemd services
#
# Usage: sudo bash deploy/systemd/deploy-systemd.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══ Darklock Secure Channel — Systemd Deployment ═══"

# Create darklock user if it doesn't exist
if ! id -u darklock &>/dev/null; then
    echo "→ Creating 'darklock' system user..."
    useradd --system --no-create-home --shell /usr/sbin/nologin darklock
fi

# Create directories
echo "→ Creating directories..."
mkdir -p /opt/darklock/secure-channel
mkdir -p /opt/darklock/caddy-data
mkdir -p /etc/darklock

# Copy service files
echo "→ Installing systemd unit files..."
cp "${SCRIPT_DIR}/dl-ids.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/dl-rly.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/dl-caddy.service" /etc/systemd/system/

# Reload systemd
echo "→ Reloading systemd daemon..."
systemctl daemon-reload

# Create default env files if they don't exist
for svc in ids rly caddy; do
    if [ ! -f "/etc/darklock/${svc}.env" ]; then
        echo "→ Creating /etc/darklock/${svc}.env..."
        touch "/etc/darklock/${svc}.env"
        chmod 600 "/etc/darklock/${svc}.env"
    fi
done

# Generate JWT_SECRET if not already set
if ! grep -q JWT_SECRET /etc/darklock/ids.env 2>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    echo "JWT_SECRET=${SECRET}" >> /etc/darklock/ids.env
    echo "JWT_SECRET=${SECRET}" >> /etc/darklock/rly.env
    echo "→ Generated JWT_SECRET"
fi

echo ""
echo "✓ Services installed. Enable and start with:"
echo "  sudo systemctl enable --now dl-ids dl-rly dl-caddy"
echo ""
echo "  Check status: systemctl status dl-ids dl-rly dl-caddy"
echo "  View logs:    journalctl -u dl-ids -f"
