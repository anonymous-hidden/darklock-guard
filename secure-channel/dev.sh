#!/bin/bash
# Start all Darklock Secure Channel services in dev mode.
# Usage: ./secure-channel/dev.sh

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IDS_DIR="$ROOT/services/dl_ids"
RLY_DIR="$ROOT/services/dl_rly"
APP_DIR="$ROOT/apps/dl-secure-channel"

# Kill any stale processes
pkill -f "dl-secure-channel" 2>/dev/null || true
pkill -f "dl_ids.*server" 2>/dev/null || true
pkill -f "dl_rly.*server" 2>/dev/null || true
fuser -k 4100/tcp 2>/dev/null || true
fuser -k 4101/tcp 2>/dev/null || true
sleep 1

echo "[dev] Starting dl_ids on :4100..."
cd "$IDS_DIR"
node src/server.js > /tmp/dl_ids.log 2>&1 &
IDS_PID=$!

echo "[dev] Starting dl_rly on :4101..."
cd "$RLY_DIR"
node src/server.js > /tmp/dl_rly.log 2>&1 &
RLY_PID=$!

# Wait for services to be ready
sleep 2
echo "[dev] IDS log: $(tail -1 /tmp/dl_ids.log)"
echo "[dev] RLY log: $(tail -1 /tmp/dl_rly.log)"

echo "[dev] Starting Tauri app (DL_IDS_URL=http://localhost:4100 DL_RLY_URL=http://localhost:4101)..."
cd "$APP_DIR"
export DL_IDS_URL="http://localhost:4100"
export DL_RLY_URL="http://localhost:4101"
npm run tauri dev

# Cleanup on exit
trap "kill $IDS_PID $RLY_PID 2>/dev/null" EXIT
