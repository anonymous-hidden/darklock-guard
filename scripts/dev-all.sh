#!/usr/bin/env bash
set -euo pipefail

# Starts all local services needed for Darklock dev:
# - Discord security bot
# - Darklock platform server
# - Guard v2 desktop (Tauri + Vite) dev mode

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap 'cleanup; exit 0' INT TERM

start() {
  local name="$1"; shift
  echo "[dev-all] starting $name: $*"
  (
    cd "$ROOT" || exit 1
    "$@"
  ) &
  pids+=($!)
}

start "platform" node darklock/start.js
start "bot" node start-bot.js
start "desktop" bash -lc "cd \"$ROOT/guard-v2/desktop\" && npx tauri dev"

echo "[dev-all] all services launching; first error will stop the group."

wait -n || true
echo "[dev-all] shutting down..."
cleanup
wait || true
