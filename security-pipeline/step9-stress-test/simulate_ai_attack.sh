#!/usr/bin/env bash
# =============================================================================
# Attack Simulator: AI-Driven Attack Pattern
# Simulates high-velocity, low-noise, multi-vector simultaneous anomalies
# SAFE: all simulated, no real exploitation
# =============================================================================
set -uo pipefail

echo "[SIM] =========================================="
echo "[SIM] AI ATTACK SIMULATION — Multi-Vector Pattern"
echo "[SIM] =========================================="
echo "[SIM] This simulates what an AI-powered attacker looks like:"
echo "[SIM]  - Multiple attack vectors simultaneously"
echo "[SIM]  - Low individual noise (each event looks benign alone)"
echo "[SIM]  - High aggregate velocity"
echo ""

TESTDIR=$(mktemp -d /tmp/ai-attack-sim-XXXXX)
trap "rm -rf $TESTDIR" EXIT

# --- Phase 1: Concurrent reconnaissance + credential testing ---
echo "[SIM] Phase 1: Simultaneous recon + credential spray (5s)"
{
    # Recon: port scan from subprocess
    for port in 22 80 443 8080 8443 3000 5000 9000; do
        timeout 0.5 bash -c "echo '' > /dev/tcp/127.0.0.1/$port" 2>/dev/null || true
    done
} &
{
    # Credential spray: different usernames, same password
    for user in admin root deploy jenkins ci service backup; do
        sshpass -p "P@ssw0rd" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=1 \
            "$user@127.0.0.1" exit 2>/dev/null || true
    done
} &
{
    # DNS enumeration
    for sub in api admin db cache queue worker; do
        dig "$sub.internal.local" @127.0.0.1 >/dev/null 2>&1 || true
    done
} &
wait
echo "[SIM]   Phase 1 complete"

# --- Phase 2: Simultaneous persistence + privilege probing ---
echo "[SIM] Phase 2: Persistence + privilege probing (3s)"
sleep 1
{
    # Attempt cron persistence
    echo "* * * * * /tmp/beacon.sh" > "$TESTDIR/fake_cron" 2>/dev/null || true
    crontab "$TESTDIR/fake_cron" 2>/dev/null || true
    crontab -r 2>/dev/null || true  # Clean up immediately
} &
{
    # SUID probing
    find /usr -perm -4000 -type f 2>/dev/null | head -5 > "$TESTDIR/suid_enum.txt" || true
} &
{
    # Attempt authorized_keys write
    mkdir -p "$TESTDIR/.ssh"
    echo "ssh-rsa FAKE_KEY attacker@evil" > "$TESTDIR/.ssh/authorized_keys" 2>/dev/null || true
} &
{
    # Process injection probe
    cat /proc/1/maps >/dev/null 2>&1 || true
    cat /proc/1/environ >/dev/null 2>&1 || true
} &
wait
echo "[SIM]   Phase 2 complete"

# --- Phase 3: Simultaneous data staging + C2 beacon pattern ---
echo "[SIM] Phase 3: Data staging + C2 beacon simulation (5s)"
sleep 1
{
    # Data staging
    tar czf "$TESTDIR/exfil_staging.tar.gz" /etc/hostname /etc/os-release 2>/dev/null || true
} &
{
    # C2 beacon pattern: periodic outbound connections
    for i in $(seq 1 5); do
        timeout 0.5 curl -sf "http://127.0.0.1:4444/beacon?id=$RANDOM" 2>/dev/null || true
        sleep 0.5
    done
} &
{
    # Process spawning from unexpected parent
    cp /bin/echo "$TESTDIR/web_shell"
    chmod +x "$TESTDIR/web_shell"
    "$TESTDIR/web_shell" "payload_executed" 2>/dev/null || true
} &
{
    # File system tampering signals
    touch /tmp/.hidden_backdoor 2>/dev/null || true
    mkdir -p /dev/shm/.cache 2>/dev/null || true
    echo "#!/bin/bash" > "/dev/shm/.cache/runner" 2>/dev/null || true
    rm -rf /tmp/.hidden_backdoor /dev/shm/.cache 2>/dev/null || true
} &
wait
echo "[SIM]   Phase 3 complete"

echo ""
echo "[SIM] =========================================="
echo "[SIM] AI attack simulation complete"
echo "[SIM] =========================================="
echo "[SIM] Events generated across:"
echo "[SIM]   - Network: port scans, C2 beacons, lateral movement"
echo "[SIM]   - Auth: credential spray (7 users)"
echo "[SIM]   - Filesystem: SUID enum, data staging, /dev/shm writes"
echo "[SIM]   - Persistence: cron write attempt, authorized_keys"
echo "[SIM]   - Process: execution from /tmp, /dev/shm"
echo "[SIM]"
echo "[SIM] Expected pipeline response:"
echo "[SIM]   Falco → multiple rules should fire within 2s"
echo "[SIM]   8B triage → batch should classify SUSPICIOUS/CRITICAL within 5s"
echo "[SIM]   Jarvis 32B → should correlate multiple vectors, escalate to CRITICAL"
echo "[SIM]   Playbook → should trigger snapshot_and_freeze or alert_admin"
