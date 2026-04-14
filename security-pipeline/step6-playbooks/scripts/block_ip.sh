#!/usr/bin/env bash
# =============================================================================
# Playbook: block_ip.sh <ip>
# Adds an nftables drop rule for the specified IP, logs the action
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/playbook-actions.log"
mkdir -p "$(dirname "$LOGFILE")"

# --- Input validation ---
IP="${1:-}"
REASON="${2:-automated_block}"

if [[ -z "$IP" ]]; then
    echo '{"status":"error","message":"IP address required"}' | tee -a "$LOGFILE"
    exit 1
fi

# Validate IP format (IPv4 or IPv6)
if ! echo "$IP" | grep -qP '^(\d{1,3}\.){3}\d{1,3}$' && \
   ! echo "$IP" | grep -qP '^[0-9a-fA-F:]+$'; then
    echo '{"status":"error","message":"Invalid IP format"}' | tee -a "$LOGFILE"
    exit 1
fi

# Prevent blocking localhost/loopback
if [[ "$IP" == "127.0.0.1" ]] || [[ "$IP" == "::1" ]] || [[ "$IP" == "0.0.0.0" ]]; then
    echo '{"status":"error","message":"Cannot block loopback address"}' | tee -a "$LOGFILE"
    exit 1
fi

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# --- Add nftables rule ---
# Check if nftables table exists, create if not
nft list table inet security_pipeline 2>/dev/null || \
    nft add table inet security_pipeline

nft list chain inet security_pipeline blocked 2>/dev/null || \
    nft add chain inet security_pipeline blocked '{ type filter hook input priority -10; policy accept; }'

# Add the drop rule
nft add rule inet security_pipeline blocked ip saddr "$IP" drop 2>/dev/null || \
nft add rule inet security_pipeline blocked ip6 saddr "$IP" drop 2>/dev/null

# --- Log the action ---
LOG_ENTRY=$(cat <<EOF
{"timestamp":"$TIMESTAMP","action":"block_ip","ip":"$IP","reason":"$REASON","executor":"playbook","status":"success"}
EOF
)
echo "$LOG_ENTRY" >> "$LOGFILE"

echo "$LOG_ENTRY"
