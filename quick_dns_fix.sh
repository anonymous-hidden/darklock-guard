#!/bin/bash
# Quick DNS fix for Pi

echo "=== Quick DNS Fix ==="

# Fix resolv.conf
sudo rm /etc/resolv.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf
echo "nameserver 1.1.1.1" | sudo tee -a /etc/resolv.conf

# Make it immutable so it doesn't get overwritten
sudo chattr +i /etc/resolv.conf

echo "✅ DNS fixed"
echo ""

# Test
echo "Testing DNS..."
nslookup discord.com

echo ""
echo "Testing connectivity..."
ping -c 2 discord.com

echo ""
echo "Restarting bot..."
sudo systemctl restart discord-bot.service

sleep 3
sudo journalctl -u discord-bot.service -n 20 --no-pager
