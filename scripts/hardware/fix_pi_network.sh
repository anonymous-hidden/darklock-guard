#!/bin/bash
# Fix Pi network connectivity

echo "=== Checking Pi Network Connectivity ==="
echo ""

echo "1. Testing DNS resolution..."
if nslookup discord.com > /dev/null 2>&1; then
    echo "✅ DNS working"
else
    echo "❌ DNS not working"
    echo ""
    echo "Fixing DNS..."
    
    # Add Google DNS to resolv.conf
    echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolv.conf > /dev/null
    echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf > /dev/null
    
    # Make it persistent with systemd-resolved
    sudo mkdir -p /etc/systemd/resolved.conf.d/
    cat << 'EOFDNS' | sudo tee /etc/systemd/resolved.conf.d/dns.conf > /dev/null
[Resolve]
DNS=8.8.8.8 8.8.4.4 1.1.1.1
FallbackDNS=8.8.8.8
EOFDNS
    
    sudo systemctl restart systemd-resolved
    
    echo "✅ DNS configured"
fi

echo ""
echo "2. Testing internet connectivity..."
if ping -c 2 discord.com > /dev/null 2>&1; then
    echo "✅ Can reach discord.com"
else
    echo "❌ Cannot reach discord.com"
    echo ""
    echo "Checking routes..."
    ip route show
    echo ""
    
    # Try to add default route if missing
    GATEWAY=$(ip route | grep default | awk '{print $3}' | head -1)
    if [ -z "$GATEWAY" ]; then
        echo "No default gateway found. Setting to 192.168.50.1..."
        sudo ip route add default via 192.168.50.1
    fi
fi

echo ""
echo "3. Current network configuration:"
ip addr show
echo ""
ip route show
echo ""

echo "4. Testing DNS servers:"
cat /etc/resolv.conf

echo ""
echo "5. Restarting bot service..."
sudo systemctl restart discord-bot.service

sleep 3

echo ""
echo "=== Bot Status ==="
sudo systemctl status discord-bot.service --no-pager -l

echo ""
echo "=== Recent Logs (last 30 lines) ==="
sudo journalctl -u discord-bot.service -n 30 --no-pager

echo ""
echo "To watch live: sudo journalctl -u discord-bot.service -f"
