#!/bin/bash
# Quick icon update script - generates all app icons from source

set -e

SOURCE_ICON="/home/cayden/Pictures/darklock.png"
ICONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/desktop/src-tauri/icons"

echo "🎨 Updating Darklock Guard icons..."
echo ""

# Check if source exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ Error: $SOURCE_ICON not found"
    exit 1
fi

# Create icons directory
mkdir -p "$ICONS_DIR"

# Generate all PNG sizes (RGBA format with alpha channel)
echo "📐 Generating PNG icons..."
convert "$SOURCE_ICON" -background none -gravity center -extent 16x16 -resize "16x16" -define png:color-type=6 "$ICONS_DIR/16x16.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 24x24 -resize "24x24" -define png:color-type=6 "$ICONS_DIR/24x24.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 32x32 -resize "32x32" -define png:color-type=6 "$ICONS_DIR/32x32.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 64x64 -resize "64x64" -define png:color-type=6 "$ICONS_DIR/64x64.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 128x128 -resize "128x128" -define png:color-type=6 "$ICONS_DIR/128x128.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 256x256 -resize "256x256" -define png:color-type=6 "$ICONS_DIR/128x128@2x.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 256x256 -resize "256x256" -define png:color-type=6 "$ICONS_DIR/256x256.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 512x512 -resize "512x512" -define png:color-type=6 "$ICONS_DIR/512x512.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 1024x1024 -resize "1024x1024" -define png:color-type=6 "$ICONS_DIR/icon.png"

# Windows Store logos
echo "🪟 Generating Windows Store logos..."
convert "$SOURCE_ICON" -background none -gravity center -extent 30x30 -resize "30x30" -define png:color-type=6 "$ICONS_DIR/Square30x30Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 44x44 -resize "44x44" -define png:color-type=6 "$ICONS_DIR/Square44x44Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 71x71 -resize "71x71" -define png:color-type=6 "$ICONS_DIR/Square71x71Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 89x89 -resize "89x89" -define png:color-type=6 "$ICONS_DIR/Square89x89Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 107x107 -resize "107x107" -define png:color-type=6 "$ICONS_DIR/Square107x107Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 142x142 -resize "142x142" -define png:color-type=6 "$ICONS_DIR/Square142x142Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 150x150 -resize "150x150" -define png:color-type=6 "$ICONS_DIR/Square150x150Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 284x284 -resize "284x284" -define png:color-type=6 "$ICONS_DIR/Square284x284Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 310x310 -resize "310x310" -define png:color-type=6 "$ICONS_DIR/Square310x310Logo.png"
convert "$SOURCE_ICON" -background none -gravity center -extent 50x50 -resize "50x50" -define png:color-type=6 "$ICONS_DIR/StoreLogo.png"

# Windows .ico
echo "🖼️  Generating Windows icon..."
convert "$SOURCE_ICON" -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"

# macOS .icns
echo "🍎 Generating macOS icon..."
convert "$SOURCE_ICON" -background none -gravity center -extent 512x512 -resize "512x512" -define png:color-type=6 "$ICONS_DIR/icon.icns"

# Master copy
cp "$SOURCE_ICON" "$ICONS_DIR/icon-master.png"

echo ""
echo "✅ All icons updated successfully!"
echo "   Source: $SOURCE_ICON"
echo "   Output: $ICONS_DIR"
