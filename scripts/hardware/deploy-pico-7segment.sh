#!/bin/bash

# Script to deploy 7-segment display code to Raspberry Pi Pico
# Run this on your Raspberry Pi 5

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PICO_SCRIPT="$SCRIPT_DIR/pico_7segment_display.py"
PICO_DEVICE="/dev/ttyACM0"

echo "════════════════════════════════════════════════════"
echo "  Pico 7-Segment Display Deployment Script"
echo "════════════════════════════════════════════════════"
echo

# Check if running on Pi5
if [ ! -f /proc/device-tree/model ] || ! grep -q "Raspberry Pi 5" /proc/device-tree/model 2>/dev/null; then
    echo "⚠️  Warning: This doesn't appear to be a Raspberry Pi 5"
    echo "   Continuing anyway..."
    echo
fi

# Function to check if mpremote is installed
check_mpremote() {
    if command -v mpremote &> /dev/null; then
        echo "✓ mpremote is already installed"
        return 0
    else
        echo "✗ mpremote is not installed"
        return 1
    fi
}

# Function to install mpremote
install_mpremote() {
    echo
    echo "Installing mpremote..."
    echo "This tool is used to communicate with MicroPython devices"
    echo
    
    # Try pipx first (preferred method)
    if command -v pipx &> /dev/null; then
        pipx install mpremote
        echo
        echo "✓ mpremote installed successfully via pipx"
        export PATH="$HOME/.local/bin:$PATH"
        return 0
    fi
    
    # Fall back to pip3 with --break-system-packages (safe for tools)
    if command -v pip3 &> /dev/null; then
        pip3 install --user --break-system-packages mpremote
        echo
        echo "✓ mpremote installed successfully"
        echo "  Adding pip user bin to PATH for this session..."
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo "❌ Error: Neither pipx nor pip3 found."
        echo "   Install pipx: sudo apt update && sudo apt install pipx"
        echo "   Or install pip: sudo apt install python3-pip"
        exit 1
    fi
}

# Function to detect Pico device
detect_pico() {
    echo
    echo "Detecting Raspberry Pi Pico..."
    
    # Check common devices
    for device in /dev/ttyACM0 /dev/ttyACM1 /dev/ttyUSB0; do
        if [ -e "$device" ]; then
            # Try to connect and check if it's a Pico
            if timeout 2 mpremote connect "$device" version &>/dev/null; then
                PICO_DEVICE="$device"
                echo "✓ Found Pico at $device"
                return 0
            fi
        fi
    done
    
    echo "⚠️  Could not auto-detect Pico device"
    echo "   Using default: $PICO_DEVICE"
    echo "   If this fails, check 'ls /dev/ttyACM*' or 'ls /dev/ttyUSB*'"
    return 1
}

# Function to check if Pico has MicroPython
check_micropython() {
    echo
    echo "Checking MicroPython on Pico..."
    
    if timeout 3 mpremote connect "$PICO_DEVICE" version &>/dev/null; then
        local version=$(mpremote connect "$PICO_DEVICE" version 2>/dev/null | head -n 1)
        echo "✓ MicroPython detected: $version"
        return 0
    else
        echo "❌ Could not communicate with Pico"
        echo
        echo "Possible issues:"
        echo "  1. Pico is not connected via USB"
        echo "  2. MicroPython is not installed on Pico"
        echo "  3. Wrong device path ($PICO_DEVICE)"
        echo "  4. Permission issues (try: sudo usermod -a -G dialout $USER)"
        echo
        echo "To install MicroPython on Pico:"
        echo "  1. Download: https://micropython.org/download/rp2-pico/"
        echo "  2. Hold BOOTSEL button while plugging in Pico"
        echo "  3. Copy .uf2 file to the Pico drive"
        echo "  4. Pico will reboot automatically"
        exit 1
    fi
}

# Check for script file
if [ ! -f "$PICO_SCRIPT" ]; then
    echo "❌ Error: Could not find $PICO_SCRIPT"
    exit 1
fi

echo "Source file: $PICO_SCRIPT"
echo

# Check/install mpremote
if ! check_mpremote; then
    install_mpremote
fi

# Detect Pico
detect_pico

# Check MicroPython
check_micropython

# Upload the script
echo
echo "Uploading display script to Pico..."
echo

# First, copy the file to the Pico
if mpremote connect "$PICO_DEVICE" cp "$PICO_SCRIPT" :main.py; then
    echo "✓ Script uploaded successfully as main.py"
    echo "  (main.py runs automatically on boot)"
else
    echo "❌ Upload failed"
    exit 1
fi

# Soft reset the Pico to start the script
echo
echo "Restarting Pico..."
mpremote connect "$PICO_DEVICE" reset

sleep 2

echo
echo "════════════════════════════════════════════════════"
echo "✓ Deployment Complete!"
echo "════════════════════════════════════════════════════"
echo
echo "The 7-segment display should now be running."
echo "It will show a startup animation, then wait for data."
echo
echo "To view Pico output:"
echo "  mpremote connect $PICO_DEVICE"
echo
echo "To test manually:"
echo "  echo 'COUNT:1234' | mpremote connect $PICO_DEVICE"
echo
echo "The Discord bot will automatically send updates via:"
echo "  $PICO_DEVICE @ 115200 baud"
echo
echo "Make sure your .env has:"
echo "  SEGMENT_PORT=$PICO_DEVICE"
echo
