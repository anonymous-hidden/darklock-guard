#!/usr/bin/env bash
# =============================================================================
# Jarvis File Integrity Monitoring
# Hashes all Jarvis source files, checks every 5 minutes
# First run: creates baseline. Subsequent: verifies against baseline.
# =============================================================================
set -euo pipefail

JARVIS_DIR="/home/cayden/discord bot/discord bot/jarvis"
PIPELINE_DIR="/home/cayden/discord bot/discord bot/security-pipeline"
HASH_FILE="/var/lib/security-pipeline/jarvis-integrity.sha256"
HASH_DIR="$(dirname "$HASH_FILE")"
ALERT_SCRIPT="$PIPELINE_DIR/step6-playbooks/scripts/alert_me.sh"
LOG="/var/log/security-pipeline/integrity.log"

mkdir -p "$HASH_DIR" "$(dirname "$LOG")"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" | tee -a "$LOG"; }

# Generate hashes of all source files
generate_hashes() {
    local dir="$1"
    find "$dir" -type f \( \
        -name "*.py" -o -name "*.yaml" -o -name "*.yml" -o \
        -name "*.json" -o -name "*.toml" -o -name "*.sh" -o \
        -name "*.js" -o -name "*.conf" \
    \) -not -path "*/logs/*" -not -path "*/__pycache__/*" -not -path "*/data/*" \
       -not -path "*/.git/*" -not -path "*/node_modules/*" \
    | sort | while IFS= read -r file; do
        sha256sum "$file"
    done
}

if [[ "${1:-}" == "init" ]] || [[ ! -f "$HASH_FILE" ]]; then
    # --- First run: create baseline ---
    log "[INIT] Creating integrity baseline..."
    
    {
        generate_hashes "$JARVIS_DIR"
        generate_hashes "$PIPELINE_DIR"
    } > "$HASH_FILE"
    
    # Protect the hash file
    chmod 400 "$HASH_FILE"
    chattr +i "$HASH_FILE" 2>/dev/null || true  # Make immutable if possible
    
    TOTAL=$(wc -l < "$HASH_FILE")
    log "[INIT] Baseline created: $TOTAL files hashed"
    log "[INIT] Hash file: $HASH_FILE"
    exit 0
fi

# --- Verification run ---
log "[CHECK] Running integrity verification..."

# Generate current hashes
CURRENT_HASHES=$(mktemp)
trap 'rm -f "$CURRENT_HASHES"' EXIT

{
    generate_hashes "$JARVIS_DIR"
    generate_hashes "$PIPELINE_DIR"
} > "$CURRENT_HASHES"

# Compare
CHANGES=$(diff "$HASH_FILE" "$CURRENT_HASHES" 2>/dev/null || true)

if [[ -z "$CHANGES" ]]; then
    log "[OK] All files intact"
    exit 0
fi

# --- INTEGRITY VIOLATION DETECTED ---
log "[ALERT] INTEGRITY VIOLATION DETECTED!"

# Parse changes
MODIFIED=()
ADDED=()
REMOVED=()

while IFS= read -r line; do
    if [[ "$line" == ">"* ]]; then
        FILE=$(echo "$line" | sed 's/^> [a-f0-9]*  //')
        if grep -q "$FILE" "$HASH_FILE"; then
            MODIFIED+=("$FILE")
        else
            ADDED+=("$FILE")
        fi
    elif [[ "$line" == "<"* ]]; then
        FILE=$(echo "$line" | sed 's/^< [a-f0-9]*  //')
        if ! grep -q "$FILE" "$CURRENT_HASHES"; then
            REMOVED+=("$FILE")
        fi
    fi
done <<< "$CHANGES"

log "[ALERT] Modified: ${#MODIFIED[@]}, Added: ${#ADDED[@]}, Removed: ${#REMOVED[@]}"

for f in "${MODIFIED[@]}"; do log "[MODIFIED] $f"; done
for f in "${ADDED[@]}"; do log "[ADDED] $f"; done
for f in "${REMOVED[@]}"; do log "[REMOVED] $f"; done

# Send alert
MSG="INTEGRITY VIOLATION: ${#MODIFIED[@]} modified, ${#ADDED[@]} added, ${#REMOVED[@]} removed files in Jarvis/pipeline"
if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" "critical" "$MSG"
fi

# If --halt flag, stop Jarvis
if [[ "${2:-}" == "--halt" ]]; then
    log "[HALT] Stopping Jarvis due to integrity violation!"
    systemctl stop jarvis-hardened 2>/dev/null || true
    systemctl stop jarvis-security-analyst 2>/dev/null || true
fi

exit 1
