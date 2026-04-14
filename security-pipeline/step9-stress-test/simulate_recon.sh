#!/usr/bin/env bash
# =============================================================================
# Attack Simulator: Reconnaissance — rapid port scanning pattern
# SAFE: only scans localhost, no real exploitation
# =============================================================================
set -uo pipefail

TARGET="${1:-127.0.0.1}"
echo "[SIM] Simulating reconnaissance scan against $TARGET"
echo "[SIM] This is a SAFE test — local scanning only"

# Rapid port scan pattern (1000 ports in quick succession)
for port in $(seq 1 1000); do
    timeout 0.1 bash -c "echo '' > /dev/tcp/$TARGET/$port" 2>/dev/null &
    # Rate limit to avoid actual DoS
    if (( port % 100 == 0 )); then
        wait
        echo "[SIM] Scanned ports $((port-99))-$port"
    fi
done
wait

# Service enumeration pattern
echo "[SIM] Simulating service enumeration"
for svc in ssh http https ftp smtp dns mysql postgresql redis mongodb; do
    # These will fail but create the network events Falco should detect
    timeout 1 curl -sf "http://$TARGET:80/" >/dev/null 2>&1 || true
done

# OS fingerprinting attempt (benign)
timeout 2 ping -c 3 -W 1 "$TARGET" >/dev/null 2>&1 || true

echo "[SIM] Reconnaissance simulation complete"
echo "[SIM] Check: Falco should have logged unexpected outbound connections"
