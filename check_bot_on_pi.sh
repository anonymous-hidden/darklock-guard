#!/bin/bash
# Run this on the Raspberry Pi to check and fix the bot

echo "=== Checking Discord Bot Status ==="
echo ""

# Check if service exists
if ! systemctl list-unit-files | grep -q discord-bot.service; then
    echo "❌ discord-bot.service does not exist!"
    echo ""
    echo "Creating discord-bot.service..."
    
    sudo tee /etc/systemd/system/discord-bot.service > /dev/null << 'EOFSERVICE'
[Unit]
Description=Discord Security Bot (Darklock)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
ExecStart=/usr/bin/node src/bot.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=discord-bot

[Install]
WantedBy=multi-user.target
EOFSERVICE

    sudo systemctl daemon-reload
    echo "✅ Service file created"
fi

# Check service status
echo "Current status:"
sudo systemctl status discord-bot.service --no-pager -l || true

echo ""
echo "=== Checking Bot Files ==="
if [ ! -f "/home/ubuntu/discord-bot/src/bot.js" ]; then
    echo "❌ Bot files not found at /home/ubuntu/discord-bot/"
    echo ""
    echo "Files in /home/ubuntu/discord-bot/:"
    ls -la /home/ubuntu/discord-bot/ 2>/dev/null || echo "Directory does not exist!"
    echo ""
    echo "You need to copy your bot files to /home/ubuntu/discord-bot/"
    exit 1
fi

echo "✅ Bot files found"
echo ""

# Check .env file
if [ ! -f "/home/ubuntu/discord-bot/.env" ]; then
    echo "❌ .env file not found!"
    echo ""
    echo "Creating .env template..."
    cat > /home/ubuntu/discord-bot/.env << 'EOFENV'
# Discord Bot Token (REQUIRED)
DISCORD_TOKEN=your_token_here

# Owner Discord User ID (REQUIRED)
OWNER_ID=your_user_id_here

# Database
DATABASE_URL=sqlite:///home/ubuntu/discord-bot/data/bot.db

# Server
PORT=3000
NODE_ENV=production

# Optional
LOG_LEVEL=info
EOFENV
    
    chmod 600 /home/ubuntu/discord-bot/.env
    chown ubuntu:ubuntu /home/ubuntu/discord-bot/.env
    
    echo "⚠️  .env file created. You need to edit it:"
    echo "   nano /home/ubuntu/discord-bot/.env"
    echo ""
    echo "Add your DISCORD_TOKEN and OWNER_ID"
    exit 1
fi

echo "✅ .env file exists"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo ""
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node --version)"
echo ""

# Check dependencies
if [ ! -d "/home/ubuntu/discord-bot/node_modules" ]; then
    echo "⚠️  Node modules not installed. Installing..."
    cd /home/ubuntu/discord-bot
    npm install
    echo "✅ Dependencies installed"
fi

echo ""
echo "=== Enabling and Starting Bot ==="
sudo systemctl enable discord-bot.service
sudo systemctl restart discord-bot.service

sleep 2

echo ""
echo "=== Final Status ==="
sudo systemctl status discord-bot.service --no-pager -l

echo ""
echo "=== Recent Logs ==="
sudo journalctl -u discord-bot.service -n 20 --no-pager

echo ""
echo "To watch live logs: sudo journalctl -u discord-bot.service -f"
