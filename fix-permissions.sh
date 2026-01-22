#!/bin/bash
# Fix permissions for Discord Bot

echo "================================================"
echo "Discord Bot - Permission Fixes"
echo "================================================"
echo ""

# Fix serial port permissions for Raspberry Pi Pico watchdog
if [ -e /dev/ttyACM0 ]; then
    echo "Adding user to dialout group for serial port access..."
    sudo usermod -a -G dialout $USER
    echo "✅ Added to dialout group"
    echo "⚠️  You'll need to log out and log back in for this to take effect"
    echo "   Or run: newgrp dialout"
else
    echo "ℹ️  No Raspberry Pi Pico detected at /dev/ttyACM0"
fi

echo ""
echo "================================================"
echo "Setup complete!"
echo "================================================"
