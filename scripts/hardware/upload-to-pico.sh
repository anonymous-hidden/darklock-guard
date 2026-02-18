#!/bin/bash
# Upload firmware to Pico - run this ON the Pi5

echo "Stopping bridge service..."
sudo systemctl stop pico-guild-display
sleep 2

echo "Uploading firmware to Pico..."
/home/ubuntu/.local/bin/ampy --port /dev/ttyACM0 --delay 1 put /home/ubuntu/discord-bot/hardware/pico_guild_display/main.py /main.py

echo "Waiting for Pico to reset..."
sleep 3

echo "Starting bridge service..."
sudo systemctl start pico-guild-display

echo "Done! Checking status..."
sleep 2
sudo systemctl status pico-guild-display --no-pager -l
