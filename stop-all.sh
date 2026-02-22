#!/bin/bash

# DarkLock - Stop All Services
# This script stops all running DarkLock services

echo "=========================================="
echo "  DarkLock - Stopping All Services"
echo "=========================================="
echo ""

# Function to kill process by pattern
kill_process() {
    if pgrep -f "$1" > /dev/null; then
        echo "Stopping $2..."
        pkill -f "$1"
        sleep 1
        if pgrep -f "$1" > /dev/null; then
            echo "  Force killing $2..."
            pkill -9 -f "$1"
        fi
        echo "✓ $2 stopped"
    else
        echo "✓ $2 not running"
    fi
}

# Stop all services
kill_process "node src/bot.js" "Discord Bot"
kill_process "node darklock/start.js" "Darklock Platform"
kill_process "node darklock/server.js" "Darklock Platform (alt)"
kill_process "guard-service run" "Guard Service Daemon"
kill_process "vite dev" "Tauri Vite Dev Server"
kill_process "darklock-guard-ui" "Tauri App"
kill_process "tauri dev" "Tauri Dev"
# Free Vite's port in case of orphaned processes
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

echo ""
echo "=========================================="
echo "  All services stopped"
echo "=========================================="
echo ""

# Check if any ports are still in use
echo "Checking ports..."
lsof -ti:3001 > /dev/null 2>&1 && echo "⚠ Port 3001 still in use" || echo "✓ Port 3001 free"
lsof -ti:3002 > /dev/null 2>&1 && echo "⚠ Port 3002 still in use" || echo "✓ Port 3002 free"
lsof -ti:5173 > /dev/null 2>&1 && echo "⚠ Port 5173 still in use" || echo "✓ Port 5173 free"
echo ""
