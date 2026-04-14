#!/usr/bin/env bash
# =============================================================================
# Fallback Mode — Activates when Jarvis goes down
# Blocks all new inbound connections except whitelisted IPs
# Stays active until manual re-enable
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/fallback.log"
ALERT_SCRIPT="/home/cayden/discord bot/discord bot/security-pipeline/step6-playbooks/scripts/alert_me.sh"
STATE_FILE="/var/run/security-pipeline/fallback-active"

mkdir -p "$(dirname "$LOGFILE")" "$(dirname "$STATE_FILE")"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" | tee -a "$LOGFILE"; }

# --- Whitelisted IPs (CHANGE THESE) ---
WHITELIST_IPS=(
    "192.168.1.100"    # Your admin machine
    "192.168.1.1"      # Router/gateway
    # Add more as needed
)

# --- Management port ---
MGMT_PORT="22"

ACTION="${1:-status}"

case "$ACTION" in
    activate)
        log "[FALLBACK] ACTIVATING fallback mode — Jarvis is DOWN"
        
        # Create nftables fallback ruleset
        nft list table inet fallback_mode 2>/dev/null && nft delete table inet fallback_mode
        
        # Build whitelist rules
        WHITELIST_RULES=""
        for ip in "${WHITELIST_IPS[@]}"; do
            WHITELIST_RULES+="        ip saddr $ip accept
"
        done
        
        nft -f - <<NFTRULES
table inet fallback_mode {
    chain input {
        type filter hook input priority -50; policy drop;
        
        # Allow loopback
        iif lo accept
        
        # Allow established connections
        ct state established,related accept
        
        # Allow whitelisted IPs
${WHITELIST_RULES}
        # Allow management SSH from anyone (emergency access)
        tcp dport $MGMT_PORT accept
        
        # Allow ICMP (ping)
        ip protocol icmp accept
        ip6 nexthdr ipv6-icmp accept
        
        # Log and drop everything else
        counter log prefix "FALLBACK_DROP: " drop
    }
    chain output {
        type filter hook output priority -50; policy accept;
        # Allow all outbound (we need to send alerts)
    }
}
NFTRULES
        
        # Mark fallback as active
        echo "activated $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATE_FILE"
        
        log "[FALLBACK] Firewall rules applied — only whitelisted IPs can connect"
        
        # Send alert
        [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" "critical" \
            "FALLBACK MODE ACTIVATED: Jarvis is down. Only whitelisted IPs can connect. Manual intervention required."
        ;;
    
    deactivate)
        log "[FALLBACK] DEACTIVATING fallback mode"
        
        # Remove fallback rules
        nft delete table inet fallback_mode 2>/dev/null || true
        
        # Remove state file
        rm -f "$STATE_FILE"
        
        log "[FALLBACK] Fallback mode deactivated — normal traffic restored"
        
        [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" "info" \
            "Fallback mode deactivated. Normal operation restored."
        ;;
    
    status)
        if [[ -f "$STATE_FILE" ]]; then
            echo "FALLBACK ACTIVE since: $(cat "$STATE_FILE")"
            echo "Whitelisted IPs: ${WHITELIST_IPS[*]}"
            nft list table inet fallback_mode 2>/dev/null || echo "No fallback rules found"
            exit 1
        else
            echo "Fallback mode: INACTIVE"
            exit 0
        fi
        ;;
    
    *)
        echo "Usage: $0 {activate|deactivate|status}"
        exit 1
        ;;
esac
