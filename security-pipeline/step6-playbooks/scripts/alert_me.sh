#!/usr/bin/env bash
# =============================================================================
# Playbook: alert_me.sh <severity> <message>
# Sends push notification via ntfy.sh (self-hosted or public)
# Also supports a custom webhook URL
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/playbook-actions.log"
mkdir -p "$(dirname "$LOGFILE")"

SEVERITY="${1:-info}"
MESSAGE="${2:-Security alert from pipeline}"

# --- Configuration: set your notification endpoints ---
# Option 1: ntfy.sh (self-hosted or public)
NTFY_URL="${NTFY_URL:-https://ntfy.sh}"
NTFY_TOPIC="${NTFY_TOPIC:-cayden-security-alerts}"

# Option 2: Custom webhook (Discord, Slack, etc.)
WEBHOOK_URL="${WEBHOOK_URL:-}"

# Validate severity
case "$SEVERITY" in
    info|warning|critical) ;;
    *) SEVERITY="info" ;;
esac

# Map severity to ntfy priority
case "$SEVERITY" in
    critical) PRIORITY="urgent" ; TAGS="rotating_light,skull" ;;
    warning)  PRIORITY="high"   ; TAGS="warning" ;;
    info)     PRIORITY="default"; TAGS="information_source" ;;
esac

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
HOST=$(hostname)

# Sanitize message — prevent injection
MESSAGE=$(echo "$MESSAGE" | tr -d '\n\r' | head -c 500)

# --- Send via ntfy.sh ---
if [[ -n "$NTFY_URL" ]]; then
    curl -sf \
        -H "Title: Security Alert [$SEVERITY] - $HOST" \
        -H "Priority: $PRIORITY" \
        -H "Tags: $TAGS" \
        -H "X-Timestamp: $TIMESTAMP" \
        -d "$MESSAGE" \
        "$NTFY_URL/$NTFY_TOPIC" >/dev/null 2>&1 || true
fi

# --- Send via webhook (JSON POST) ---
if [[ -n "$WEBHOOK_URL" ]]; then
    PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'content': f'**[{sys.argv[1]}]** {sys.argv[2]} ({sys.argv[3]})',
    'embeds': [{
        'title': f'Security Alert: {sys.argv[1].upper()}',
        'description': sys.argv[2],
        'color': {'critical': 0xFF0000, 'warning': 0xFFA500, 'info': 0x00FF00}.get(sys.argv[1], 0),
        'fields': [
            {'name': 'Host', 'value': sys.argv[3], 'inline': True},
            {'name': 'Time', 'value': sys.argv[4], 'inline': True}
        ]
    }]
}))
" "$SEVERITY" "$MESSAGE" "$HOST" "$TIMESTAMP" 2>/dev/null)
    
    curl -sf \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "$WEBHOOK_URL" >/dev/null 2>&1 || true
fi

LOG_ENTRY=$(cat <<EOF
{"timestamp":"$TIMESTAMP","action":"alert_me","severity":"$SEVERITY","message":"$(echo "$MESSAGE" | tr '"' "'")","host":"$HOST","status":"sent"}
EOF
)
echo "$LOG_ENTRY" >> "$LOGFILE"
echo "$LOG_ENTRY"
