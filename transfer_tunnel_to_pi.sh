#!/bin/bash
# Transfer Cloudflare credentials to Pi and start tunnel

TUNNEL_ID="aa269442-1a8a-4485-8423-bbd64c36ff59"
PI_IP="$1"

if [ -z "$PI_IP" ]; then
    echo "Usage: $0 <pi-ip-address>"
    echo "Example: $0 192.168.50.2"
    exit 1
fi

echo "=== Transferring Cloudflare Tunnel to Pi ==="
echo ""

# Create credentials transfer package
cd ~/.cloudflared
tar -czf /tmp/cloudflared-creds.tar.gz cert.pem ${TUNNEL_ID}.json config.yml

echo "Transferring files to Pi..."
cat /tmp/cloudflared-creds.tar.gz | ssh ubuntu@${PI_IP} "cat > /tmp/cloudflared-creds.tar.gz"

echo "Setting up on Pi..."
ssh ubuntu@${PI_IP} << 'EOFPI'
set -e

# Install cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i cloudflared-linux-arm64.deb
    rm cloudflared-linux-arm64.deb
fi

# Extract credentials
mkdir -p ~/.cloudflared
cd ~/.cloudflared
tar -xzf /tmp/cloudflared-creds.tar.gz
rm /tmp/cloudflared-creds.tar.gz

echo "✅ Credentials installed"

# Install as service
echo "Installing cloudflared service..."
sudo cloudflared service install

# Enable and start
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

sleep 3

echo ""
echo "🎉 Tunnel Status:"
sudo systemctl status cloudflared --no-pager

echo ""
echo "=== darklock.net is now LIVE! ==="
echo ""
echo "  🌐 https://darklock.net"
echo "  🌐 https://www.darklock.net"
echo "  📊 https://xp.darklock.net"
echo "  🔌 https://api.darklock.net"
echo ""
echo "📝 Logs: sudo journalctl -u cloudflared -f"
EOFPI

rm /tmp/cloudflared-creds.tar.gz

echo ""
echo "✅ Setup complete!"
