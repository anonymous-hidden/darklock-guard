#!/usr/bin/env bash
# =============================================================================
# Generate self-signed TLS certificates for Vector agent <-> aggregator
# Creates: CA cert, aggregator cert, agent cert
# =============================================================================
set -euo pipefail

CERT_DIR="${1:-/home/cayden/discord bot/discord bot/security-pipeline/step2-vector/certs}"
DAYS=3650  # 10-year validity for internal certs
AGGREGATOR_IP="${2:-127.0.0.1}"
AGGREGATOR_HOSTNAME="${3:-vector-aggregator}"

log() { echo -e "\033[0;32m[+]\033[0m $1"; }

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

log "Generating Certificate Authority (CA)..."
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days $DAYS -key ca.key \
    -out ca.crt \
    -subj "/C=US/ST=TX/O=SecurityPipeline/CN=SecurityPipelineCA"

log "Generating Aggregator certificate..."
openssl genrsa -out aggregator.key 4096
openssl req -new -key aggregator.key \
    -out aggregator.csr \
    -subj "/C=US/ST=TX/O=SecurityPipeline/CN=$AGGREGATOR_HOSTNAME"

# Create SAN extension for aggregator
cat > aggregator_ext.cnf <<EOF
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = $AGGREGATOR_HOSTNAME
DNS.2 = localhost
IP.1 = $AGGREGATOR_IP
IP.2 = 127.0.0.1
EOF

openssl x509 -req -days $DAYS \
    -in aggregator.csr \
    -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out aggregator.crt \
    -extfile aggregator_ext.cnf -extensions v3_req

log "Generating Agent certificate..."
openssl genrsa -out agent.key 4096
openssl req -new -key agent.key \
    -out agent.csr \
    -subj "/C=US/ST=TX/O=SecurityPipeline/CN=vector-agent"

cat > agent_ext.cnf <<EOF
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = vector-agent
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -days $DAYS \
    -in agent.csr \
    -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out agent.crt \
    -extfile agent_ext.cnf -extensions v3_req

# Clean up CSRs and temp files
rm -f *.csr *.cnf ca.srl

# Restrict key permissions
chmod 600 *.key
chmod 644 *.crt

log "Certificates generated in: $CERT_DIR"
log "Files:"
ls -la "$CERT_DIR"

echo ""
echo "To deploy:"
echo "  Aggregator: copy ca.crt, aggregator.crt, aggregator.key to /etc/vector/certs/"
echo "  Agents:     copy ca.crt, agent.crt, agent.key to /etc/vector/certs/"
