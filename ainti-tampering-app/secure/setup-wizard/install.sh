#!/bin/bash
# Cross-platform installation script for Anti-Tampering App Setup Wizard
# Supports Linux (Debian/Ubuntu-based distributions)

set -e

echo "=============================================="
echo "  Anti-Tampering App Setup Wizard"
echo "  Linux Installation Script"
echo "=============================================="
echo ""

# Detect if running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Not running as root - some features may require sudo"
    echo ""
fi

# Check for Python
echo "Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found"
    echo "Installing Python 3..."
    if [ "$EUID" -eq 0 ]; then
        apt-get update
        apt-get install -y python3 python3-pip python3-tk
    else
        sudo apt-get update
        sudo apt-get install -y python3 python3-pip python3-tk
    fi
else
    echo "✓ Python 3 found: $(python3 --version)"
fi

# Check for pip
echo ""
echo "Checking pip installation..."
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip not found"
    echo "Installing pip..."
    if [ "$EUID" -eq 0 ]; then
        apt-get install -y python3-pip
    else
        sudo apt-get install -y python3-pip
    fi
else
    echo "✓ pip found"
fi

# Install Python dependencies
echo ""
echo "Installing Python dependencies..."
if [ -f "requirements.txt" ]; then
    pip3 install -r requirements.txt --user
    echo "✓ Dependencies installed"
else
    echo "⚠️  requirements.txt not found, attempting basic install..."
    pip3 install customtkinter pillow --user
fi

# Create desktop entry (optional)
echo ""
read -p "Create desktop launcher? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    DESKTOP_FILE="$HOME/.local/share/applications/anti-tamper-setup.desktop"
    mkdir -p "$HOME/.local/share/applications"
    
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Anti-Tampering Setup Wizard
Comment=Development environment setup wizard
Exec=python3 "$(pwd)/main.py"
Path=$(pwd)
Terminal=false
Icon=utilities-system-monitor
Categories=Development;Utility;
EOF
    
    chmod +x "$DESKTOP_FILE"
    echo "✓ Desktop launcher created"
fi

echo ""
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo ""
echo "To run the setup wizard:"
echo "  python3 main.py"
echo ""
echo "For elevated privileges (required for some features):"
echo "  sudo python3 main.py"
echo ""
