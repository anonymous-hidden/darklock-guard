#!/usr/bin/env bash
# =============================================================================
# Step 10 — Weekly Prompt Injection Test Automation
# Sets up a weekly cron job + systemd timer to run the injection test suite
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Setting up weekly prompt injection test automation...${NC}"

# ---------------------------------------------------------------------------
# 1. Install Python dependencies
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}[1/4] Checking Python dependencies...${NC}"
pip3 install httpx 2>/dev/null || pip install httpx 2>/dev/null || true

# ---------------------------------------------------------------------------
# 2. Create the weekly runner wrapper script
# ---------------------------------------------------------------------------
RUNNER_SCRIPT="$SCRIPT_DIR/run_weekly_injection_tests.sh"

cat > "$RUNNER_SCRIPT" << 'RUNNER_EOF'
#!/usr/bin/env bash
# Weekly injection test runner — called by systemd timer or cron
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PIPELINE_DIR/logs"
RESULTS_DIR="$SCRIPT_DIR/results"

mkdir -p "$LOG_DIR" "$RESULTS_DIR"

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/injection_test_$TIMESTAMP.log"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================"
echo " Weekly Prompt Injection Test Suite"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

# Check if services are up
SERVICES_OK=true
for svc in security-triage jarvis-security-analyst; do
    if ! systemctl is-active --quiet "$svc" 2>/dev/null; then
        echo "WARNING: $svc is not running"
        SERVICES_OK=false
    fi
done

if ! $SERVICES_OK; then
    echo "Some services are down. Running sanitizer-only tests..."
    STAGES="sanitizer"
else
    STAGES="sanitizer,triage,jarvis"
fi

# Run the test harness
echo ""
echo "Running injection tests (stages: $STAGES)..."
python3 "$SCRIPT_DIR/injection_test_harness.py" \
    --stages "$STAGES" \
    --output "$RESULTS_DIR" \
    --verbose

EXIT_CODE=$?

echo ""
echo "Test exit code: $EXIT_CODE"

# Send notification with results
if command -v curl &>/dev/null; then
    NTFY_TOPIC="${NTFY_TOPIC:-jarvis-security}"
    LATEST_REPORT=$(ls -t "$RESULTS_DIR"/injection_test_*.txt 2>/dev/null | head -1)

    if [[ -n "$LATEST_REPORT" ]]; then
        SUMMARY=$(head -10 "$LATEST_REPORT")
    else
        SUMMARY="Test completed with exit code $EXIT_CODE"
    fi

    if [[ $EXIT_CODE -gt 0 ]]; then
        PRIORITY="high"
        TITLE="⚠️ Injection Test: $EXIT_CODE failures"
    else
        PRIORITY="default"
        TITLE="✅ Injection Test: All passed"
    fi

    curl -s \
        -H "Title: $TITLE" \
        -H "Priority: $PRIORITY" \
        -H "Tags: security,injection-test" \
        -d "$SUMMARY" \
        "https://ntfy.sh/$NTFY_TOPIC" 2>/dev/null || true
fi

# Prune old reports (keep last 12 weeks)
find "$RESULTS_DIR" -name "injection_test_*" -mtime +84 -delete 2>/dev/null || true
find "$LOG_DIR" -name "injection_test_*" -mtime +84 -delete 2>/dev/null || true

exit $EXIT_CODE
RUNNER_EOF

chmod +x "$RUNNER_SCRIPT"
echo -e "${GREEN}  Created: $RUNNER_SCRIPT${NC}"

# ---------------------------------------------------------------------------
# 3. Create systemd timer (preferred over cron)
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}[2/4] Creating systemd timer...${NC}"

if [[ $EUID -eq 0 ]]; then
    cat > /etc/systemd/system/injection-test.service << EOF
[Unit]
Description=Weekly Prompt Injection Test Suite
After=network.target security-triage.service jarvis-security-analyst.service
Wants=security-triage.service jarvis-security-analyst.service

[Service]
Type=oneshot
User=jarvis
Group=jarvis
WorkingDirectory=$SCRIPT_DIR
ExecStart=/bin/bash $RUNNER_SCRIPT
Environment=NTFY_TOPIC=jarvis-security

# Security hardening
ProtectSystem=strict
ReadWritePaths=$PIPELINE_DIR/logs $SCRIPT_DIR/results
PrivateTmp=true
NoNewPrivileges=true
ProtectHome=true
ProtectKernelModules=true

# Resource limits
MemoryMax=1G
CPUQuota=50%
TimeoutStartSec=900
EOF

    cat > /etc/systemd/system/injection-test.timer << EOF
[Unit]
Description=Run prompt injection tests weekly

[Timer]
OnCalendar=Sun *-*-* 03:00:00
RandomizedDelaySec=1800
Persistent=true

[Install]
WantedBy=timers.target
EOF

    systemctl daemon-reload
    systemctl enable injection-test.timer
    systemctl start injection-test.timer

    echo -e "${GREEN}  Systemd timer enabled: Sundays at 03:00 (±30min jitter)${NC}"
    echo -e "  Check status: systemctl list-timers injection-test.timer"
else
    echo -e "  Skipping systemd timer (not root). Install manually:"
    echo -e "  sudo cp injection-test.{service,timer} /etc/systemd/system/"
    echo -e "  sudo systemctl daemon-reload && sudo systemctl enable --now injection-test.timer"
fi

# ---------------------------------------------------------------------------
# 4. Also install cron fallback
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}[3/4] Installing cron fallback...${NC}"

CRON_ENTRY="0 3 * * 0 /bin/bash $RUNNER_SCRIPT >> $PIPELINE_DIR/logs/injection_cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "injection_test_harness\|run_weekly_injection"; then
    echo "  Cron entry already exists — skipping"
else
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo -e "${GREEN}  Cron installed: Sundays at 03:00${NC}"
fi

# ---------------------------------------------------------------------------
# 5. Create requirements.txt
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}[4/4] Writing requirements.txt...${NC}"

cat > "$SCRIPT_DIR/requirements.txt" << 'EOF'
httpx>=0.27.0
EOF

echo -e "${GREEN}  Created: $SCRIPT_DIR/requirements.txt${NC}"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN} Setup complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Files created:"
echo "  $RUNNER_SCRIPT"
echo "  $SCRIPT_DIR/requirements.txt"
if [[ $EUID -eq 0 ]]; then
    echo "  /etc/systemd/system/injection-test.service"
    echo "  /etc/systemd/system/injection-test.timer"
fi
echo ""
echo "To run tests manually:"
echo "  python3 $SCRIPT_DIR/injection_test_harness.py --verbose"
echo ""
echo "To run the full weekly suite manually:"
echo "  bash $RUNNER_SCRIPT"
