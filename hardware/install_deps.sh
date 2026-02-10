#!/bin/bash
# Install better LCD library and I2C tools
echo "Installing RPLCD library and i2c-tools..."
sudo pip3 install RPLCD --break-system-packages
sudo apt-get install -y i2c-tools

echo "Done!"
echo ""
echo "To detect your LCD I2C address, run:"
echo "  sudo i2cdetect -y 1"
