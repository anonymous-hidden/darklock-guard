#!/bin/bash

# Quick script to find Pi5 among active IPs
PI5_USER="ubuntu"
PI5_PASS="0131106761Cb"

IPS=(
    "192.168.50.2"
    "192.168.50.37"
    "192.168.50.150"
    "192.168.50.9"
    "192.168.50.17"
    "192.168.50.45"
    "192.168.50.71"
    "192.168.50.78"
    "192.168.50.179"
    "192.168.50.59"
    "192.168.50.39"
    "192.168.50.241"
    "192.168.50.240"
    "192.168.50.93"
    "192.168.50.231"
    "192.168.50.204"
    "192.168.50.216"
    "192.168.50.220"
    "192.168.50.20"
)

# Install sshpass if needed
if ! command -v sshpass &>/dev/null; then
    echo "Installing sshpass..."
    sudo apt update && sudo apt install -y sshpass
fi

echo "Searching for Pi5 with SSH..."
echo

for ip in "${IPS[@]}"; do
    echo -n "Trying $ip... "
    if timeout 2 sshpass -p "$PI5_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 "$PI5_USER@$ip" "uname -a" 2>/dev/null | grep -q "aarch64"; then
        echo "✓ FOUND! This is the Pi5!"
        echo "$ip" > /tmp/pi5_ip.txt
        exit 0
    else
        echo "✗"
    fi
done

echo
echo "Could not find Pi5 automatically."
