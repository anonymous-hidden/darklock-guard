#!/bin/bash

# DARKLOCK SECURITY GATE - QUICK START
# =====================================
# Compiles and uploads Arduino firmware, then starts the backend service

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ARDUINO_PORT="${HARDWARE_SERIAL_PORT:-/dev/ttyACM0}"
ARDUINO_FQBN="arduino:avr:mega"
FIRMWARE_DIR="./hardware/darklock_security_gate"
SERVICE_FILE="./examples/darklock-integration-example.js"

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  DARKLOCK PHYSICAL SECURITY GATE - SETUP${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo -e "${RED}⚠️  Do not run as root (sudo). Run as normal user.${NC}"
  exit 1
fi

# Step 1: Check dependencies
echo -e "${YELLOW}[1/5] Checking dependencies...${NC}"

if ! command -v arduino-cli &> /dev/null; then
  echo -e "${RED}ERROR: arduino-cli not found${NC}"
  echo "Install: curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo -e "${RED}ERROR: Node.js not found${NC}"
  echo "Install: sudo apt install nodejs npm"
  exit 1
fi

echo -e "${GREEN}✓ Dependencies OK${NC}"

# Step 2: Check serial port permissions
echo -e "${YELLOW}[2/5] Checking serial port...${NC}"

if [ ! -e "$ARDUINO_PORT" ]; then
  echo -e "${RED}ERROR: Arduino not found at $ARDUINO_PORT${NC}"
  echo "Available ports:"
  ls -la /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || echo "No serial ports found"
  exit 1
fi

if [ ! -w "$ARDUINO_PORT" ]; then
  echo -e "${YELLOW}⚠️  No write permission on $ARDUINO_PORT${NC}"
  echo "Fixing permissions (may require sudo)..."
  sudo chmod 666 "$ARDUINO_PORT"
fi

echo -e "${GREEN}✓ Serial port $ARDUINO_PORT ready${NC}"

# Step 3: Compile Arduino firmware
echo -e "${YELLOW}[3/5] Compiling Arduino firmware...${NC}"

cd "$(dirname "$0")"

if [ ! -d "$FIRMWARE_DIR" ]; then
  echo -e "${RED}ERROR: Firmware directory not found: $FIRMWARE_DIR${NC}"
  exit 1
fi

arduino-cli compile --fqbn $ARDUINO_FQBN "$FIRMWARE_DIR"

if [ $? -ne 0 ]; then
  echo -e "${RED}ERROR: Compilation failed${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Firmware compiled${NC}"

# Step 4: Upload to Arduino
echo -e "${YELLOW}[4/5] Uploading firmware to Arduino...${NC}"

arduino-cli upload -p $ARDUINO_PORT --fqbn $ARDUINO_FQBN "$FIRMWARE_DIR"

if [ $? -ne 0 ]; then
  echo -e "${RED}ERROR: Upload failed${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Firmware uploaded successfully${NC}"

# Wait for Arduino to boot
echo "Waiting for Arduino to boot..."
sleep 3

# Step 5: Test serial communication
echo -e "${YELLOW}[5/5] Testing serial communication...${NC}"

# Read first few lines from serial
timeout 5 arduino-cli monitor -p $ARDUINO_PORT -c baudrate=115200 2>/dev/null | head -n 5 || true

echo -e "${GREEN}✓ Setup complete${NC}"
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Hardware ready to use${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Add your RFID card UID to authorized list:"
echo "   • Open: $FIRMWARE_DIR/darklock_security_gate.ino"
echo "   • Scan unknown card and copy UID from logs"
echo "   • Add to AUTHORIZED_CARDS array"
echo "   • Re-run this script"
echo ""
echo "2. Start the backend service:"
echo "   node $SERVICE_FILE"
echo ""
echo "3. Monitor hardware:"
echo "   arduino-cli monitor -p $ARDUINO_PORT -c baudrate=115200"
echo ""
echo -e "${YELLOW}⚠️  SECURITY: System is in FAIL CLOSED mode${NC}"
echo "   Bot will NOT start without authorized RFID card present"
echo ""
