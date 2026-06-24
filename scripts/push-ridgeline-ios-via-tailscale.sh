#!/usr/bin/env bash
set -euo pipefail

# Push Ridgeline iOS Safari download flow files to Pi/server via Tailscale.
# Usage:
#   bash scripts/push-ridgeline-ios-via-tailscale.sh
#   bash scripts/push-ridgeline-ios-via-tailscale.sh darklock@100.117.105.41

REMOTE="${1:-}"
REMOTE_DIR="${REMOTE_DIR:-/mnt/nvme/discord-bot}"
RESTART_SERVICES="${RESTART_SERVICES:-1}"
REMOTE_SUDO_PASS="${REMOTE_SUDO_PASS:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FILES=(
  "darklock/server.js"
  "darklock/views/secure-channel-download.html"
  "darklock/views/ridgeline-ios-download.html"
)

echo "==> Checking Tailscale availability"
if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found. Install Tailscale first."
  exit 1
fi

echo "==> Local Tailscale status"
tailscale status >/dev/null

if [[ -z "${REMOTE}" ]]; then
  ts_line="$(tailscale status 2>/dev/null | awk '/darklock-server/ && $5 !~ /offline/ {print $1; exit}')"
  if [[ -n "${ts_line}" ]]; then
    REMOTE="darklock@${ts_line}"
  else
    ts_fallback="$(tailscale status 2>/dev/null | awk '/darklock/ && $5 !~ /offline/ {print $1; exit}')"
    REMOTE="darklock@${ts_fallback:-100.117.105.41}"
  fi
fi

echo "==> Pushing updated files to ${REMOTE}:${REMOTE_DIR}"
for rel in "${FILES[@]}"; do
  src="${ROOT_DIR}/${rel}"
  if [[ ! -f "${src}" ]]; then
    echo "Missing file: ${src}"
    exit 1
  fi
  ssh "${REMOTE}" "mkdir -p '${REMOTE_DIR}/$(dirname "${rel}")'"
  rsync -az --progress "${src}" "${REMOTE}:${REMOTE_DIR}/${rel}"
done

echo "==> Verifying files on remote"
ssh "${REMOTE}" "ls -lh '${REMOTE_DIR}/darklock/views/ridgeline-ios-download.html' '${REMOTE_DIR}/darklock/views/secure-channel-download.html' '${REMOTE_DIR}/darklock/server.js'"

if [[ "${RESTART_SERVICES}" == "1" ]]; then
  echo "==> Restarting Darklock services"
  if [[ -n "${REMOTE_SUDO_PASS}" ]]; then
    ssh "${REMOTE}" "echo '${REMOTE_SUDO_PASS}' | sudo -S systemctl daemon-reload && echo '${REMOTE_SUDO_PASS}' | sudo -S systemctl restart darklock-platform darklock-bot"
  else
    ssh "${REMOTE}" "sudo -n systemctl daemon-reload && sudo -n systemctl restart darklock-platform darklock-bot" || \
      echo "Could not restart services non-interactively. Set REMOTE_SUDO_PASS to enable restart."
  fi
  echo "==> Service status"
  ssh "${REMOTE}" "systemctl is-active darklock-platform; systemctl is-active darklock-bot"
fi

echo "==> Deploy complete"
echo "Open: https://admin.darklock.net/platform/download/ridgeline-ios"
