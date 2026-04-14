#!/usr/bin/env bash
# =============================================================================
# Playbook: kill_process.sh <pid> <reason>
# Takes /proc snapshot first, then SIGKILL
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/playbook-actions.log"
FORENSIC_DIR="/var/log/security-pipeline/forensics"
mkdir -p "$FORENSIC_DIR" "$(dirname "$LOGFILE")"

PID="${1:-}"
REASON="${2:-automated_kill}"

if [[ -z "$PID" ]]; then
    echo '{"status":"error","message":"PID required"}' | tee -a "$LOGFILE"
    exit 1
fi

# Validate PID is numeric
if ! [[ "$PID" =~ ^[0-9]+$ ]]; then
    echo '{"status":"error","message":"Invalid PID format"}' | tee -a "$LOGFILE"
    exit 1
fi

# Prevent killing PID 1 or our own process tree
if [[ "$PID" -le 2 ]]; then
    echo '{"status":"error","message":"Cannot kill system processes"}' | tee -a "$LOGFILE"
    exit 1
fi

# Prevent killing this script's process tree
if [[ "$PID" == "$$" ]] || [[ "$PID" == "$PPID" ]]; then
    echo '{"status":"error","message":"Cannot kill own process"}' | tee -a "$LOGFILE"
    exit 1
fi

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
SNAPSHOT_FILE="$FORENSIC_DIR/proc_${PID}_${TIMESTAMP//[:.]/_}.json"

# --- Take /proc snapshot before killing ---
if [[ -d "/proc/$PID" ]]; then
    PROC_CMDLINE=$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null || echo "unknown")
    PROC_EXE=$(readlink -f "/proc/$PID/exe" 2>/dev/null || echo "unknown")
    PROC_CWD=$(readlink -f "/proc/$PID/cwd" 2>/dev/null || echo "unknown")
    PROC_STATUS=$(cat "/proc/$PID/status" 2>/dev/null || echo "unknown")
    PROC_ENVIRON=$(tr '\0' '\n' < "/proc/$PID/environ" 2>/dev/null | head -50 || echo "unknown")
    PROC_FD_COUNT=$(ls "/proc/$PID/fd" 2>/dev/null | wc -l || echo "0")
    PROC_CONNECTIONS=$(cat "/proc/$PID/net/tcp" 2>/dev/null | head -20 || echo "none")
    PROC_MAPS=$(head -30 "/proc/$PID/maps" 2>/dev/null || echo "none")

    cat > "$SNAPSHOT_FILE" <<SNAP
{
  "snapshot_timestamp": "$TIMESTAMP",
  "pid": $PID,
  "reason": "$(echo "$REASON" | tr '"' "'")",
  "cmdline": "$(echo "$PROC_CMDLINE" | tr '"' "'")",
  "exe": "$PROC_EXE",
  "cwd": "$PROC_CWD",
  "fd_count": $PROC_FD_COUNT,
  "status": $(echo "$PROC_STATUS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '"error"'),
  "connections": $(echo "$PROC_CONNECTIONS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '"error"'),
  "memory_maps_head": $(echo "$PROC_MAPS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '"error"')
}
SNAP
    chmod 600 "$SNAPSHOT_FILE"
    SNAP_STATUS="captured"
else
    SNAP_STATUS="process_not_found"
fi

# --- Kill the process ---
if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null
    KILL_STATUS="killed"
else
    KILL_STATUS="already_dead"
fi

LOG_ENTRY=$(cat <<EOF
{"timestamp":"$TIMESTAMP","action":"kill_process","pid":$PID,"reason":"$(echo "$REASON" | tr '"' "'")","snapshot":"$SNAPSHOT_FILE","snapshot_status":"$SNAP_STATUS","kill_status":"$KILL_STATUS"}
EOF
)
echo "$LOG_ENTRY" >> "$LOGFILE"
echo "$LOG_ENTRY"
