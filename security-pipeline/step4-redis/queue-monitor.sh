#!/usr/bin/env bash
# =============================================================================
# Redis Queue Health Monitor
# Alerts if jarvis:critical queue depth exceeds threshold
# Run via cron: * * * * * /path/to/queue-monitor.sh
# =============================================================================
set -uo pipefail

REDIS_SOCKET="/var/run/redis/redis.sock"
REDIS_PASS_FILE="/etc/security-pipeline-redis-password"
CRITICAL_THRESHOLD=50
SUSPICIOUS_THRESHOLD=200
ALERT_SCRIPT="/home/cayden/discord bot/discord bot/security-pipeline/step6-playbooks/scripts/alert_me.sh"

# Read password
REDIS_PASS=""
[[ -f "$REDIS_PASS_FILE" ]] && REDIS_PASS=$(cat "$REDIS_PASS_FILE")

redis_cmd() {
    if [[ -S "$REDIS_SOCKET" ]]; then
        redis-cli -s "$REDIS_SOCKET" -a "$REDIS_PASS" --no-auth-warning "$@" 2>/dev/null
    else
        redis-cli -a "$REDIS_PASS" --no-auth-warning "$@" 2>/dev/null
    fi
}

# Check Redis is alive
if ! redis_cmd ping | grep -q "PONG"; then
    echo "[CRITICAL] Redis is DOWN"
    [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" "critical" "Redis security queue is DOWN — events cannot be queued for Jarvis"
    exit 1
fi

# Check queue depths
CRITICAL_DEPTH=$(redis_cmd llen "jarvis:critical" 2>/dev/null || echo "0")
SUSPICIOUS_DEPTH=$(redis_cmd llen "jarvis:suspicious" 2>/dev/null || echo "0")

echo "Queue depths: critical=$CRITICAL_DEPTH suspicious=$SUSPICIOUS_DEPTH"

if [[ "$CRITICAL_DEPTH" -gt "$CRITICAL_THRESHOLD" ]]; then
    MSG="CRITICAL queue backlog: $CRITICAL_DEPTH events pending (threshold: $CRITICAL_THRESHOLD). Jarvis may be down!"
    echo "[ALERT] $MSG"
    [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" "critical" "$MSG"
    exit 1
fi

if [[ "$SUSPICIOUS_DEPTH" -gt "$SUSPICIOUS_THRESHOLD" ]]; then
    MSG="SUSPICIOUS queue growing: $SUSPICIOUS_DEPTH events pending (threshold: $SUSPICIOUS_THRESHOLD)"
    echo "[WARN] $MSG"
    [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" "warning" "$MSG"
fi

echo "[OK] Queue depths within limits"
exit 0
