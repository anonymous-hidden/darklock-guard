#!/usr/bin/env bash
# =============================================================================
# Playbook: snapshot_and_freeze.sh
# Dumps running process list, open connections, recent file changes
# to a forensic log, then kills attacker sessions
# =============================================================================
set -euo pipefail

LOGFILE="/var/log/security-pipeline/playbook-actions.log"
FORENSIC_DIR="/var/log/security-pipeline/forensics"
mkdir -p "$FORENSIC_DIR" "$(dirname "$LOGFILE")"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
SNAPSHOT_DIR="$FORENSIC_DIR/snapshot_${TIMESTAMP//[:.]/_}"
mkdir -p "$SNAPSHOT_DIR"

REASON="${1:-automated_snapshot_and_freeze}"

echo '{"status":"running","action":"snapshot_and_freeze","timestamp":"'"$TIMESTAMP"'"}'

# --- 1. Process list ---
ps auxww --sort=-%cpu > "$SNAPSHOT_DIR/processes.txt" 2>/dev/null || true

# --- 2. Network connections ---
ss -tunapo > "$SNAPSHOT_DIR/connections.txt" 2>/dev/null || \
    netstat -tunapo > "$SNAPSHOT_DIR/connections.txt" 2>/dev/null || true

# --- 3. Listening ports ---
ss -tlnpo > "$SNAPSHOT_DIR/listeners.txt" 2>/dev/null || true

# --- 4. Recently modified files (last 10 minutes) ---
find / -xdev -mmin -10 -type f 2>/dev/null | head -500 > "$SNAPSHOT_DIR/recent_files.txt" || true

# --- 5. Login sessions ---
who -a > "$SNAPSHOT_DIR/who.txt" 2>/dev/null || true
last -20 > "$SNAPSHOT_DIR/last_logins.txt" 2>/dev/null || true

# --- 6. Open files by suspicious processes ---
lsof -nP 2>/dev/null | head -1000 > "$SNAPSHOT_DIR/lsof.txt" || true

# --- 7. nftables / iptables rules ---
nft list ruleset > "$SNAPSHOT_DIR/nftables.txt" 2>/dev/null || true
iptables -L -n -v > "$SNAPSHOT_DIR/iptables.txt" 2>/dev/null || true

# --- 8. Loaded kernel modules ---
lsmod > "$SNAPSHOT_DIR/kernel_modules.txt" 2>/dev/null || true

# --- 9. Cron jobs ---
for user in $(cut -f1 -d: /etc/passwd); do
    crontab -u "$user" -l 2>/dev/null >> "$SNAPSHOT_DIR/crontabs.txt" || true
done

# --- 10. Environment variables of all user processes ---
for pid in $(pgrep -u "$(id -u 1000 -n 2>/dev/null || echo nobody)" 2>/dev/null | head -20); do
    echo "=== PID $pid ===" >> "$SNAPSHOT_DIR/envs.txt"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null >> "$SNAPSHOT_DIR/envs.txt" || true
done

# Restrict forensic data
chmod -R 600 "$SNAPSHOT_DIR"
chmod 700 "$SNAPSHOT_DIR"

# --- Kill suspicious sessions ---
# Find and kill any TTY sessions from non-root, non-cayden users
KILLED_SESSIONS=0
while IFS= read -r line; do
    TTY_USER=$(echo "$line" | awk '{print $1}')
    TTY_PID=$(echo "$line" | awk '{print $2}')
    if [[ "$TTY_USER" != "cayden" ]] && [[ "$TTY_USER" != "root" ]] && [[ -n "$TTY_PID" ]]; then
        kill -9 "$TTY_PID" 2>/dev/null && KILLED_SESSIONS=$((KILLED_SESSIONS + 1))
    fi
done < <(who -u 2>/dev/null | awk '{print $1, $7}')

LOG_ENTRY=$(cat <<EOF
{"timestamp":"$TIMESTAMP","action":"snapshot_and_freeze","snapshot_dir":"$SNAPSHOT_DIR","reason":"$(echo "$REASON" | tr '"' "'")","killed_sessions":$KILLED_SESSIONS,"status":"success"}
EOF
)
echo "$LOG_ENTRY" >> "$LOGFILE"
echo "$LOG_ENTRY"
