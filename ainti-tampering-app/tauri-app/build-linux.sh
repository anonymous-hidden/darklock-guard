#!/bin/bash
# Build script for Darklock Guard Linux installers
# Run this on a Linux system with Rust and Node.js installed

set -e

echo "======================================"
echo "Building Darklock Guard for Linux"
echo "======================================"

# Check dependencies
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo not found. Install from: https://rustup.rs"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: Node.js/npm not found. Install from: https://nodejs.org"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Build for Linux (deb and rpm)
echo "Building Linux packages..."
npm run tauri build -- -b deb,rpm

# Also create a portable tar.gz
echo "Creating portable tar.gz archive..."
cd src-tauri/target/release
if [ -f "darklock-guard" ]; then
    tar -czf darklock-guard-linux-x64.tar.gz darklock-guard
    echo "Created portable archive: darklock-guard-linux-x64.tar.gz"
fi

echo ""
echo "======================================"
echo "Build Complete!"
echo "======================================"
echo "Output files:"
find src-tauri/target/release/bundle -name "*.deb" -o -name "*.rpm" -o -name "*.tar.gz"
echo ""
echo "Copy these files to: darklock/downloads/"
