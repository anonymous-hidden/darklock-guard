#!/bin/bash
# Darklock Guard Setup Script
# This script initializes the guard service and updates all desktop app icons

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/desktop"
ICONS_DIR="$DESKTOP_DIR/src-tauri/icons"
SOURCE_ICON="/home/cayden/Pictures/darklock.png"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Darklock Guard Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo -e "${RED}Error: Source icon not found at $SOURCE_ICON${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found source icon: $SOURCE_ICON"

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo -e "${YELLOW}ImageMagick not found. Installing...${NC}"
    sudo apt-get update && sudo apt-get install -y imagemagick
fi

echo ""
echo -e "${BLUE}Step 1: Generating app icons from darklock.png${NC}"
echo "--------------------------------------"

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

# Generate PNG icons at various sizes
declare -a sizes=("16x16" "24x24" "32x32" "64x64" "128x128" "256x256" "512x512")

for size in "${sizes[@]}"; do
    echo -e "  Generating ${size}.png..."
    convert "$SOURCE_ICON" -background none -gravity center -extent "$size" -resize "$size" -define png:color-type=6 "$ICONS_DIR/${size}.png"
done

# Generate @2x version
echo -e "  Generating 128x128@2x.png..."
convert "$SOURCE_ICON" -background none -gravity center -extent "256x256" -resize "256x256" -define png:color-type=6 "$ICONS_DIR/128x128@2x.png"

# Generate main icon.png (1024x1024)
echo -e "  Generating icon.png..."
convert "$SOURCE_ICON" -background none -gravity center -extent "1024x1024" -resize "1024x1024" -define png:color-type=6 "$ICONS_DIR/icon.png"

# Generate master icon
echo -e "  Generating icon-master.png..."
cp "$SOURCE_ICON" "$ICONS_DIR/icon-master.png"

# Generate Windows Store logos
declare -a store_sizes=("Square30x30Logo" "Square44x44Logo" "Square71x71Logo" "Square89x89Logo" "Square107x107Logo" "Square142x142Logo" "Square150x150Logo" "Square284x284Logo" "Square310x310Logo" "StoreLogo")
declare -a store_px=("30" "44" "71" "89" "107" "142" "150" "284" "310" "50")

for i in "${!store_sizes[@]}"; do
    logo="${store_sizes[$i]}"
    px="${store_px[$i]}"
    echo -e "  Generating ${logo}.png..."
    convert "$SOURCE_ICON" -background none -gravity center -extent "${px}x${px}" -resize "${px}x${px}" -define png:color-type=6 "$ICONS_DIR/${logo}.png"
done

# Generate .ico file for Windows (requires multiple sizes embedded)
echo -e "  Generating icon.ico..."
convert "$SOURCE_ICON" -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"

# Generate .icns file for macOS (requires iconutil on macOS, so we'll use ImageMagick)
echo -e "  Generating icon.icns..."
if command -v png2icns &> /dev/null; then
    png2icns "$ICONS_DIR/icon.icns" "$ICONS_DIR/512x512.png" "$ICONS_DIR/256x256.png" "$ICONS_DIR/128x128.png" "$ICONS_DIR/32x32.png" "$ICONS_DIR/16x16.png"
elif command -v convert &> /dev/null; then
    # Fallback: create a simple icns using ImageMagick (not perfect but works)
    convert "$SOURCE_ICON" -background none -gravity center -extent "512x512" -resize "512x512" -define png:color-type=6 "$ICONS_DIR/icon.icns"
else
    echo -e "${YELLOW}  Warning: Could not generate .icns file. Install png2icns or run on macOS.${NC}"
fi

echo -e "${GREEN}✓${NC} All icons generated successfully!"
echo ""

# Step 2: Build the guard service
echo -e "${BLUE}Step 2: Building Guard Service${NC}"
echo "--------------------------------------"

cd "$SCRIPT_DIR/crates/guard-service"

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: Rust/Cargo not found. Please install Rust first:${NC}"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo "Building guard service (this may take a few minutes)..."
cargo build --release

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to build guard service${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Guard service built successfully!"
echo ""

# Step 3: Initialize vault
echo -e "${BLUE}Step 3: Initialize Vault${NC}"
echo "--------------------------------------"
echo ""
echo "You will be prompted to create a vault password."
echo "This password encrypts sensitive data. Choose a strong password and remember it!"
echo ""

# Prompt for vault password
read -sp "Enter vault password: " VAULT_PASSWORD
echo ""
read -sp "Confirm vault password: " VAULT_PASSWORD_CONFIRM
echo ""

if [ "$VAULT_PASSWORD" != "$VAULT_PASSWORD_CONFIRM" ]; then
    echo -e "${RED}Error: Passwords do not match${NC}"
    exit 1
fi

if [ ${#VAULT_PASSWORD} -lt 8 ]; then
    echo -e "${RED}Error: Password must be at least 8 characters${NC}"
    exit 1
fi

# Initialize vault with password
export GUARD_VAULT_PASSWORD="$VAULT_PASSWORD"
export GUARD_VAULT_PASSWORD_CONFIRM="$VAULT_PASSWORD"

echo "Initializing vault..."
cargo run --release -- init

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to initialize vault${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Vault initialized successfully!"
echo ""

# Step 4: Create .env file for desktop app
echo -e "${BLUE}Step 4: Configuring Desktop App${NC}"
echo "--------------------------------------"

cat > "$DESKTOP_DIR/.env" <<EOF
# Darklock Guard - Environment Configuration
# Generated on $(date)

# Guard Service Connection
GUARD_VAULT_PASSWORD=$VAULT_PASSWORD

# API Configuration
VITE_API_URL=http://localhost:3001
VITE_PLATFORM_URL=http://localhost:3002

# Development Mode
VITE_DEV_MODE=true

# Logging Level (debug, info, warn, error)
VITE_LOG_LEVEL=info

# Optional: Remote Management
# VITE_REMOTE_API=https://api.darklock.net
# VITE_REMOTE_AUTH_TOKEN=your_token_here

# Optional: Update Server
# VITE_UPDATE_SERVER=https://updates.darklock.net
EOF

echo -e "${GREEN}✓${NC} Desktop app configured (.env created)"
echo ""

# Step 5: Setup systemd service (optional)
echo -e "${BLUE}Step 5: Install System Service (Optional)${NC}"
echo "--------------------------------------"
read -p "Would you like to install the guard service to start automatically? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="$HOME/.config/systemd/user/darklock-guard.service"
    mkdir -p "$HOME/.config/systemd/user"
    
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Darklock Guard Service
After=network.target

[Service]
Type=simple
Environment="GUARD_VAULT_PASSWORD=$VAULT_PASSWORD"
ExecStart=$SCRIPT_DIR/crates/guard-service/target/release/darklock-guard start
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable darklock-guard.service
    systemctl --user start darklock-guard.service
    
    echo -e "${GREEN}✓${NC} Service installed and started"
    echo "  Use 'systemctl --user status darklock-guard' to check status"
else
    echo "  Skipped. To start manually, run:"
    echo "    cd $SCRIPT_DIR/crates/guard-service"
    echo "    GUARD_VAULT_PASSWORD=$VAULT_PASSWORD cargo run --release -- start"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Start the desktop app:"
echo "     cd $DESKTOP_DIR && npm install && npm run tauri dev"
echo ""
echo "  2. Or build for production:"
echo "     cd $DESKTOP_DIR && npm run tauri build"
echo ""
echo -e "${YELLOW}Important:${NC} Keep your vault password safe!"
echo "  Password: ${VAULT_PASSWORD}"
echo ""
