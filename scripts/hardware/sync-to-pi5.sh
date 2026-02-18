#!/bin/bash

# Script to sync Pico display files to your Pi5
# Update PI5_HOST with your Pi5's hostname or IP address

PI5_HOST="${PI5_HOST:-pi5.local}"  # Change to your Pi5's address
PI5_USER="${PI5_USER:-ubuntu}"
PI5_PATH="/home/$PI5_USER/discord-bot"

echo "════════════════════════════════════════════════════"
echo "  Syncing Pico Display Files to Pi5"
echo "════════════════════════════════════════════════════"
echo
echo "Target: $PI5_USER@$PI5_HOST:$PI5_PATH"
echo

# Files to sync
FILES=(
    "pico_7segment_display.py"
    "deploy-pico-7segment.sh"
    "PICO_7SEGMENT_SETUP.md"
)

# Check if we can reach the Pi5
if ! ping -c 1 -W 2 "$PI5_HOST" &>/dev/null; then
    echo "⚠️  Warning: Cannot ping $PI5_HOST"
    echo "   Make sure your Pi5 is online and the hostname/IP is correct"
    echo
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Copy files
for file in "${FILES[@]}"; do
    echo "Uploading $file..."
    if scp "$file" "$PI5_USER@$PI5_HOST:$PI5_PATH/"; then
        echo "  ✓ $file uploaded"
    else
        echo "  ✗ Failed to upload $file"
        exit 1
    fi
done

echo
echo "════════════════════════════════════════════════════"
echo "✓ Files synced successfully!"
echo "════════════════════════════════════════════════════"
echo
echo "Now SSH into your Pi5 and run:"
echo "  ssh $PI5_USER@$PI5_HOST"
echo "  cd \"$PI5_PATH\""
echo "  ./deploy-pico-7segment.sh"
echo
echo "Or run deployment remotely:"
echo "  ssh $PI5_USER@$PI5_HOST 'cd \"$PI5_PATH\" && ./deploy-pico-7segment.sh'"
echo
