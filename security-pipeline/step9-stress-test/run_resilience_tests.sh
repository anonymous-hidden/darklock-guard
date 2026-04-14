#!/usr/bin/env bash
# =============================================================================
# Step 9 — Jarvis Resilience Tests
# Tests: kill Jarvis mid-analysis, tamper with source files
# Verifies watchdog detects and fallback activates
# =============================================================================
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PIPELINE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$(dirname "$0")/results"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT="$RESULTS_DIR/resilience_test_$TIMESTAMP.txt"

mkdir -p "$RESULTS_DIR"

PASSED=0
FAILED=0

log()  { echo -e "$1" | tee -a "$REPORT"; }
pass() { log "${GREEN}  ✓ PASS${NC}: $1"; PASSED=$((PASSED + 1)); }
fail() { log "${RED}  ✗ FAIL${NC}: $1"; FAILED=$((FAILED + 1)); }
info() { log "${CYAN}  ▸${NC} $1"; }

[[ $EUID -ne 0 ]] && { echo "Must run as root for resilience tests"; exit 1; }

log "${CYAN}============================================${NC}"
log "${CYAN} Jarvis Resilience Tests${NC}"
log "${CYAN} $(date '+%Y-%m-%d %H:%M:%S')${NC}"
log "${CYAN}============================================${NC}"
log ""

# ============================================================================
# TEST 1: Kill Jarvis mid-analysis, verify watchdog + fallback
# ============================================================================
log "${YELLOW}=== Test 1: Jarvis Crash Recovery ===${NC}"

info "Checking Jarvis and watchdog are running..."
JARVIS_RUNNING=false
WATCHDOG_RUNNING=false

if systemctl is-active --quiet jarvis-security-analyst 2>/dev/null; then
    JARVIS_RUNNING=true
    info "Jarvis security analyst: running"
else
    info "Jarvis security analyst: not running (starting for test)"
    systemctl start jarvis-security-analyst 2>/dev/null || true
    sleep 3
    systemctl is-active --quiet jarvis-security-analyst 2>/dev/null && JARVIS_RUNNING=true
fi

if systemctl is-active --quiet jarvis-watchdog 2>/dev/null; then
    WATCHDOG_RUNNING=true
    info "Watchdog: running"
else
    info "Watchdog: not running (starting for test)"
    systemctl start jarvis-watchdog 2>/dev/null || true
    sleep 2
    systemctl is-active --quiet jarvis-watchdog 2>/dev/null && WATCHDOG_RUNNING=true
fi

if $JARVIS_RUNNING; then
    # Grab Jarvis PID and kill it
    JARVIS_PID=$(systemctl show jarvis-security-analyst --property=MainPID --value 2>/dev/null || echo "")
    
    info "Killing Jarvis (PID: $JARVIS_PID) to simulate crash..."
    kill -9 "$JARVIS_PID" 2>/dev/null || true
    
    # Wait for watchdog to detect (max 90s — heartbeat interval is 30s, 3 failures)
    info "Waiting for watchdog to detect crash (max 120s)..."
    DETECTED=false
    for i in $(seq 1 120); do
        sleep 1
        # Check if fallback mode activated
        if [[ -f /var/run/security-pipeline/fallback-active ]]; then
            DETECTED=true
            break
        fi
        # Check watchdog log
        if journalctl -u jarvis-watchdog --since "2 minutes ago" 2>/dev/null | grep -qi "JARVIS DOWN\|heartbeat.*fail"; then
            DETECTED=true
            break
        fi
        if (( i % 15 == 0 )); then
            info "Still waiting... ${i}s elapsed"
        fi
    done
    
    if $DETECTED; then
        pass "Watchdog detected Jarvis crash"
    else
        fail "Watchdog did not detect crash within 120s"
    fi
    
    # Check if fallback mode activated
    if [[ -f /var/run/security-pipeline/fallback-active ]]; then
        pass "Fallback mode activated automatically"
    else
        fail "Fallback mode did not activate"
    fi
    
    # Check if Jarvis auto-restarted (systemd Restart=always)
    info "Waiting for systemd to restart Jarvis (max 15s)..."
    sleep 10
    if systemctl is-active --quiet jarvis-security-analyst 2>/dev/null; then
        pass "Jarvis auto-restarted by systemd"
    else
        fail "Jarvis did not auto-restart"
    fi
    
    # Deactivate fallback mode
    info "Deactivating fallback mode..."
    bash "$PIPELINE_DIR/step7-hardening/fallback-mode.sh" deactivate 2>/dev/null || true
    
