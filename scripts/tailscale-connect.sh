#!/usr/bin/env bash
# tailscale-connect.sh
# Quick Tailscale status check and reconnect helper for the DarkLock Pi5
# Run this FROM YOUR DEV MACHINE to check/reconnect the Pi5's Tailscale node
#
# Usage:
#   bash scripts/tailscale-connect.sh             # check status
#   bash scripts/tailscale-connect.sh --reconnect # force reconnect
#   bash scripts/tailscale-connect.sh --restart   # restart tailscaled daemon

set -e

PI5_HOST="darklock@192.168.50.151"
PI5_SUDO_PASS="0131106761Cb"
TAILSCALE_IP="100.117.105.41"

# ─── Helpers ─────────────────────────────────────────────────────────────────

ssh_pi5() {
  ssh "$PI5_HOST" "$@"
}

sudo_pi5() {
  ssh "$PI5_HOST" "echo '$PI5_SUDO_PASS' | sudo -S $*"
}

echo_banner() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $1"
  echo "══════════════════════════════════════════"
}

# ─── Status ──────────────────────────────────────────────────────────────────

show_status() {
  echo_banner "Pi5 Tailscale Status"
  echo ""

  echo "  LAN IP:       192.168.50.151"
  echo "  Tailscale IP: ${TAILSCALE_IP}"
  echo ""

  echo "--- tailscale status ---"
  ssh_pi5 "tailscale status 2>&1" || echo "(failed to reach Pi5 — is it on LAN?)"
  echo ""

  echo "--- tailscaled service ---"
  ssh_pi5 "systemctl is-active tailscaled && echo 'daemon: running' || echo 'daemon: STOPPED'" 2>/dev/null
}

# ─── Reconnect ───────────────────────────────────────────────────────────────

reconnect() {
  echo_banner "Reconnecting Tailscale on Pi5"
  echo ""
  echo "If the auth expired, you'll receive a login URL."
  echo ""

  ssh_pi5 "echo '$PI5_SUDO_PASS' | sudo -S tailscale up --accept-dns=false --hostname=darklock-pi5"

  echo ""
  echo "New Tailscale IP: $(ssh_pi5 'tailscale ip -4 2>/dev/null')"
}

# ─── Restart daemon ──────────────────────────────────────────────────────────

restart_daemon() {
  echo_banner "Restarting tailscaled on Pi5"
  echo ""

  sudo_pi5 "systemctl restart tailscaled"
  sleep 2
  ssh_pi5 "systemctl is-active tailscaled && echo 'tailscaled: running' || echo 'tailscaled: FAILED'"

  echo ""
  echo "Tailscale status:"
  ssh_pi5 "tailscale status 2>&1 | head -10"
}

# ─── Test connectivity ───────────────────────────────────────────────────────

test_connection() {
  echo_banner "Testing Tailscale SSH to Pi5"
  echo ""

  echo "Pinging ${TAILSCALE_IP}..."
  if ping -c 3 -W 3 "$TAILSCALE_IP" &>/dev/null; then
    echo "  ICMP: OK"
  else
    echo "  ICMP: unreachable (Tailscale may be down or not routed)"
  fi

  echo ""
  echo "Testing SSH over Tailscale..."
  if ssh -o ConnectTimeout=5 "darklock@${TAILSCALE_IP}" "echo 'SSH: OK'" 2>/dev/null; then
    :
  else
    echo "  SSH over Tailscale: FAILED"
    echo "  Try: bash scripts/tailscale-connect.sh --reconnect"
  fi
}

# ─── Dispatch ────────────────────────────────────────────────────────────────

case "${1:-}" in
  --reconnect)
    reconnect
    ;;
  --restart)
    restart_daemon
    ;;
  --test)
    test_connection
    ;;
  "")
    show_status
    ;;
  *)
    echo "Usage: $0 [--reconnect | --restart | --test]"
    echo ""
    echo "  (no args)     Show Tailscale status"
    echo "  --reconnect   Re-run 'tailscale up' (use if IP changed or auth expired)"
    echo "  --restart     Restart the tailscaled daemon"
    echo "  --test        Test ICMP and SSH reachability over Tailscale"
    exit 1
    ;;
esac
