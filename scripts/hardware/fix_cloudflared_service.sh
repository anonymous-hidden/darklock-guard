#!/bin/bash
# Fix Cloudflare Tunnel service installation

echo "=== Fixing Cloudflare Tunnel Service ==="
echo ""

# Stop any running instances
sudo pkill cloudflared 2>/dev/null || true

# Install cloudflared service properly
echo "[1/3] Installing cloudflared service..."
sudo cloudflared --config /home/ubuntu/.cloudflared/config.yml service install

# Fix permissions
echo "[2/3] Setting permissions..."
sudo chown -R ubuntu:ubuntu /home/ubuntu/.cloudflared
sudo chmod 600 /home/ubuntu/.cloudflared/*.json
sudo chmod 600 /home/ubuntu/.cloudflared/cert.pem

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
echo "[3/3] Starting service..."
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

sleep 3

echo ""
echo "=== Service Status ==="
sudo systemctl status cloudflared --no-pager -l

echo ""
echo "=== Recent Logs ==="
sudo journalctl -u cloudflared -n 30 --no-pager

echo ""
echo "If tunnel is connected, test at: https://darklock.net"
