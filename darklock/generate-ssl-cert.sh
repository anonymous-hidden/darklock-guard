#!/bin/bash
# Generate self-signed SSL certificate for local development

CERT_DIR="./ssl"
mkdir -p "$CERT_DIR"

echo "Generating self-signed SSL certificate for local development..."

openssl req -x509 -newkey rsa:4096 -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
  -days 365 -nodes \
  -subj "/C=US/ST=Local/L=Local/O=Darklock/OU=Development/CN=localhost"

chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"

echo "✅ SSL certificate generated in $CERT_DIR/"
echo "   - Certificate: $CERT_DIR/cert.pem"
echo "   - Private Key: $CERT_DIR/key.pem"
echo ""
echo "⚠ Note: This is a self-signed certificate. Your browser will show a security warning."
echo "   You'll need to accept it to proceed."
