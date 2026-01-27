#!/bin/bash
# Discord Bot Dependencies Installation Script

cd "$(dirname "$0")"

echo "================================================"
echo "Discord Bot - Installing Dependencies"
echo "================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please run './install-nodejs.sh' first"
    exit 1
fi

echo "Node.js version: $(node --version)"
echo "NPM version: $(npm --version)"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "You'll need to create one with your Discord bot token and other settings."
    echo ""
fi

# Install dependencies
echo "Installing Node.js dependencies..."
echo "This may take a few minutes..."
echo ""

npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "================================================"
    echo "✅ Dependencies installed successfully!"
    echo "================================================"
    echo ""
    echo "To start the bot:"
    echo "  npm start          - Start both bot and dashboard"
    echo "  npm run bot        - Start Discord bot only"
    echo ""
    echo "Make sure to configure your .env file with:"
    echo "  - DISCORD_TOKEN (your bot token)"
    echo "  - DISCORD_CLIENT_ID"
    echo "  - JWT_SECRET"
    echo "  - And other required settings"
else
    echo ""
    echo "❌ Installation failed!"
    echo "Please check the error messages above."
    exit 1
fi
