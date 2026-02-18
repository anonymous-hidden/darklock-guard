#!/bin/bash

# Automated deployment script for Pi5
# This script will sync files and deploy to the Pico automatically

PI5_USER="ubuntu"
PI5_PASS="0131106761Cb"
PI5_HOST="192.168.50.2"  # Auto-detected Pi5 IP
PI5_PATH="/home/ubuntu/discord-bot"

echo "════════════════════════════════════════════════════"
echo "  Automated Pi5 + Pico Deployment"
echo "════════════════════════════════════════════════════"
echo

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo "Installing sshpass for automated authentication..."
    sudo apt update && sudo apt install -y sshpass
fi

# Try to find Pi5 on the network
echo "Searching for Pi5 on network..."
echo

# Common hostnames to try
HOSTS=(
    "pi5.local"
    "pi5"
    "ubuntu.local"
    "raspberrypi5.local"
    "raspberrypi.local"
)

PI5_HOST=""

for host in "${HOSTS[@]}"; do
    echo -n "Trying $host... "
    if ping -c 1 -W 1 "$host" &>/dev/null; then
        echo "✓ Found!"
        PI5_HOST="$host"
        break
    else
        echo "✗"
    fi
done

# If not found by hostname, ask user
if [ -z "$PI5_HOST" ]; then
    echo
    echo "Could not auto-detect Pi5."
    read -p "Enter Pi5 IP address or hostname: " PI5_HOST
fi

echo
echo "Target: $PI5_USER@$PI5_HOST"
echo

# Create directory on Pi5 if it doesn't exist
echo "Creating directory on Pi5..."
sshpass -p "$PI5_PASS" ssh -o StrictHostKeyChecking=no "$PI5_USER@$PI5_HOST" "mkdir -p $PI5_PATH" 2>/dev/null

# Files to sync
FILES=(
    "pico_7segment_display.py"
    "deploy-pico-7segment.sh"
    "PICO_7SEGMENT_SETUP.md"
)

# Copy files
echo "Syncing files to Pi5..."
for file in "${FILES[@]}"; do
    echo -n "  $file... "
    if sshpass -p "$PI5_PASS" scp -o StrictHostKeyChecking=no "$file" "$PI5_USER@$PI5_HOST:$PI5_PATH/" 2>/dev/null; then
        echo "✓"
    else
        echo "✗ Failed"
        exit 1
    fi
done

echo
echo "Files synced successfully!"
echo

# Run deployment on Pi5
echo "Running deployment on Pi5..."
echo "════════════════════════════════════════════════════"
echo

sshpass -p "$PI5_PASS" ssh -o StrictHostKeyChecking=no "$PI5_USER@$PI5_HOST" "cd $PI5_PATH && chmod +x deploy-pico-7segment.sh && ./deploy-pico-7segment.sh"

echo
echo "════════════════════════════════════════════════════"
echo "✓ Deployment Complete!"
echo "════════════════════════════════════════════════════"
echo
echo "To view Pico output on Pi5:"
echo "  sshpass -p '$PI5_PASS' ssh $PI5_USER@$PI5_HOST 'cd $PI5_PATH && mpremote connect /dev/ttyACM0'"
echo
