#!/usr/bin/env bash
# =============================================================================
# Attack Simulator: Brute Force — repeated failed SSH auth attempts
# SAFE: uses fake credentials against localhost
# =============================================================================
set -uo pipefail

TARGET="${1:-127.0.0.1}"
ATTEMPTS="${2:-20}"

echo "[SIM] Simulating brute force attack: $ATTEMPTS failed SSH attempts"
echo "[SIM] Target: $TARGET (localhost only)"

for i in $(seq 1 "$ATTEMPTS"); do
    # Generate fake username/password
    FAKE_USER="attacker_${RANDOM}"
    
    # Attempt SSH login with fake credentials (will fail immediately)
    sshpass -p "wrong_password_${RANDOM}" \
        ssh -o StrictHostKeyChecking=no \
            -o ConnectTimeout=2 \
            -o NumberOfPasswordPrompts=1 \
            -o PreferredAuthentications=password \
            "$FAKE_USER@$TARGET" exit 2>/dev/null || true
    
    echo "[SIM] Attempt $i/$ATTEMPTS: $FAKE_USER (failed as expected)"
    
    # Small delay to create realistic pattern
    sleep 0.2
done

echo ""
echo "[SIM] Brute force simulation complete"
echo "[SIM] Check: auditd should show auth_su/auth_login events"
echo "[SIM] Check: /var/log/auth.log should show failed attempts"
echo "[SIM] Expected: 8B triage → SUSPICIOUS/CRITICAL"
