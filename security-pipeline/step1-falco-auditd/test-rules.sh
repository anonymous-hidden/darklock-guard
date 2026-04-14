#!/usr/bin/env bash
# =============================================================================
# Test script — Trigger each Falco + auditd rule to verify detection
# Run as: sudo bash test-rules.sh
# WARNING: These are safe simulations — no actual exploitation
# =============================================================================
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
TESTS=()

check() {
    local name="$1" source="$2" pattern="$3" timeout="${4:-5}"
    echo -e "${CYAN}[TEST]${NC} $name"
    
    local found=false
    
    if [[ "$source" == "falco" ]]; then
        # Check Falco log for the pattern
        local before_lines
        before_lines=$(wc -l < /var/log/falco/falco_events.jsonl 2>/dev/null || echo 0)
        eval "$5" 2>/dev/null || true
        sleep "$timeout"
        local after_content
        after_content=$(tail -n +$((before_lines + 1)) /var/log/falco/falco_events.jsonl 2>/dev/null || true)
        if echo "$after_content" | grep -qi "$pattern"; then
            found=true
        fi
    elif [[ "$source" == "auditd" ]]; then
        eval "$5" 2>/dev/null || true
        sleep 2
        if ausearch -k "$pattern" --start recent 2>/dev/null | grep -q "$pattern"; then
            found=true
        fi
    fi
    
    if $found; then
        echo -e "  ${GREEN}✓ PASS${NC} — Rule fired"
        PASSED=$((PASSED + 1))
    else
        echo -e "  ${RED}✗ FAIL${NC} — Rule did not fire (check logs manually)"
        FAILED=$((FAILED + 1))
    fi
}

echo "============================================"
echo " Security Pipeline Rule Verification Tests"
echo "============================================"
echo ""

[[ $EUID -ne 0 ]] && { echo -e "${RED}Must run as root${NC}"; exit 1; }

# Create temp directory for test artifacts
TESTDIR=$(mktemp -d /tmp/security-test-XXXXX)
trap "rm -rf $TESTDIR" EXIT

# -----------------------------------------------------------------------
# FALCO RULE TESTS
# -----------------------------------------------------------------------
echo -e "${YELLOW}=== Falco Rule Tests ===${NC}"

# Test 1: Process in /tmp
echo -e "${CYAN}[TEST]${NC} Process execution from /tmp"
cp /bin/echo "$TESTDIR/malicious_binary"
chmod +x "$TESTDIR/malicious_binary"
"$TESTDIR/malicious_binary" "test" 2>/dev/null
sleep 2
if tail -20 /var/log/falco/falco_events.jsonl 2>/dev/null | grep -qi "suspicious"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — Verify in Falco logs"
    FAILED=$((FAILED + 1))
fi

# Test 2: Privilege escalation — setuid attempt
echo -e "${CYAN}[TEST]${NC} SUID binary creation attempt"
cp /bin/echo "$TESTDIR/suid_test"
chmod 4755 "$TESTDIR/suid_test" 2>/dev/null || true
sleep 2
if tail -20 /var/log/falco/falco_events.jsonl 2>/dev/null | grep -qi "suid\|chmod"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC}"
    FAILED=$((FAILED + 1))
fi

# Test 3: Reverse shell pattern (simulated — connects to localhost)
echo -e "${CYAN}[TEST]${NC} Reverse shell pattern detection"
# This will fail to connect but Falco should catch the pattern
timeout 2 bash -c 'echo test > /dev/tcp/127.0.0.1/9999' 2>/dev/null || true
sleep 2
if tail -20 /var/log/falco/falco_events.jsonl 2>/dev/null | grep -qi "reverse_shell\|shell"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC}"
    FAILED=$((FAILED + 1))
fi

# Test 4: Sensitive file write attempt
echo -e "${CYAN}[TEST]${NC} Sensitive file write detection (/etc/crontab touch)"
touch /etc/crontab 2>/dev/null || true
sleep 2
if tail -20 /var/log/falco/falco_events.jsonl 2>/dev/null | grep -qi "sensitive\|crontab"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC}"
    FAILED=$((FAILED + 1))
