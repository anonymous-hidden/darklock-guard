#!/usr/bin/env bash
# =============================================================================
# Attack Simulator: Privilege Escalation
# SAFE: attempts that will fail but generate detectable events
# =============================================================================
set -uo pipefail

TESTDIR=$(mktemp -d /tmp/privesc-sim-XXXXX)
trap "rm -rf $TESTDIR" EXIT

echo "[SIM] Simulating privilege escalation attempts"

# 1. Attempt to read /etc/shadow (will fail if not root)
echo "[SIM] Attempting /etc/shadow read..."
cat /etc/shadow >/dev/null 2>&1 || echo "[SIM]   Denied (expected)"

# 2. Attempt sudo with wrong password
echo "[SIM] Attempting unauthorized sudo..."
echo "wrong_password" | sudo -S whoami 2>/dev/null || echo "[SIM]   Denied (expected)"

# 3. Create a fake SUID binary
echo "[SIM] Attempting SUID binary creation..."
cp /bin/echo "$TESTDIR/suid_test"
chmod 4755 "$TESTDIR/suid_test" 2>/dev/null || echo "[SIM]   chmod 4755 denied (expected)"

# 4. Attempt to write to /etc/passwd
echo "[SIM] Attempting /etc/passwd write..."
echo "# test" >> /etc/passwd 2>/dev/null || echo "[SIM]   Denied (expected)"

# 5. Try to modify sudoers
echo "[SIM] Attempting sudoers modification..."
echo "# test" >> /etc/sudoers 2>/dev/null || echo "[SIM]   Denied (expected)"

# 6. Try pkexec
echo "[SIM] Attempting pkexec escalation..."
timeout 2 pkexec --help >/dev/null 2>&1 || true

# 7. Simulate capability manipulation
echo "[SIM] Attempting capability check..."
which getcap >/dev/null 2>&1 && getcap -r / 2>/dev/null | head -5 || true

echo ""
echo "[SIM] Privilege escalation simulation complete"
echo "[SIM] Check: Falco → SUID creation, setuid calls"
echo "[SIM] Check: auditd → sudo_usage, auth_shadow_modification, suid_sgid_creation"
