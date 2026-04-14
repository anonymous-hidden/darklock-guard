#!/usr/bin/env bash
# =============================================================================
# Step 9 — Pipeline Verification Tests
# Runs each simulator and verifies the full pipeline fires:
#   Simulator → Falco (2s) → 8B Triage (5s) → Jarvis verdict (15s)
#   → Playbook trigger → Alert sent
# =============================================================================
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(dirname "$BASE_DIR")"
RESULTS_DIR="$BASE_DIR/results"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT="$RESULTS_DIR/pipeline_test_$TIMESTAMP.txt"

mkdir -p "$RESULTS_DIR"

PASSED=0
FAILED=0
TOTAL=0

log()  { echo -e "$1" | tee -a "$REPORT"; }
pass() { log "${GREEN}  ✓ PASS${NC}: $1"; PASSED=$((PASSED + 1)); }
fail() { log "${RED}  ✗ FAIL${NC}: $1"; FAILED=$((FAILED + 1)); }
info() { log "${CYAN}  ▸${NC} $1"; }

# --- Helpers ---

# Wait for a pattern in Falco logs within timeout
wait_falco() {
    local pattern="$1" timeout_sec="$2"
    local falco_log="/var/log/falco/falco_events.jsonl"
    local start_line
    start_line=$(wc -l < "$falco_log" 2>/dev/null || echo 0)
    
    for i in $(seq 1 "$timeout_sec"); do
        sleep 1
        if tail -n +"$((start_line + 1))" "$falco_log" 2>/dev/null | grep -qi "$pattern"; then
            return 0
        fi
    done
    return 1
}

# Wait for triage classification in Redis queues
wait_triage() {
    local timeout_sec="$1"
    local redis_pass
    redis_pass=$(cat /etc/security-pipeline-redis-password 2>/dev/null || echo "")
    local redis_cmd="redis-cli"
    [[ -S /var/run/redis/redis.sock ]] && redis_cmd="redis-cli -s /var/run/redis/redis.sock"
    [[ -n "$redis_pass" ]] && redis_cmd="$redis_cmd -a $redis_pass --no-auth-warning"
    
    local start_suspicious start_critical
    start_suspicious=$($redis_cmd llen jarvis:suspicious 2>/dev/null || echo 0)
    start_critical=$($redis_cmd llen jarvis:critical 2>/dev/null || echo 0)
    
    for i in $(seq 1 "$timeout_sec"); do
        sleep 1
        local now_suspicious now_critical
        now_suspicious=$($redis_cmd llen jarvis:suspicious 2>/dev/null || echo 0)
        now_critical=$($redis_cmd llen jarvis:critical 2>/dev/null || echo 0)
        if [[ "$now_suspicious" -gt "$start_suspicious" ]] || [[ "$now_critical" -gt "$start_critical" ]]; then
            return 0
        fi
    done
    return 1
}

# Check for Jarvis verdict in security_events.db
wait_verdict() {
    local service="$1" timeout_sec="$2"
    local db="$PIPELINE_DIR/step5-jarvis-security/data/security_events.db"
    
    if [[ ! -f "$db" ]]; then
        return 1
    fi
    
    local start_count
    start_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM security_events" 2>/dev/null || echo 0)
    
    for i in $(seq 1 "$timeout_sec"); do
        sleep 1
        local now_count
        now_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM security_events" 2>/dev/null || echo 0)
        if [[ "$now_count" -gt "$start_count" ]]; then
            return 0
        fi
    done
    return 1
}

# Check playbook audit log for recent action
check_playbook() {
    local action="$1"
    local audit_log="/var/log/security-pipeline/playbook-audit.jsonl"
    if [[ ! -f "$audit_log" ]]; then
        return 1
    fi
    # Check last 5 entries
    if tail -5 "$audit_log" 2>/dev/null | grep -q "\"action\":\"$action\""; then
        return 0
    fi
    return 1
}

# ============================================================================
log "${CYAN}============================================${NC}"
log "${CYAN} Security Pipeline Verification Tests${NC}"
log "${CYAN} $(date '+%Y-%m-%d %H:%M:%S')${NC}"
log "${CYAN}============================================${NC}"
log ""

# --- Pre-flight checks ---
log "${YELLOW}=== Pre-flight Checks ===${NC}"

for svc in falco-modern-bpf auditd security-triage jarvis-security-analyst playbook-runner redis-security; do
    TOTAL=$((TOTAL + 1))
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        pass "Service $svc running"
    else
        fail "Service $svc NOT running"
    fi
done

log ""

# ============================================================================
# TEST 1: Reconnaissance → Full Pipeline
# ============================================================================
log "${YELLOW}=== Test 1: Reconnaissance Detection ===${NC}"

TOTAL=$((TOTAL + 4))
info "Running recon simulator..."
bash "$BASE_DIR/simulate_recon.sh" 127.0.0.1 &>/dev/null &
SIM_PID=$!