else
    fail "Could not start Jarvis for crash test — skipping"
fi

log ""

# ============================================================================
# TEST 2: File Integrity Tampering Detection
# ============================================================================
log "${YELLOW}=== Test 2: File Integrity Tampering ===${NC}"

INTEGRITY_SCRIPT="$PIPELINE_DIR/step7-hardening/integrity-check.sh"

if [[ ! -x "$INTEGRITY_SCRIPT" ]]; then
    chmod +x "$INTEGRITY_SCRIPT" 2>/dev/null || true
fi

# Ensure baseline exists
HASH_FILE="/var/lib/security-pipeline/jarvis-integrity.sha256"
if [[ ! -f "$HASH_FILE" ]]; then
    info "Creating integrity baseline first..."
    bash "$INTEGRITY_SCRIPT" init 2>/dev/null
fi

if [[ -f "$HASH_FILE" ]]; then
    # Tamper with a source file (safely — add a comment and then remove it)
    TAMPER_TARGET="$PIPELINE_DIR/step5-jarvis-security/security_analyst.py"
    
    if [[ -f "$TAMPER_TARGET" ]]; then
        # Remove immutable flag temporarily if set
        chattr -i "$HASH_FILE" 2>/dev/null || true
        
        # Save original
        cp "$TAMPER_TARGET" "$TAMPER_TARGET.bak"
        
        # Tamper: add a line
        echo "# TAMPER_TEST_$(date +%s)" >> "$TAMPER_TARGET"
        
        info "Tampered with security_analyst.py, running integrity check..."
        
        INTEGRITY_OUTPUT=$(bash "$INTEGRITY_SCRIPT" 2>&1)
        INTEGRITY_EXIT=$?
        
        if [[ $INTEGRITY_EXIT -ne 0 ]]; then
            pass "Integrity check detected file tampering"
        else
            fail "Integrity check did NOT detect tampering"
        fi
        
        if echo "$INTEGRITY_OUTPUT" | grep -qi "MODIFIED\|VIOLATION\|ALERT"; then
            pass "Integrity check reported correct violation details"
        else
            fail "Integrity check did not report details"
        fi
        
        # Restore original
        mv "$TAMPER_TARGET.bak" "$TAMPER_TARGET"
        info "Restored original file"
        
        # Re-protect hash file
        chattr +i "$HASH_FILE" 2>/dev/null || true
    else
        fail "Tamper target not found: $TAMPER_TARGET"
    fi
else
    fail "Integrity baseline not found — run integrity-check.sh init"
fi

log ""

# ============================================================================
# TEST 3: Heartbeat Signature Verification
# ============================================================================
log "${YELLOW}=== Test 3: Heartbeat Crypto Verification ===${NC}"

HEARTBEAT_SCRIPT="$PIPELINE_DIR/step7-hardening/heartbeat.py"

# Test: generate keys, emit a heartbeat, verify it
info "Testing heartbeat crypto..."

# Generate keys if needed
python3 "$HEARTBEAT_SCRIPT" generate-keys 2>/dev/null

# Emit a heartbeat
python3 "$HEARTBEAT_SCRIPT" test-emit 2>/dev/null

# Verify it
VERIFY_OUTPUT=$(python3 "$HEARTBEAT_SCRIPT" test-verify 2>&1)

if echo "$VERIFY_OUTPUT" | grep -q "True"; then
    pass "Heartbeat signature verified correctly"
else
    fail "Heartbeat signature verification failed: $VERIFY_OUTPUT"
fi

# Tamper with the heartbeat file and verify it fails
HB_FILE="/var/run/security-pipeline/jarvis-heartbeat.json"
if [[ -f "$HB_FILE" ]]; then
    # Modify the heartbeat
    sed -i 's/"status": "alive"/"status": "compromised"/' "$HB_FILE" 2>/dev/null || true
    
    VERIFY_OUTPUT=$(python3 "$HEARTBEAT_SCRIPT" test-verify 2>&1)
    if echo "$VERIFY_OUTPUT" | grep -q "False"; then
        pass "Tampered heartbeat correctly rejected"
    else
        fail "Tampered heartbeat was not rejected"
    fi
    
    # Emit a fresh valid heartbeat
    python3 "$HEARTBEAT_SCRIPT" test-emit 2>/dev/null
fi

log ""

# ============================================================================
# SUMMARY
# ============================================================================
log "${CYAN}============================================${NC}"
log "${CYAN} Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
log "${CYAN} Report: $REPORT${NC}"
log "${CYAN}============================================${NC}"

exit $FAILED
