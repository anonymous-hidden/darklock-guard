#!/bin/bash
# Setup Cloudflare Tunnel for Darklock Bot on Pi5

echo "=== Cloudflare Tunnel Setup for Raspberry Pi 5 ==="
echo ""
echo "This will:"
echo "  1. Install cloudflared"
echo "  2. Authenticate with Cloudflare"
echo "  3. Create a tunnel"
echo "  4. Route your domain to the Pi"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Install cloudflared
echo "[1/5] Installing cloudflared..."
if ! command -v cloudflared &> /dev/null; then
    # Download latest cloudflared for ARM64
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    dpkg -i cloudflared-linux-arm64.deb
    rm cloudflared-linux-arm64.deb
    echo "✅ cloudflared installed"
else
    echo "✅ cloudflared already installed"
fi

echo ""
echo "[2/5] Authenticate with Cloudflare..."
echo ""
echo "A browser window will open. Log in to Cloudflare and authorize the tunnel."
echo "Press Enter when ready..."
read

sudo -u ubuntu cloudflared tunnel login

if [ ! -f "/home/ubuntu/.cloudflared/cert.pem" ]; then
    echo "❌ Authentication failed. Make sure you completed the login in the browser."
    exit 1
fi

echo "✅ Authenticated with Cloudflare"

echo ""
echo "[3/5] Creating tunnel..."
echo "Enter a name for your tunnel (e.g., darklock-pi5):"
read TUNNEL_NAME

sudo -u ubuntu cloudflared tunnel create "$TUNNEL_NAME"

# Get tunnel ID
TUNNEL_ID=$(sudo -u ubuntu cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')

if [ -z "$TUNNEL_ID" ]; then
    echo "❌ Failed to create tunnel"
    exit 1
fi

echo "✅ Tunnel created: $TUNNEL_ID"

echo ""
echo "[4/5] Configure tunnel routing..."
echo ""
echo "Enter your domain (e.g., bot.yourdomain.com):"
read DOMAIN

# Create config file
cat > /home/ubuntu/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /home/ubuntu/.cloudflared/${TUNNEL_ID}.json

ingress:
  # Main Darklock Platform Dashboard
  - hostname: $DOMAIN
    service: http://localhost:3001
    originRequest:
      noTLSVerify: true
  
  # XP Leaderboard Dashboard
  - hostname: xp.$DOMAIN
    service: http://localhost:3007
    originRequest:
      noTLSVerify: true
  
  # Fallback - catch all other traffic
  - service: http_status:404
EOF

chown ubuntu:ubuntu /home/ubuntu/.cloudflared/config.yml

echo "✅ Configuration created"

echo ""
echo "[5/5] Setting up DNS and starting tunnel..."

# Route DNS
sudo -u ubuntu cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"
sudo -u ubuntu cloudflared tunnel route dns "$TUNNEL_NAME" "xp.$DOMAIN"

echo "✅ DNS configured"

# Install as system service
cloudflared service install

# Start the service
systemctl enable cloudflared
systemctl start cloudflared

sleep 2

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Your bot is now accessible at:"
echo "  🌐 Main Dashboard: https://$DOMAIN"
echo "  📊 XP Leaderboard: https://xp.$DOMAIN"
echo ""
echo "Tunnel Status:"
systemctl status cloudflared --no-pager | head -15
echo ""
echo "View tunnel logs: sudo journalctl -u cloudflared -f"
echo ""
echo "⚠️  Note: DNS propagation may take a few minutes"
