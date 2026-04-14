#!/usr/bin/env bash
# =============================================================================
# Playbook: isolate_server.sh <host>
# Cuts all traffic on a host except management VLAN/port
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/playbook-actions.log"
mkdir -p "$(dirname "$LOGFILE")"

HOST="${1:-}"
REASON="${2:-automated_isolation}"

# Management access — CHANGE THESE to your management subnet/port
MGMT_SUBNET="192.168.1.0/24"
MGMT_PORT="22"
MGMT_USER_IP="192.168.1.100"  # Your admin machine

if [[ -z "$HOST" ]]; then
    echo '{"status":"error","message":"Host required"}' | tee -a "$LOGFILE"
    exit 1
fi

# Validate host format
if ! echo "$HOST" | grep -qP '^[\w\.\-]+$'; then
    echo '{"status":"error","message":"Invalid hostname format"}' | tee -a "$LOGFILE"
    exit 1
fi

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

if [[ "$HOST" == "$(hostname)" ]] || [[ "$HOST" == "localhost" ]]; then
    # --- Local isolation: lock down THIS machine ---
    
    # Create isolation nftables ruleset
    nft list table inet isolation 2>/dev/null && nft delete table inet isolation
    
    nft -f - <<NFTRULES
table inet isolation {
    chain input {
        type filter hook input priority -100; policy drop;
        # Allow loopback
        iif lo accept
        # Allow established connections
        ct state established,related accept
        # Allow management access only
        ip saddr $MGMT_SUBNET tcp dport $MGMT_PORT accept
        ip saddr $MGMT_USER_IP accept
        # Drop everything else
        counter drop
    }
    chain output {
        type filter hook output priority -100; policy drop;
        # Allow loopback
        oif lo accept
        # Allow established
        ct state established,related accept
        # Allow DNS (needed for management)
        udp dport 53 accept
        # Allow management subnet
        ip daddr $MGMT_SUBNET accept
        # Drop everything else
        counter drop
    }
}
NFTRULES
    STATUS="success"
    
else
    # --- Remote isolation via SSH ---
    # Only if SSH key auth is set up to the target
    ssh -o BatchMode=yes -o ConnectTimeout=5 "$HOST" \
        "sudo nft -f - <<'EOF'
table inet isolation {
    chain input {
        type filter hook input priority -100; policy drop;
        iif lo accept
        ct state established,related accept
        ip saddr $MGMT_SUBNET tcp dport $MGMT_PORT accept
        ip saddr $MGMT_USER_IP accept
        counter drop
    }
    chain output {
        type filter hook output priority -100; policy drop;
        oif lo accept
        ct state established,related accept
        udp dport 53 accept
        ip daddr $MGMT_SUBNET accept
        counter drop
    }
}
EOF" 2>/dev/null
    STATUS=$?
    [[ $STATUS -eq 0 ]] && STATUS="success" || STATUS="failed_ssh"
fi

LOG_ENTRY=$(cat <<EOF
{"timestamp":"$TIMESTAMP","action":"isolate_server","host":"$HOST","reason":"$REASON","mgmt_subnet":"$MGMT_SUBNET","status":"$STATUS"}
EOF
)
echo "$LOG_ENTRY" >> "$LOGFILE"
echo "$LOG_ENTRY"
