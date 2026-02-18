#!/bin/bash
# Setup Cloudflare Tunnel for darklock.net

echo "=== Cloudflare Tunnel Setup for darklock.net ==="
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Install cloudflared
echo "[1/5] Installing cloudflared..."
if ! command -v cloudflared &> /dev/null; then
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    dpkg -i cloudflared-linux-arm64.deb
    rm cloudflared-linux-arm64.deb
    echo "✅ cloudflared installed"
else
    echo "✅ cloudflared already installed"
fi

# Authenticate
echo ""
echo "[2/5] Authenticate with Cloudflare..."
echo ""
echo "A URL will appear. Open it in your browser, log in to Cloudflare,"
echo "and authorize the tunnel."
echo ""
echo "Press Enter to continue..."
read

sudo -u ubuntu cloudflared tunnel login

if [ ! -f "/home/ubuntu/.cloudflared/cert.pem" ]; then
    echo "❌ Authentication failed"
    exit 1
fi

echo "✅ Authenticated"

# Create tunnel
echo ""
echo "[3/5] Creating tunnel 'darklock-pi5'..."
sudo -u ubuntu cloudflared tunnel create darklock-pi5

TUNNEL_ID=$(sudo -u ubuntu cloudflared tunnel list | grep "darklock-pi5" | awk '{print $1}')

if [ -z "$TUNNEL_ID" ]; then
    echo "❌ Failed to create tunnel"
    exit 1
fi

echo "✅ Tunnel created: $TUNNEL_ID"

# Configure tunnel
echo ""
echo "[4/5] Configuring tunnel routes..."

mkdir -p /home/ubuntu/.cloudflared

cat > /home/ubuntu/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /home/ubuntu/.cloudflared/${TUNNEL_ID}.json

ingress:
  # Main Darklock Platform Dashboard
  - hostname: darklock.net
    service: http://localhost:3001
    originRequest:
      noTLSVerify: true
  
  # www subdomain
  - hostname: www.darklock.net
    service: http://localhost:3001
    originRequest:
      noTLSVerify: true
  
  # XP Leaderboard Dashboard
  - hostname: xp.darklock.net
    service: http://localhost:3007
    originRequest:
      noTLSVerify: true
  
  # API endpoint
  - hostname: api.darklock.net
    service: http://localhost:3001
    originRequest:
      noTLSVerify: true
  
  # Catch all
  - service: http_status:404
EOF

chown -R ubuntu:ubuntu /home/ubuntu/.cloudflared
chmod 600 /home/ubuntu/.cloudflared/config.yml

echo "✅ Configuration created"

# Route DNS
echo ""
echo "[5/5] Setting up DNS routes..."

sudo -u ubuntu cloudflared tunnel route dns darklock-pi5 darklock.net
sudo -u ubuntu cloudflared tunnel route dns darklock-pi5 www.darklock.net
sudo -u ubuntu cloudflared tunnel route dns darklock-pi5 xp.darklock.net
sudo -u ubuntu cloudflared tunnel route dns darklock-pi5 api.darklock.net

echo "✅ DNS routes configured"

# Install service
cloudflared service install

# Start service
systemctl enable cloudflared
systemctl start cloudflared

sleep 3

echo ""
echo "🎉 ============================================= 🎉"
echo ""
echo "   Your Darklock bot is now LIVE at:"
echo ""
echo "   🌐 Main Dashboard:  https://darklock.net"
echo "   🌐 WWW:             https://www.darklock.net"
echo "   📊 XP Leaderboard:  https://xp.darklock.net"
echo "   🔌 API:             https://api.darklock.net"
echo ""
echo "🎉 ============================================= 🎉"
echo ""
echo "Tunnel Status:"
systemctl status cloudflared --no-pager | head -15
echo ""
echo "📝 View logs: sudo journalctl -u cloudflared -f"
echo "🔄 Restart:   sudo systemctl restart cloudflared"
echo "⏹️  Stop:      sudo systemctl stop cloudflared"
echo ""
echo "⚠️  DNS may take 1-2 minutes to propagate globally"
