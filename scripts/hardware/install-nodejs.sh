#!/bin/bash
# Node.js Installation Script for Discord Bot
# Run this script to install Node.js and all dependencies

echo "================================================"
echo "Discord Bot - Node.js Installation Script"
echo "================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script requires sudo privileges."
    echo "You may be prompted for your password."
    echo ""
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS. Exiting."
    exit 1
fi

echo "Detected OS: $OS"
echo ""

# Install Node.js based on OS
case $OS in
    ubuntu|debian|pop|linuxmint|zorin|elementary|neon)
        echo "Installing Node.js via NodeSource repository..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
    fedora|rhel|centos)
        echo "Installing Node.js via DNF..."
        sudo dnf install -y nodejs npm
        ;;
    arch|manjaro)
        echo "Installing Node.js via Pacman..."
        sudo pacman -S --noconfirm nodejs npm
        ;;
    *)
        echo "Unsupported OS: $OS"
        echo "Trying Debian/Ubuntu method (may work for $OS)..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
esac

# Verify installation
echo ""
echo "Verifying installation..."
if command -v node &> /dev/null; then
    echo "✅ Node.js installed: $(node --version)"
    echo "✅ NPM installed: $(npm --version)"
else
    echo "❌ Installation failed. Please install Node.js manually."
    exit 1
fi

echo ""
echo "================================================"
echo "Node.js installation complete!"
echo "================================================"
echo ""
echo "Next step: Run './install-bot.sh' to install bot dependencies"
