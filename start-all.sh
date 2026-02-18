#!/bin/bash

# DarkLock - Start All Services
# This script starts the Discord bot, Darklock platform, and both Tauri applications

echo "=========================================="
echo "  DarkLock - Starting All Services"
echo "=========================================="
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to check if a process is already running
check_running() {
    if pgrep -f "$1" > /dev/null; then
        echo "✓ $2 is already running"
        return 0
    else
        return 1
    fi
}

# Function to start a background service
start_background() {
    echo "Starting $1..."
    $2 > /dev/null 2>&1 &
    sleep 2
    if pgrep -f "$3" > /dev/null; then
        echo "✓ $1 started successfully"
    else
        echo "✗ Failed to start $1"
    fi
}

echo "1. Starting Discord Bot..."
if ! check_running "node src/bot.js" "Discord Bot"; then
    cd "$SCRIPT_DIR"
    npm start > logs/bot-startup.log 2>&1 &
    sleep 3
    if pgrep -f "node src/bot.js" > /dev/null; then
        echo "✓ Discord Bot started"
    else
        echo "✗ Discord Bot failed to start (check logs/bot-startup.log)"
    fi
fi
echo ""

echo "2. Starting Darklock Platform Server..."
if ! check_running "node darklock/start.js" "Darklock Platform"; then
    cd "$SCRIPT_DIR"
    node darklock/start.js > logs/darklock-startup.log 2>&1 &
    sleep 2
    if pgrep -f "node darklock/start.js" > /dev/null; then
        echo "✓ Darklock Platform started"
    else
        echo "✗ Darklock Platform failed to start (check logs/darklock-startup.log)"
    fi
fi
echo ""

echo "3. Starting Darklock Guard App (Tauri)..."
if ! check_running "tauri dev" "Darklock Guard"; then
    cd "$SCRIPT_DIR/guard-v2/desktop"
    if [ -d "$SCRIPT_DIR/guard-v2/desktop" ]; then
        npx tauri dev > "$SCRIPT_DIR/logs/guard-startup.log" 2>&1 &
        echo "✓ Darklock Guard starting... (this may take a moment)"
    else
        echo "✗ Guard directory not found: $SCRIPT_DIR/guard-v2/desktop"
    fi
else
    echo "✓ Darklock Guard already running"
fi
echo ""

echo "=========================================="
echo "  Services Status Check"
echo "=========================================="
sleep 3

# Check all services
echo ""
echo "Checking running services..."
pgrep -f "node src/bot.js" > /dev/null && echo "✓ Discord Bot: Running" || echo "✗ Discord Bot: Not running"
pgrep -f "node darklock/start.js" > /dev/null && echo "✓ Darklock Platform: Running" || echo "✗ Darklock Platform: Not running"
pgrep -f "tauri dev" > /dev/null && echo "✓ Tauri Apps: Running" || echo "✗ Tauri Apps: Not running"

echo ""
echo "=========================================="
echo "  Access Points"
echo "=========================================="
echo "Dashboard:  http://localhost:3001"
echo "Platform:   http://localhost:3001/platform"
echo "Darklock:   http://localhost:3002"
echo ""
echo "Logs directory: $SCRIPT_DIR/logs/"
echo "=========================================="
echo ""
echo "To stop all services, run: ./stop-all.sh"
echo ""
