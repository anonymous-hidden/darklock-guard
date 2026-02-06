#!/bin/bash
# Run Cloudflare Tunnel directly (no systemd)

echo "=== Starting Cloudflare Tunnel ==="
echo ""

cd /home/ubuntu/.cloudflared

# Kill any existing cloudflared processes
sudo pkill cloudflared 2>/dev/null || true

echo "Starting tunnel in foreground..."
echo "Press Ctrl+C to stop"
echo ""
echo "Once you see 'Registered tunnel connection', open https://darklock.net"
echo ""

/usr/bin/cloudflared --config /home/ubuntu/.cloudflared/config.yml tunnel run
