#!/bin/bash
# Manually create cloudflared service

echo "=== Creating Cloudflared Service Manually ==="
echo ""

# Stop any running instances
sudo pkill cloudflared 2>/dev/null || true

# Create systemd service file
echo "[1/2] Creating service file..."
sudo tee /etc/systemd/system/cloudflared.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/cloudflared --config /home/ubuntu/.cloudflared/config.yml --no-autoupdate tunnel run
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Service file created"

# Reload systemd
echo "[2/2] Starting service..."
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

sleep 3

echo ""
echo "=== Service Status ==="
sudo systemctl status cloudflared --no-pager -l

echo ""
echo "=== Connection Logs ==="
sudo journalctl -u cloudflared -n 20 --no-pager | grep -E "Registered|connection|error|started"

echo ""
echo "Watch live: sudo journalctl -u cloudflared -f"
