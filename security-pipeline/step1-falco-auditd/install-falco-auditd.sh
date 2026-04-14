#!/usr/bin/env bash
# =============================================================================
# Step 1 — Install Falco (modern eBPF driver) + auditd
# Target: Zorin OS / Ubuntu (Debian-based)
# Run as root: sudo bash install-falco-auditd.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# --- Pre-flight checks ---
[[ $EUID -ne 0 ]] && err "Must run as root (sudo)"
[[ ! -f /etc/os-release ]] && err "Cannot detect OS"

source /etc/os-release
log "Detected: $PRETTY_NAME"

ARCH=$(dpkg --print-architecture)
CODENAME=$(lsb_release -cs 2>/dev/null || echo "jammy")
log "Architecture: $ARCH, Codename: $CODENAME"

# --- System update ---
log "Updating package lists..."
apt-get update -qq

# =============================================================================
# PART 1: Install Falco (modern eBPF — no kernel module needed)
# =============================================================================
log "Installing Falco dependencies..."
apt-get install -y -qq curl gnupg2 software-properties-common \
    linux-headers-"$(uname -r)" dkms clang llvm

# Add Falco GPG key and repository
log "Adding Falco repository..."
curl -fsSL https://falco.org/repo/falcosecurity-packages.asc | \
    gpg --dearmor -o /usr/share/keyrings/falco-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/falco-archive-keyring.gpg] https://download.falco.org/packages/deb stable main" \
    > /etc/apt/sources.list.d/falcosecurity.list

apt-get update -qq

# Install Falco — select modern_ebpf driver during install
log "Installing Falco..."
FALCO_FRONTEND=noninteractive apt-get install -y -qq falco

# Configure Falco to use modern eBPF driver
log "Configuring Falco for modern eBPF..."
mkdir -p /etc/falco

# Override the driver to use modern_ebpf (no kernel module needed)
cat > /etc/falco/falco.yaml <<'FALCOCONF'
# Falco configuration — modern eBPF driver
# Modified for security pipeline integration

# Use modern eBPF (no kernel module, works on recent kernels)
engine:
  kind: modern_ebpf

# Output settings
json_output: true
json_include_output_property: true
json_include_tags_property: true

# Log output to file (Vector will tail this)
file_output:
  enabled: true
  keep_alive: true
  filename: /var/log/falco/falco_events.jsonl

# Syslog output (backup)
syslog_output:
  enabled: true

# stdout for debugging
stdout_output:
  enabled: false

# HTTP output (can be used by Vector)
http_output:
  enabled: true
  url: http://127.0.0.1:5140/falco
  user_agent: "falco/security-pipeline"

# Program output for custom alerting
program_output:
  enabled: false

# gRPC (for programmatic access)
grpc:
  enabled: true
  bind_address: "unix:///run/falco/falco.sock"
  threadiness: 4

grpc_output:
  enabled: true

# Priority filter — log everything notice and above
priority: notice

# Buffer sizes
syscall_buf_size_preset: 4

# Rules files
rules:
  - /etc/falco/falco_rules.yaml
  - /etc/falco/falco_rules.local.yaml
  - /etc/falco/rules.d

# Watch config for hot reload
watch_config_files: true
FALCOCONF

# Create log directory
mkdir -p /var/log/falco
chown falco:falco /var/log/falco 2>/dev/null || true

# Create rules directory
mkdir -p /etc/falco/rules.d

# =============================================================================
# PART 2: Install auditd
# =============================================================================
log "Installing auditd..."
apt-get install -y -qq auditd audispd-plugins

# Enable audit logging in a useful format
log "Configuring auditd..."
cat > /etc/audit/auditd.conf <<'AUDITDCONF'
# auditd configuration for security pipeline
log_file = /var/log/audit/audit.log
log_format = ENRICHED
log_group = adm
priority_boost = 4
flush = INCREMENTAL_ASYNC
freq = 50
num_logs = 10
max_log_file = 50
max_log_file_action = ROTATE
space_left = 75
space_left_action = SYSLOG
admin_space_left = 50
admin_space_left_action = SUSPEND
disk_full_action = SUSPEND
disk_error_action = SUSPEND
tcp_listen_queue = 5
tcp_max_per_addr = 1
tcp_client_max_idle = 0
enable_krb5 = no
krb5_principal = auditd
distribute_network = no
write_logs = yes
AUDITDCONF

# =============================================================================
# PART 3: Enable and start services
# =============================================================================
log "Enabling systemd services..."

# Falco systemd override for modern eBPF
mkdir -p /etc/systemd/system/falco-modern-bpf.service.d
cat > /etc/systemd/system/falco-modern-bpf.service.d/override.conf <<'SVCOVERRIDE'
[Service]
Restart=always
RestartSec=5
# Ensure Falco can access eBPF
AmbientCapabilities=CAP_BPF CAP_SYS_RESOURCE CAP_SYS_PTRACE
SVCOVERRIDE

systemctl daemon-reload
systemctl enable --now falco-modern-bpf.service || {
    warn "falco-modern-bpf not found, trying falco.service"
    systemctl enable --now falco.service
}
systemctl enable --now auditd.service

log "Verifying services..."
systemctl is-active --quiet falco-modern-bpf 2>/dev/null || systemctl is-active --quiet falco && \
    log "Falco: RUNNING" || warn "Falco: NOT RUNNING"
systemctl is-active --quiet auditd && \
    log "auditd: RUNNING" || warn "auditd: NOT RUNNING"

# =============================================================================
# PART 4: Copy custom rules
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$SCRIPT_DIR/falco_rules.local.yaml" ]]; then
    log "Installing custom Falco rules..."
    cp "$SCRIPT_DIR/falco_rules.local.yaml" /etc/falco/falco_rules.local.yaml
    # Hot-reload Falco
    kill -SIGHUP "$(pidof falco)" 2>/dev/null || true
fi

if [[ -f "$SCRIPT_DIR/audit.rules" ]]; then
    log "Installing custom auditd rules..."
    cp "$SCRIPT_DIR/audit.rules" /etc/audit/rules.d/99-security-pipeline.rules
    augenrules --load
fi

log "============================================"
log "Installation complete!"
log "  Falco logs:  /var/log/falco/falco_events.jsonl"
log "  Audit logs:  /var/log/audit/audit.log"
log "  Custom Falco rules: /etc/falco/falco_rules.local.yaml"
log "  Custom audit rules: /etc/audit/rules.d/99-security-pipeline.rules"
log "============================================"
