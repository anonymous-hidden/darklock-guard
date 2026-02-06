#!/bin/bash
# Comprehensive bot diagnostic

echo "=== Discord Bot Diagnostic ==="
echo ""

echo "1. Checking .env configuration..."
if [ -f "/home/ubuntu/discord-bot/.env" ]; then
    if grep -q "your_token_here\|DISCORD_TOKEN=$" /home/ubuntu/discord-bot/.env; then
        echo "❌ DISCORD_TOKEN not configured in .env"
        echo "   Edit: nano /home/ubuntu/discord-bot/.env"
        exit 1
    else
        echo "✅ .env file has token configured"
    fi
else
    echo "❌ .env file missing"
    exit 1
fi

echo ""
echo "2. Testing DNS resolution..."
nslookup discord.com 2>&1 | head -10

echo ""
echo "3. Testing Discord API connectivity..."
curl -v --connect-timeout 5 https://discord.com/api/v10/gateway 2>&1 | grep -E "Connected|HTTP|failed|error" | head -10

echo ""
echo "4. Checking resolv.conf..."
cat /etc/resolv.conf

echo ""
echo "5. Checking systemd-resolved status..."
systemctl status systemd-resolved --no-pager | head -15

echo ""
echo "6. Testing with different DNS..."
echo "Trying with 8.8.8.8..."
nslookup discord.com 8.8.8.8

echo ""
echo "7. Current bot logs (last 40 lines)..."
sudo journalctl -u discord-bot.service -n 40 --no-pager | grep -v "Loaded command"

echo ""
echo "8. Checking Node.js and npm..."
echo "Node: $(node --version)"
echo "npm: $(npm --version)"

echo ""
echo "9. Checking if discord.js is installed..."
if [ -f "/home/ubuntu/discord-bot/node_modules/discord.js/package.json" ]; then
    echo "✅ discord.js installed: $(cat /home/ubuntu/discord-bot/node_modules/discord.js/package.json | grep '"version"' | head -1)"
else
    echo "❌ discord.js not installed"
    echo "Running npm install..."
    cd /home/ubuntu/discord-bot
    npm install
fi

echo ""
echo "10. Testing direct connection to Discord gateway..."
curl -s https://discord.com/api/v10/gateway | python3 -m json.tool 2>/dev/null || echo "❌ Cannot reach Discord API"

echo ""
echo "=== Attempting Fix ==="
echo "Stopping bot..."
sudo systemctl stop discord-bot.service

echo "Fixing DNS permanently..."
sudo rm -f /etc/resolv.conf
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
sudo mkdir -p /etc/systemd/resolved.conf.d/
cat << 'EOF' | sudo tee /etc/systemd/resolved.conf.d/dns.conf
[Resolve]
DNS=8.8.8.8 1.1.1.1 8.8.4.4
FallbackDNS=1.0.0.1
LLMNR=no
MulticastDNS=no
EOF

sudo systemctl restart systemd-resolved

echo "Waiting for DNS to stabilize..."
sleep 2

echo "Testing DNS after fix..."
resolvectl status | head -20

echo ""
echo "Starting bot..."
sudo systemctl start discord-bot.service

echo "Waiting 5 seconds..."
sleep 5

echo ""
echo "=== Final Bot Logs ==="
sudo journalctl -u discord-bot.service -n 30 --no-pager

echo ""
echo "=== Watch live logs with: ==="
echo "sudo journalctl -u discord-bot.service -f"
