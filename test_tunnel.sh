#!/bin/bash

echo "=== Cloudflared Tunnel Diagnostic ==="
echo ""

echo "1. Checking if cloudflared is installed..."
which cloudflared
echo ""

echo "2. Checking cloudflared version..."
cloudflared --version
echo ""

echo "3. Checking config file..."
ls -la ~/.cloudflared/config.yml
echo ""

echo "4. Checking credentials file..."
ls -la ~/.cloudflared/*.json
echo ""

echo "5. Checking tunnel status..."
cloudflared tunnel info darklock-pi5
echo ""

echo "6. Testing tunnel connection (will run for 30 seconds)..."
timeout 30 cloudflared --config ~/.cloudflared/config.yml tunnel run darklock-pi5 2>&1 | head -n 50
