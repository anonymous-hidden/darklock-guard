#!/bin/bash
# Install Cloudflare Tunnel on Pi (run on Pi)

echo "=== Installing Cloudflare Tunnel on darklock.net ==="
echo ""

# Download credentials
echo "[1/4] Downloading credentials..."
curl -sSL http://192.168.50.10:8000/cloudflared-creds.tar.gz -o /tmp/cloudflared-creds.tar.gz

# Install cloudflared
echo "[2/4] Installing cloudflared..."
if ! command -v cloudflared &> /dev/null; then
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i cloudflared-linux-arm64.deb
    rm cloudflared-linux-arm64.deb
    echo "✅ cloudflared installed"
else
    echo "✅ cloudflared already installed"
fi

# Extract credentials
echo "[3/4] Setting up credentials..."
mkdir -p ~/.cloudflared
cd ~/.cloudflared
tar -xzf /tmp/cloudflared-creds.tar.gz
rm /tmp/cloudflared-creds.tar.gz
chmod 600 *.json cert.pem

echo "✅ Credentials installed"

# Install as service
echo "[4/4] Installing and starting service..."
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared

sleep 3

echo ""
echo "🎉 ============================================= 🎉"
echo ""
echo "   darklock.net is now LIVE!"
echo ""
echo "   🌐 Main Dashboard:  https://darklock.net"
echo "   🌐 WWW:             https://www.darklock.net"
echo "   📊 XP Leaderboard:  https://xp.darklock.net"
echo "   🔌 API:             https://api.darklock.net"
echo ""
echo "🎉 ============================================= 🎉"
echo ""

echo "Tunnel Status:"
sudo systemctl status cloudflared --no-pager

echo ""
echo "📝 View logs: sudo journalctl -u cloudflared -f"
echo "🔄 Restart:   sudo systemctl restart cloudflared"
