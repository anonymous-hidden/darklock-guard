#!/usr/bin/env bash
# =============================================================================
# Vector systemd services — agent + aggregator
# =============================================================================
set -euo pipefail

log() { echo -e "\033[0;32m[+]\033[0m $1"; }
[[ $EUID -ne 0 ]] && { echo "Must run as root"; exit 1; }

MODE="${1:-agent}"  # "agent" or "aggregator"

if [[ "$MODE" == "agent" ]]; then
    log "Creating Vector agent service..."
    cat > /etc/systemd/system/vector-agent.service <<'EOF'
[Unit]
Description=Vector Log Agent
Documentation=https://vector.dev
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vector
Group=vector
ExecStart=/usr/bin/vector --config /etc/vector/vector-agent.toml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

# Security hardening
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vector /var/log/vector
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

    # Create vector user if not exists
    id vector &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin vector
    
    # Ensure vector can read log files
    usermod -aG adm vector 2>/dev/null || true
    usermod -aG systemd-journal vector 2>/dev/null || true
    
    mkdir -p /var/lib/vector /var/log/vector
    chown vector:vector /var/lib/vector /var/log/vector

    systemctl daemon-reload
    systemctl enable vector-agent
    log "Vector agent service created. Start with: systemctl start vector-agent"

elif [[ "$MODE" == "aggregator" ]]; then
    log "Creating Vector aggregator service..."
    cat > /etc/systemd/system/vector-aggregator.service <<'EOF'
[Unit]
Description=Vector Log Aggregator
Documentation=https://vector.dev
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vector
Group=vector
ExecStart=/usr/bin/vector --config /etc/vector/vector-aggregator.toml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

# Security hardening
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vector-aggregator /var/log/vector-aggregator
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

    id vector &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin vector
    
    mkdir -p /var/lib/vector-aggregator /var/log/vector-aggregator/{all,critical,warning,info}
    chown -R vector:vector /var/lib/vector-aggregator /var/log/vector-aggregator

    systemctl daemon-reload
    systemctl enable vector-aggregator
    log "Vector aggregator service created. Start with: systemctl start vector-aggregator"
fi
