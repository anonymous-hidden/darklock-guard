#!/usr/bin/env bash
# =============================================================================
# Attack Simulator: Lateral Movement
# SAFE: unexpected outbound connections from service processes
# =============================================================================
set -uo pipefail

echo "[SIM] Simulating lateral movement patterns"

# 1. Unexpected outbound connection from a "service" process
echo "[SIM] Creating unexpected outbound connections..."
# These connections will fail but Falco should flag the attempt
for port in 22 445 3389 5985; do
    timeout 1 bash -c "echo '' > /dev/tcp/10.0.0.1/$port" 2>/dev/null || true
    echo "[SIM]   Attempted connection to 10.0.0.1:$port"
done

# 2. Simulate service process making unexpected DNS lookups
echo "[SIM] Simulating suspicious DNS lookups..."
for domain in evil-c2.example.com data-exfil.test.local internal-pivot.corp; do
    nslookup "$domain" >/dev/null 2>&1 || true
    dig "$domain" >/dev/null 2>&1 || true
done

# 3. Simulate SSH lateral movement attempt
echo "[SIM] Simulating SSH pivoting attempt..."
for host in 192.168.1.{50,51,52,53,54}; do
    timeout 1 ssh -o BatchMode=yes -o ConnectTimeout=1 "nobody@$host" exit 2>/dev/null || true
    echo "[SIM]   Attempted SSH to $host"
done

# 4. Simulate data staging (writing to /tmp)
echo "[SIM] Simulating data staging in /tmp..."
STAGE_DIR=$(mktemp -d /tmp/lateral-staging-XXXXX)
dd if=/dev/urandom of="$STAGE_DIR/staged_data.bin" bs=1024 count=100 2>/dev/null
echo "[SIM]   Created staged data: $STAGE_DIR/staged_data.bin"
rm -rf "$STAGE_DIR"

echo ""
echo "[SIM] Lateral movement simulation complete"
echo "[SIM] Check: Falco → unexpected outbound connections"
echo "[SIM] Check: auditd → network_socket events"
