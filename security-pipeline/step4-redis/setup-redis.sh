#!/usr/bin/env bash
# =============================================================================
# Redis Setup Script — Install and configure hardened Redis for security pipeline
# =============================================================================
set -euo pipefail

log() { echo -e "\033[0;32m[+]\033[0m $1"; }
err() { echo -e "\033[0;31m[✗]\033[0m $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Must run as root"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATED_PASS=$(openssl rand -base64 32)

log "Installing Redis..."
apt-get update -qq
apt-get install -y -qq redis-server redis-tools

log "Generating secure password..."
echo "$GENERATED_PASS" > /etc/security-pipeline-redis-password
chmod 600 /etc/security-pipeline-redis-password
log "Password saved to /etc/security-pipeline-redis-password"

log "Installing hardened Redis config..."
# Replace placeholder password
sed "s|CHANGE_ME_GENERATE_WITH_openssl_rand_base64_32|${GENERATED_PASS}|g" \
    "$SCRIPT_DIR/redis-security.conf" > /etc/redis/security-pipeline.conf

# Create runtime directories
mkdir -p /var/run/redis /var/lib/redis /var/log/redis
chown redis:redis /var/run/redis /var/lib/redis /var/log/redis

# Add jarvis user to redis group for socket access
usermod -aG redis jarvis 2>/dev/null || true

log "Creating systemd service..."
cat > /etc/systemd/system/redis-security.service <<'EOF'
[Unit]
Description=Redis Security Pipeline Queue
After=network.target

[Service]
Type=notify
User=redis
Group=redis
ExecStart=/usr/bin/redis-server /etc/redis/security-pipeline.conf
ExecStop=/usr/bin/redis-cli -s /var/run/redis/redis.sock SHUTDOWN_d4e8f1a2
Restart=always
RestartSec=5
RuntimeDirectory=redis
RuntimeDirectoryMode=0755
LimitNOFILE=65536

# Security
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/redis /var/log/redis /var/run/redis
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable redis-security
systemctl start redis-security

log "Testing connection..."
sleep 1
redis-cli -s /var/run/redis/redis.sock -a "$GENERATED_PASS" --no-auth-warning ping

log "============================================"
log "Redis security pipeline ready!"
log "  Socket: /var/run/redis/redis.sock"
log "  Password: /etc/security-pipeline-redis-password"
log "  Service: redis-security"
log "============================================"

# Create env file for other services
mkdir -p /etc/security-pipeline
cat > /etc/security-pipeline/redis.env <<EOF
REDIS_SOCKET=/var/run/redis/redis.sock
REDIS_PASSWORD=${GENERATED_PASS}
EOF
chmod 600 /etc/security-pipeline/redis.env
log "Environment file: /etc/security-pipeline/redis.env"
