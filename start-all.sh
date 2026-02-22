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

echo "3. Starting Darklock Guard Service + App (Tauri)..."
# Start the guard-service daemon first if not already running
GUARD_BIN="$SCRIPT_DIR/guard-v2/target/debug/guard-service"
if ! pgrep -f "guard-service run" > /dev/null; then
    if [ -f "$GUARD_BIN" ]; then
        export GUARD_VAULT_PASSWORD="${GUARD_VAULT_PASSWORD:-darklock2026}"
        "$GUARD_BIN" run > "$SCRIPT_DIR/logs/guard-service.log" 2>&1 &
        sleep 2
        if pgrep -f "guard-service run" > /dev/null; then
            echo "✓ Guard service daemon started"
        else
            echo "✗ Guard service daemon failed to start (check logs/guard-service.log)"
        fi
    else
        echo "⚠ guard-service binary not found, run: cd guard-v2 && cargo build"
    fi
else
    echo "✓ Guard service daemon already running"
fi

GUARD_UI_BIN="$SCRIPT_DIR/guard-v2/target/debug/darklock-guard-ui"
if ! pgrep -f "darklock-guard-ui" > /dev/null && ! pgrep -f "vite dev" > /dev/null; then
    if [ -f "$GUARD_UI_BIN" ]; then
        # Run the pre-built binary directly in the background (no recompilation)
        export GUARD_VAULT_PASSWORD="${GUARD_VAULT_PASSWORD:-darklock2026}"
        nohup "$GUARD_UI_BIN" > "$SCRIPT_DIR/logs/guard-startup.log" 2>&1 &
        sleep 2
        if pgrep -f "darklock-guard-ui" > /dev/null; then
            echo "✓ Darklock Guard App started (background)"
        else
            echo "✗ Darklock Guard App failed to start (check logs/guard-startup.log)"
        fi
    else
        # Binary not built yet — fall back to tauri dev (first-time build)
        lsof -ti:5173 | xargs kill -9 2>/dev/null || true
        sleep 1
        cd "$SCRIPT_DIR/guard-v2/desktop"
        if [ -d "$SCRIPT_DIR/guard-v2/desktop" ]; then
            nohup npx tauri dev > "$SCRIPT_DIR/logs/guard-startup.log" 2>&1 &
            echo "✓ Darklock Guard building for first time... (~1-2 min, check logs/guard-startup.log)"
        else
            echo "✗ Guard directory not found: $SCRIPT_DIR/guard-v2/desktop"
        fi
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
pgrep -f "guard-service run" > /dev/null && echo "✓ Guard Service Daemon: Running" || echo "✗ Guard Service Daemon: Not running"
pgrep -f "darklock-guard-ui" > /dev/null && echo "✓ Darklock Guard App: Running" || (pgrep -f "vite dev" > /dev/null && echo "✓ Darklock Guard App: Building/running (dev mode)" || echo "✗ Darklock Guard App: Not running — check logs/guard-startup.log")

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