info "Waiting for Falco detection (max 5s)..."
if wait_falco "outbound\|connection\|port" 5; then
    pass "Falco detected recon activity"
else
    fail "Falco did not detect recon within 5s"
fi

info "Waiting for triage classification (max 10s)..."
if wait_triage 10; then
    pass "8B triage classified event"
else
    fail "8B triage did not classify within 10s"
fi

info "Waiting for Jarvis verdict (max 20s)..."
if wait_verdict "falco" 20; then
    pass "Jarvis produced a verdict"
else
    fail "Jarvis verdict not produced within 20s"
fi

wait "$SIM_PID" 2>/dev/null || true

info "Checking for alert..."
if check_playbook "alert_admin" || check_playbook "block_ip"; then
    pass "Playbook triggered for recon"
else
    fail "No playbook triggered (may be expected for low-severity recon)"
fi

log ""

# ============================================================================
# TEST 2: Brute Force → Full Pipeline
# ============================================================================
log "${YELLOW}=== Test 2: Brute Force Detection ===${NC}"

TOTAL=$((TOTAL + 3))
info "Running brute force simulator (10 attempts)..."
bash "$BASE_DIR/simulate_bruteforce.sh" 127.0.0.1 10 &>/dev/null &
SIM_PID=$!

info "Waiting for Falco/auditd detection (max 5s)..."
sleep 3
if ausearch -k auth_su --start recent 2>/dev/null | grep -q "auth" || \
   tail -20 /var/log/auth.log 2>/dev/null | grep -qi "failed\|invalid"; then
    pass "Auth failure detected"
else
    fail "Auth failure not detected within 5s"
fi

info "Waiting for triage + verdict (max 25s)..."
if wait_verdict "auth" 25; then
    pass "Full pipeline processed brute force"
else
    fail "Pipeline did not process brute force within 25s"
fi

wait "$SIM_PID" 2>/dev/null || true

info "Checking for block_ip playbook..."
if check_playbook "block_ip"; then
    pass "block_ip playbook triggered"
else
    fail "block_ip playbook not triggered (may need >5 attempts to escalate)"
fi

log ""

# ============================================================================
# TEST 3: Privilege Escalation → Full Pipeline
# ============================================================================
log "${YELLOW}=== Test 3: Privilege Escalation Detection ===${NC}"

TOTAL=$((TOTAL + 2))
info "Running privesc simulator..."
bash "$BASE_DIR/simulate_privesc.sh" &>/dev/null &
SIM_PID=$!

info "Waiting for detection + classification (max 15s)..."
if wait_triage 15; then
    pass "Triage classified privesc event"
else
    fail "Triage did not classify privesc within 15s"
fi

info "Waiting for Jarvis verdict (max 20s)..."
if wait_verdict "auditd" 20; then
    pass "Jarvis produced privesc verdict"
else
    fail "Jarvis verdict not produced within 20s"
fi

wait "$SIM_PID" 2>/dev/null || true
log ""

# ============================================================================
# TEST 4: Lateral Movement → Full Pipeline
# ============================================================================
log "${YELLOW}=== Test 4: Lateral Movement Detection ===${NC}"

TOTAL=$((TOTAL + 2))
info "Running lateral movement simulator..."
bash "$BASE_DIR/simulate_lateral.sh" &>/dev/null &
SIM_PID=$!

info "Waiting for detection (max 10s)..."
if wait_falco "outbound\|unexpected\|connection" 10 || wait_triage 10; then
    pass "Lateral movement detected in pipeline"
else
    fail "Lateral movement not detected within 10s"
fi

info "Waiting for verdict (max 20s)..."
if wait_verdict "falco" 20; then
    pass "Jarvis produced lateral movement verdict"
else
    fail "Jarvis verdict not produced within 20s"
fi

wait "$SIM_PID" 2>/dev/null || true
log ""

# ============================================================================
# TEST 5: AI Attack (Multi-Vector) → Full Pipeline
# ============================================================================
log "${YELLOW}=== Test 5: AI Attack Pattern Detection ===${NC}"

TOTAL=$((TOTAL + 2))
info "Running AI attack simulator..."
bash "$BASE_DIR/simulate_ai_attack.sh" &>/dev/null &
SIM_PID=$!

info "Waiting for multi-vector detection + triage (max 20s)..."
if wait_triage 20; then
    pass "AI attack pattern classified by triage"
else
    fail "AI attack pattern not classified within 20s"
fi

info "Waiting for Jarvis multi-event verdict (max 30s)..."
if wait_verdict "falco" 30; then
    pass "Jarvis produced AI attack verdict"
else
    fail "Jarvis verdict not produced within 30s"
fi

wait "$SIM_PID" 2>/dev/null || true
log ""

# ============================================================================
# SUMMARY
# ============================================================================
log "${CYAN}============================================${NC}"
log "${CYAN} Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC} (of $((PASSED + FAILED)) checks)"
log "${CYAN} Report: $REPORT${NC}"
log "${CYAN}============================================${NC}"

exit $FAILED
