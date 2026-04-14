#!/usr/bin/env bash
# =============================================================================
# Vector Health Check — Verifies logs are flowing from all hosts
# Run via cron: */5 * * * * /path/to/vector-healthcheck.sh
# =============================================================================
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
AGGREGATOR_LOG_DIR="/var/log/vector-aggregator/all"
EXPECTED_HOSTS=("localhost")  # Add your hostnames here
MAX_STALE_MINUTES=10          # Alert if no logs for this duration
ALERT_SCRIPT="/home/cayden/discord bot/discord bot/security-pipeline/step6-playbooks/scripts/alert_me.sh"

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; }

echo "============================================"
echo " Vector Health Check — $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

HEALTHY=0
UNHEALTHY=0

# --- Check 1: Vector process running ---
echo ""
echo "--- Service Status ---"

for svc in vector-agent vector-aggregator; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        log "$svc: RUNNING"
        HEALTHY=$((HEALTHY + 1))
    else
        fail "$svc: NOT RUNNING"
        UNHEALTHY=$((UNHEALTHY + 1))
    fi
done

# --- Check 2: Vector internal metrics ---
echo ""
echo "--- Vector Metrics ---"

# Vector exposes internal metrics on :8686 by default
if curl -sf http://127.0.0.1:8686/health >/dev/null 2>&1; then
    log "Vector API: healthy"
    HEALTHY=$((HEALTHY + 1))
else
    warn "Vector API: not reachable (may not be enabled)"
fi

# --- Check 3: Log freshness per host ---
echo ""
echo "--- Log Freshness ---"

TODAY=$(date '+%Y-%m-%d')
YESTERDAY=$(date -d 'yesterday' '+%Y-%m-%d' 2>/dev/null || date -v-1d '+%Y-%m-%d')

for host in "${EXPECTED_HOSTS[@]}"; do
    LOGFILE="$AGGREGATOR_LOG_DIR/$TODAY/${host}.jsonl"
    LOGFILE_YESTERDAY="$AGGREGATOR_LOG_DIR/$YESTERDAY/${host}.jsonl"
    
    if [[ -f "$LOGFILE" ]]; then
        # Check last modification time
        MTIME=$(stat -c %Y "$LOGFILE" 2>/dev/null || stat -f %m "$LOGFILE")
        NOW=$(date +%s)
        AGE_MINUTES=$(( (NOW - MTIME) / 60 ))
        
        if [[ $AGE_MINUTES -lt $MAX_STALE_MINUTES ]]; then
            LINES=$(wc -l < "$LOGFILE")
            log "$host: active ($LINES events today, last update ${AGE_MINUTES}m ago)"
            HEALTHY=$((HEALTHY + 1))
        else
            warn "$host: STALE (last update ${AGE_MINUTES}m ago)"
            UNHEALTHY=$((UNHEALTHY + 1))
        fi
    elif [[ -f "$LOGFILE_YESTERDAY" ]]; then
        warn "$host: no logs today (yesterday's log exists)"
        UNHEALTHY=$((UNHEALTHY + 1))
    else
        fail "$host: NO LOGS FOUND"
        UNHEALTHY=$((UNHEALTHY + 1))
    fi
done

# --- Check 4: Normalized log output exists ---
echo ""
echo "--- Local Normalized Logs ---"

LOCAL_LOG="/var/log/vector/normalized/$TODAY.jsonl"
if [[ -f "$LOCAL_LOG" ]]; then
    LINES=$(wc -l < "$LOCAL_LOG")
    log "Local normalized log: $LINES events today"
else
    warn "Local normalized log not found: $LOCAL_LOG"
fi

# --- Check 5: Source-specific flow ---
echo ""
echo "--- Source Coverage ---"

for source in falco auditd auth syslog nginx_access; do
    if [[ -f "$LOCAL_LOG" ]]; then
        COUNT=$(grep -c "\"service\":\"$source\"" "$LOCAL_LOG" 2>/dev/null || echo 0)
        if [[ $COUNT -gt 0 ]]; then
            log "$source: $COUNT events"
        else
            warn "$source: 0 events (may be normal if no activity)"
        fi
    fi
done

# --- Summary ---
echo ""
echo "============================================"
echo " Summary: $HEALTHY healthy, $UNHEALTHY issues"
echo "============================================"

# Alert if unhealthy
if [[ $UNHEALTHY -gt 0 ]]; then
    MSG="Vector health check: $UNHEALTHY issues detected. Run health check manually for details."
    if [[ -x "$ALERT_SCRIPT" ]]; then
        "$ALERT_SCRIPT" "warning" "$MSG" 2>/dev/null || true
    fi
    exit 1
fi

exit 0
