#!/usr/bin/env bash
# =============================================================================
# Install Vector (Datadog's log collector) on Zorin OS / Ubuntu
# =============================================================================
set -euo pipefail

log() { echo -e "\033[0;32m[+]\033[0m $1"; }
err() { echo -e "\033[0;31m[✗]\033[0m $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Must run as root"

log "Installing Vector..."
curl --proto '=https' --tlsv1.2 -sSfL https://sh.vector.dev | bash -s -- -y

# Verify installation
vector --version || err "Vector installation failed"

# Create directories
mkdir -p /etc/vector /var/lib/vector /var/log/vector

log "Vector installed successfully"
log "Configure with files in /etc/vector/"