fi

# Test 5: SSH authorized_keys modification attempt
echo -e "${CYAN}[TEST]${NC} SSH authorized_keys modification detection"
touch /tmp/test_authorized_keys
# Simulate write to authorized_keys path
echo "# test" >> /root/.ssh/authorized_keys_test 2>/dev/null || true
rm -f /root/.ssh/authorized_keys_test 2>/dev/null
sleep 2
if tail -20 /var/log/falco/falco_events.jsonl 2>/dev/null | grep -qi "authorized_keys"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC}"
    FAILED=$((FAILED + 1))
fi

echo ""

# -----------------------------------------------------------------------
# AUDITD RULE TESTS
# -----------------------------------------------------------------------
echo -e "${YELLOW}=== Auditd Rule Tests ===${NC}"

# Test 6: Auth events
echo -e "${CYAN}[TEST]${NC} Authentication event logging"
# Trigger a failed su
echo "" | su - nonexistent_user_test 2>/dev/null || true
sleep 2
if ausearch -k auth_su --start recent 2>/dev/null | grep -q "su"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k auth_su"
    FAILED=$((FAILED + 1))
fi

# Test 7: Sudo usage
echo -e "${CYAN}[TEST]${NC} Sudo usage logging"
sudo echo "audit test" >/dev/null 2>&1 || true
sleep 2
if ausearch -k sudo_usage --start recent 2>/dev/null | grep -q "sudo"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k sudo_usage"
    FAILED=$((FAILED + 1))
fi

# Test 8: File permission changes
echo -e "${CYAN}[TEST]${NC} File permission change logging"
chmod 777 "$TESTDIR/malicious_binary" 2>/dev/null || true
sleep 2
if ausearch -k perm_change --start recent 2>/dev/null | grep -q "chmod"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k perm_change"
    FAILED=$((FAILED + 1))
fi

# Test 9: Cron modification
echo -e "${CYAN}[TEST]${NC} Cron modification detection"
touch /etc/cron.d/test_security_audit 2>/dev/null || true
rm -f /etc/cron.d/test_security_audit 2>/dev/null
sleep 2
if ausearch -k cron_modification --start recent 2>/dev/null | grep -q "cron"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k cron_modification"
    FAILED=$((FAILED + 1))
fi

# Test 10: SUID binary detection via auditd
echo -e "${CYAN}[TEST]${NC} SUID binary creation (auditd)"
cp /bin/echo "$TESTDIR/suid_audit_test"
chmod 4755 "$TESTDIR/suid_audit_test" 2>/dev/null || true
sleep 2
if ausearch -k suid_sgid_creation --start recent 2>/dev/null | grep -q "suid"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k suid_sgid_creation"
    FAILED=$((FAILED + 1))
fi

# Test 11: Kernel module logging
echo -e "${CYAN}[TEST]${NC} Kernel module operation logging"
modprobe -n dummy 2>/dev/null || true
sleep 2
if ausearch -k kernel_module --start recent 2>/dev/null | grep -q "modprobe\|module"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k kernel_module"
    FAILED=$((FAILED + 1))
fi

# Test 12: User modification
echo -e "${CYAN}[TEST]${NC} User database access logging"
cat /etc/shadow >/dev/null 2>&1 || true
sleep 2
if ausearch -k auth_shadow_modification --start recent 2>/dev/null | grep -q "shadow"; then
    echo -e "  ${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "  ${YELLOW}~ CHECK${NC} — ausearch -k auth_shadow_modification"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "============================================"
echo -e " Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED need manual check${NC}"
echo "============================================"
echo ""
echo "Manual verification commands:"
echo "  Falco:  tail -50 /var/log/falco/falco_events.jsonl | jq ."
echo "  Auditd: ausearch -k <key> --start recent"
echo "  Keys:   auth_su, sudo_usage, perm_change, cron_modification,"
echo "          suid_sgid_creation, kernel_module, auth_shadow_modification"

# Cleanup
rm -rf "$TESTDIR"
