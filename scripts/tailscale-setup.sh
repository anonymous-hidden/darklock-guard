#!/usr/bin/env bash
# tailscale-setup.sh
# First-time Tailscale installation and setup for the DarkLock Pi5
# Run this script ON THE PI5 (not your dev machine)
#
# Usage:
#   ssh darklock@192.168.50.151
#   bash /mnt/nvme/discord-bot/scripts/tailscale-setup.sh

set -e

SUDO_PASS="0131106761Cb"

echo_step() {
  echo ""
  echo "==> $1"
}

# ─── Install Tailscale ────────────────────────────────────────────────────────

echo_step "Checking for existing Tailscale installation..."

if command -v tailscale &>/dev/null; then
  echo "Tailscale already installed: $(tailscale version | head -1)"
else
  echo_step "Installing Tailscale..."

  # Official install script (installs + configures apt repo)
  curl -fsSL https://tailscale.com/install.sh | sh

  echo "Tailscale installed: $(tailscale version | head -1)"
fi

# ─── Enable and start the daemon ─────────────────────────────────────────────

echo_step "Enabling tailscaled service..."
echo "$SUDO_PASS" | sudo -S systemctl enable --now tailscaled

# ─── Connect to your Tailnet ─────────────────────────────────────────────────

echo_step "Connecting to Tailscale network..."
echo "You will be given a URL — open it on any device to authenticate."
echo ""

# --accept-dns=false prevents Tailscale from overriding Pi5 DNS
echo "$SUDO_PASS" | sudo -S tailscale up \
  --accept-dns=false \
  --hostname=darklock-pi5

echo ""
echo_step "Waiting for authentication..."

# Poll until authenticated (max 120s)
TIMEOUT=120
ELAPSED=0
while ! tailscale status &>/dev/null; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    echo "ERROR: Timed out waiting for Tailscale auth."
    echo "Run 'sudo tailscale up' manually and authenticate."
    exit 1
  fi
  echo "  ... still waiting (${ELAPSED}s)"
done

# ─── Show result ─────────────────────────────────────────────────────────────

echo ""
echo_step "Tailscale connected!"
tailscale status
echo ""
echo "Pi5 Tailscale IP: $(tailscale ip -4)"
echo ""
echo "You can now SSH over Tailscale from anywhere:"
echo "  ssh darklock@$(tailscale ip -4)"
