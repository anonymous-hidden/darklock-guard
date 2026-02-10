# Darklock Hardware-Backed RFID Control System

> **🆕 NEW: Raspberry Pi 5 + RC522 Implementation Available!**  
> See [**RFID_INTEGRATION_GUIDE.md**](./RFID_INTEGRATION_GUIDE.md) for the latest Pi 5 native implementation with systemd service.  
> The guide below covers the legacy Arduino Mega setup.

**Complete Implementation Guide**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Hardware Setup](#hardware-setup)
4. [Software Installation](#software-installation)
5. [Configuration](#configuration)
6. [Integration Guide](#integration-guide)
7. [Security Model](#security-model)
8. [Failure Modes](#failure-modes)
9. [Troubleshooting](#troubleshooting)
10. [API Reference](#api-reference)

---

## Overview

The Darklock RFID Control System enforces **physical presence verification** for critical operations on your Discord bot and admin web panel. This system uses an Arduino Mega with an RC522 RFID reader to create a hardware security gate that cannot be bypassed through software alone.

### Key Features

- ✅ **FAIL CLOSED**: Default state is NO ACCESS
- ✅ **Hardware-backed**: Cannot be bypassed via software
- ✅ **Real-time verification**: Continuous presence monitoring
- ✅ **Audit logging**: All access attempts logged with UID hashes
- ✅ **Multi-layer security**: Works alongside passwords and 2FA

### Protected Operations

1. **Discord Bot Shutdown/Restart** - Requires RFID presence
2. **Admin Panel Access** - Password + RFID dual authentication
3. **Critical Commands** - Bot control commands gated by RFID

---

## Architecture

```
┌─────────────────┐
│  RFID Card/Fob  │
└────────┬────────┘
         │ 13.56MHz
         ▼
┌─────────────────┐
│  RC522 Reader   │  (SPI, 3.3V ONLY)
└────────┬────────┘
         │ SPI
         ▼
┌─────────────────┐
│  Arduino Mega   │  Firmware: darklock_rfid_presence.ino
│     2560        │  Protocol: PRESENCE_GRANTED/REVOKED
└────────┬────────┘
         │ USB Serial @115200
         ▼
┌─────────────────┐
│ Raspberry Pi 5  │
│                 │
│ ┌─────────────┐ │
│ │ Python      │ │  rfid_presence_service.py
│ │ Service     │ │  Port: 5555
│ └──────┬──────┘ │
│        │ HTTP   │
│ ┌──────▼──────┐ │
│ │ Discord Bot │ │  /botctl command
│ └─────────────┘ │
│ ┌─────────────┐ │
│ │ Web Admin   │ │  /admin unlock
│ └─────────────┘ │
└─────────────────┘
```

### Communication Protocol

**Arduino → Raspberry Pi:**
```
PRESENCE_GRANTED:ABCD1234EF567890  # UID detected
PRESENCE_REVOKED:CARD_TIMEOUT      # Card removed
STATUS:READY:PRESENT:12345         # Status response
ERROR:INVALID_UID_SIZE             # Error message
```

**Raspberry Pi → Arduino:**
```
PING       # Keepalive check
STATUS     # Query current state
RESET      # Force revoke presence
```

---

## Hardware Setup

### Bill of Materials

| Component | Specs | Quantity | Notes |
|-----------|-------|----------|-------|
| Raspberry Pi 5 | 4GB+ RAM | 1 | Running bot/admin panel |
| Arduino Mega 2560 | Genuine or clone | 1 | Must support SPI |
| RC522 RFID Reader | 13.56MHz MFRC522 | 1 | **3.3V ONLY** |
| RFID Cards/Fobs | MIFARE 13.56MHz | 2+ | For authorized users |
| USB Cable | Type B (Arduino) | 1 | For serial communication |
| Jumper Wires | Male-Female | 7 | For RC522 connections |

### Wiring Diagram

```
RC522 Pin  →  Arduino Mega Pin
─────────────────────────────────
3.3V       →  3.3V  ⚠️ NEVER 5V!
GND        →  GND
SDA (SS)   →  Pin 53
SCK        →  Pin 52
MOSI       →  Pin 51
MISO       →  Pin 50
RST        →  Pin 49
IRQ        →  Not connected
```

### ⚠️ CRITICAL SAFETY WARNINGS

1. **NEVER connect RC522 to 5V** - This will destroy the reader instantly
2. **Use 3.3V pin ONLY** on Arduino Mega
3. **Do not use pins 0 and 1** (reserved for USB serial)
4. **Verify wiring BEFORE powering on**

### Physical Installation

1. **Mount RFID reader** in accessible location near admin workstation
2. **Secure Arduino** to prevent tampering/disconnection
3. **Route USB cable** to Raspberry Pi USB port
4. **Test card read distance** (typically 2-5cm)

---

## Software Installation

### Step 1: Arduino Firmware

1. Install Arduino IDE on your computer
2. Install MFRC522 library:
   - Open Arduino IDE
   - Go to: Sketch → Include Library → Manage Libraries
   - Search for "MFRC522"
   - Install "MFRC522 by GithubCommunity"

3. Upload firmware:
   ```bash
   # Open firmware file
   arduino-ide hardware/darklock_rfid_presence.ino
   
   # In Arduino IDE:
   # - Select: Tools → Board → Arduino Mega 2560
   # - Select: Tools → Port → /dev/ttyACM0 (or similar)
   # - Click: Upload (→ button)
   ```

4. Verify operation:
   ```bash
   # Open Serial Monitor (Ctrl+Shift+M)
   # Baud rate: 115200
   # You should see: "SYSTEM:READY"
   ```

### Step 2: Raspberry Pi Service

1. Transfer files to Pi:
   ```bash
   scp -r hardware/ pi@your-pi-ip:/home/cayden/discord\ bot/discord\ bot/
   ```

2. Install system service:
   ```bash
   ssh pi@your-pi-ip
   cd "/home/cayden/discord bot/discord bot/hardware"
   sudo ./install_hardware_service.sh
   ```

3. Configure authorized UIDs (see Configuration section)

4. Enable and start service:
   ```bash
   sudo systemctl enable darklock-hardware
   sudo systemctl start darklock-hardware
   sudo systemctl status darklock-hardware
   ```

### Step 3: Discord Bot Integration

The bot integration happens automatically through the `/botctl` command:

```javascript
// Command is already created at:
// src/commands/admin/botctl.js

// To use:
// /botctl status   - Check hardware gate status
// /botctl shutdown - Shutdown bot (requires RFID)
// /botctl restart  - Restart bot (requires RFID)
```

### Step 4: Web Admin Integration

Add to your admin panel login route:

```javascript
// In darklock/routes/auth.js or similar:
const { verifyRFIDForLogin } = require('../middleware/rfid');

router.post('/login', async (req, res) => {
    // ... existing password verification ...
    
    // After password verified:
    if (passwordVerified) {
        // Check RFID presence
        const rfidCheck = await verifyRFIDForLogin(username, true);
        
        if (!rfidCheck.success) {
            return res.status(403).json({
                success: false,
                rfidRequired: true,
                message: rfidCheck.message,
                instructions: rfidCheck.instructions
            });
        }
        
        // RFID verified - proceed with login
        // ... create session, etc ...
    }
});
```

---

## Configuration

### 1. Find Your RFID Card UIDs

Run the standalone service to discover UIDs:

```bash
cd hardware
python3 rfid_presence_service.py --port /dev/ttyACM0 --verbose

# Output will show:
# 🔓 PRESENCE GRANTED - UID: ABCD1234EF567890
# Scan each card you want to authorize and note the UID
```

### 2. Configure Authorized UIDs

Edit the system configuration:

```bash
sudo nano /etc/darklock/hardware.env
```

Set these values:

```bash
# Enable the hardware gate
HARDWARE_GATE_ENABLED=true

# Serial port (find with: ls /dev/ttyACM*)
RFID_SERIAL_PORT=/dev/ttyACM0

# Baud rate (must match Arduino firmware)
RFID_BAUD_RATE=115200

# Timeout before presence expires
RFID_PRESENCE_TIMEOUT=5

# YOUR AUTHORIZED CARDS (comma-separated, no spaces)
RFID_AUTHORIZED_UIDS=ABCD1234EF567890,1234567890ABCDEF
```

### 3. Enable in Bot/Admin Panel

Set environment variables:

```bash
# In your main .env file
HARDWARE_GATE_ENABLED=true
HARDWARE_API_URL=http://localhost:5555
RFID_CHECK_ENABLED=true
```

### 4. Restart Services

```bash
sudo systemctl restart darklock-hardware
sudo systemctl restart discord-bot  # Your bot service
sudo systemctl restart darklock-web  # Your web panel service
```

---

## Integration Guide

### Discord Bot Commands

The `/botctl` command is automatically available. To use:

1. **Check Status:**
   ```
   /botctl status
   ```
   Shows bot uptime, hardware gate state, and last RFID scan time.

2. **Shutdown Bot:**
   ```
   /botctl shutdown confirmation:SHUTDOWN
   ```
   Requires:
   - Administrator permission
   - RFID card present at moment of execution
   - Exact confirmation keyword

3. **Restart Bot:**
   ```
   /botctl restart confirmation:RESTART
   ```
   Same requirements as shutdown.

### Web Admin Panel

The admin panel unlock flow:

```
User enters password
        ↓
Password verified
        ↓
Request RFID scan → Show message: "Please scan RFID card"
        ↓
RFID verified
        ↓
Grant admin session
```

Frontend implementation example:

```javascript
// In login form submit handler:
const response = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
});

const data = await response.json();

if (data.rfidRequired) {
    // Show RFID prompt
    showRFIDPrompt(data.message, data.instructions);
    // Poll for RFID presence and retry
} else if (data.success) {
    // Login successful
    window.location.href = '/admin';
}
```

### Custom Protected Routes

Protect any route with RFID:

```javascript
const { requireRFIDPresence } = require('../middleware/rfid');

router.post('/admin/dangerous-action',
    requireAuth,           // Standard auth first
    requireRFIDPresence,   // Then RFID check
    async (req, res) => {
        // Action only executes if RFID present
        res.json({ success: true });
    }
);
```

---

## Security Model

### Defense in Depth

The system uses multiple security layers:

```
Layer 1: Discord/Web Permissions (Role-based)
    ↓
Layer 2: Password Authentication
    ↓
Layer 3: 2FA (if enabled)
    ↓
Layer 4: RFID Physical Presence ⭐ THIS SYSTEM
    ↓
Layer 5: Audit Logging
```

### Security Principles

1. **FAIL CLOSED**
   - Default state: No access
   - If Arduino disconnects → No access
   - If service fails → No access
   - Never cache "presence" state

2. **Hardware Root of Trust**
   - RFID reader physically connected
   - Cannot be emulated via software
   - UID transmitted over USB serial
   - No network-based spoofing possible

3. **Presence ≠ Authentication**
   - RFID is a GATE, not authentication
   - Still requires password + permissions
   - RFID proves physical access
   - Cannot login with RFID alone

4. **Audit Trail**
   - All presence events logged
   - UID stored as SHA256 hash
   - Timestamps for all operations
   - Tamper-evident logging

### What This Prevents

✅ **Remote shutdown attacks** - Attacker needs physical RFID card  
✅ **Credential theft** - Password alone insufficient for admin access  
✅ **Malicious scripts** - Cannot trigger shutdown without hardware  
✅ **Social engineering** - Physical card cannot be "socially engineered"  

### What This Does NOT Prevent

❌ **Physical theft of RFID card** - Protect your cards!  
❌ **Arduino firmware modification** - Secure physical access to hardware  
❌ **Relay attacks** - Keep reader in secure location  

---

## Failure Modes

### Scenario: Arduino Unplugged

**Behavior:**
- Python service detects serial disconnect
- Presence state → `ABSENT`
- All protected operations → DENIED

**Recovery:**
1. Reconnect Arduino USB cable
2. Service auto-reconnects (if `auto_reconnect=True`)
3. Scan card to restore presence

**Logs:**
```
[RFID] Serial disconnected, reconnecting...
[RFID] State change: present → error (SERIAL_DISCONNECT)
```

### Scenario: RFID Reader Failure

**Behavior:**
- Arduino detects reader init failure
- Emits: `ERROR:RFID_INIT_FAILED`
- Python service → `ERROR` state
- All operations → DENIED

**Recovery:**
1. Check RC522 wiring (especially 3.3V!)
2. Check SPI pin connections
3. Reset Arduino (button or power cycle)
4. Monitor serial output for `SYSTEM:READY`

### Scenario: Python Service Crash

**Behavior:**
- HTTP API becomes unavailable
- Discord bot/admin panel cannot verify presence
- All checks return `allowed: false` (FAIL CLOSED)

**Recovery:**
```bash
sudo systemctl status darklock-hardware
sudo systemctl restart darklock-hardware
journalctl -u darklock-hardware -n 50
```

### Scenario: Card Removed During Operation

**Behavior:**
- Presence expires after timeout (default 5s)
- Active admin sessions invalidated
- New operations blocked until card re-scanned

**Recovery:**
- Re-scan authorized card
- Retry operation

### Scenario: Unauthorized Card Scanned

**Behavior:**
- Arduino emits: `PRESENCE_GRANTED:<UID>`
- Python checks UID against authorized list
- State → `UNAUTHORIZED`
- Operations still DENIED

**Logs:**
```
[RFID] ⚠️ Unauthorized RFID card detected: a3f7c9e1...
```

---

## Troubleshooting

### Problem: Arduino Not Detected

**Symptoms:** Service fails to start, "Serial port not found"

**Solutions:**
```bash
# Check if Arduino connected
ls /dev/ttyACM*   # Should show /dev/ttyACM0

# Check permissions
groups $USER      # Should include 'dialout'

# Add user to dialout group
sudo usermod -a -G dialout $USER
# Logout and login again

# Check USB connection
dmesg | tail      # Should show Arduino Mega connected
```

### Problem: RFID Reader Not Working

**Symptoms:** No card reads, Arduino shows "RFID_INIT_FAILED"

**Check Wiring:**
```
1. Verify 3.3V (NOT 5V!)
2. Check GND connection
3. Verify SPI pins: 53, 52, 51, 50, 49
4. Ensure tight connections (no loose wires)
```

**Test Reader:**
```bash
# Open Arduino Serial Monitor
# Baud: 115200
# Type: STATUS
# Expected: STATUS:READY:ABSENT:<uptime>
```

### Problem: Card Scans But Access Denied

**Symptoms:** Card detected but operations still blocked

**Check Authorization:**
```bash
# View current config
cat /etc/darklock/hardware.env

# Check service logs for UID
journalctl -u darklock-hardware -f

# Scan card and note UID in logs
# Add UID to RFID_AUTHORIZED_UIDS

# Restart service
sudo systemctl restart darklock-hardware
```

### Problem: Service Keeps Restarting

**Symptoms:** systemctl status shows repeated restarts

**Debug:**
```bash
# View detailed logs
journalctl -u darklock-hardware -n 100 --no-pager

# Common issues:
# - Wrong serial port
# - Permission denied (dialout group)
# - Python module missing

# Test manually
cd hardware
python3 hardware_api_service.py
# Check error messages
```

### Problem: Bot Commands Not Working

**Symptoms:** `/botctl` command fails or shows "service unavailable"

**Check:**
```bash
# Verify hardware service running
sudo systemctl status darklock-hardware

# Check if API responding
curl http://localhost:5555/health

# Check bot can reach service
# In bot environment:
curl http://localhost:5555/hardware/status

# Check bot environment variables
cat .env | grep HARDWARE
```

---

## API Reference

### Python Service API

Base URL: `http://localhost:5555`

#### `GET /hardware/status`

Get current hardware gate status.

**Response:**
```json
{
    "enabled": true,
    "available": true,
    "present": true,
    "state": "present",
    "last_seen": "2026-02-07T14:23:45.123456",
    "uid_hash": "a3f7c9e1b5d2f8a4",
    "serial_port": "/dev/ttyACM0",
    "serial_connected": true,
    "authorized_count": 2
}
```

#### `POST /hardware/check-presence`

Check if presence is verified for an operation.

**Request:**
```json
{
    "operation": "bot_shutdown"
}
```

**Response:**
```json
{
    "allowed": true,
    "message": "Physical presence verified",
    "uid_hash": "a3f7c9e1b5d2f8a4",
    "state": "present"
}
```

#### `POST /hardware/admin-unlock`

Verify RFID for admin panel unlock.

**Request:**
```json
{
    "username": "admin",
    "verified_2fa": true
}
```

**Response (Success):**
```json
{
    "success": true,
    "rfid_verified": true,
    "message": "Physical presence verified",
    "uid_hash": "a3f7c9e1b5d2f8a4"
}
```

**Response (Denied):**
```json
{
    "success": false,
    "rfid_verified": false,
    "message": "Physical presence required. Please scan authorized RFID card.",
    "instructions": [
        "Locate authorized RFID card",
        "Hold card near RFID reader",
        "Wait for confirmation",
        "Retry unlock"
    ]
}
```

#### `GET /hardware/events?limit=50`

Get recent presence events for audit.

**Response:**
```json
{
    "events": [
        {
            "timestamp": "2026-02-07T14:23:45.123456",
            "state": "present",
            "uid_hash": "a3f7c9e1b5d2f8a4",
            "reason": "AUTHORIZED_CARD"
        },
        {
            "timestamp": "2026-02-07T14:20:12.987654",
            "state": "absent",
            "uid_hash": null,
            "reason": "CARD_TIMEOUT"
        }
    ]
}
```

---

## Maintenance

### Regular Tasks

**Weekly:**
- Check service logs: `journalctl -u darklock-hardware -n 100`
- Verify card reads working
- Test emergency shutdown procedure

**Monthly:**
- Review audit logs for unauthorized attempts
- Verify all authorized cards still work
- Check Arduino/reader physical connections
- Update firmware if improvements available

**When Adding New Admin:**
1. Provision new RFID card
2. Scan card to get UID
3. Add UID to `/etc/darklock/hardware.env`
4. Restart service
5. Test new card works
6. Document card issuance in security log

### Backup & Recovery

**Backup Configuration:**
```bash
# Backup authorized UIDs
sudo cp /etc/darklock/hardware.env /etc/darklock/hardware.env.backup

# Backup with timestamp
sudo cp /etc/darklock/hardware.env /etc/darklock/hardware.env.$(date +%Y%m%d)
```

**Disaster Recovery:**
```bash
# If Arduino lost:
# 1. Get new Arduino Mega
# 2. Upload firmware from hardware/darklock_rfid_presence.ino
# 3. Connect and verify: journalctl -u darklock-hardware -f

# If RFID reader lost:
# 1. Get new RC522 reader
# 2. Wire according to diagram (3.3V!)
# 3. Reset Arduino
# 4. Verify reads working

# If all cards lost:
# 1. Get new cards
# 2. Temporarily disable gate: HARDWARE_GATE_ENABLED=false
# 3. Restart services
# 4. Scan new cards to get UIDs
# 5. Re-enable gate with new UIDs
```

---

## License & Support

This system is part of the Darklock project.

For issues or questions:
1. Check logs: `journalctl -u darklock-hardware -f`
2. Review this documentation
3. Check GitHub issues
4. Contact: [Your support channel]

---

## Appendix: Quick Reference

### Common Commands

```bash
# Service management
sudo systemctl start darklock-hardware
sudo systemctl stop darklock-hardware
sudo systemctl restart darklock-hardware
sudo systemctl status darklock-hardware

# Logs
journalctl -u darklock-hardware -f          # Follow logs
journalctl -u darklock-hardware -n 50       # Last 50 lines
journalctl -u darklock-hardware --since today  # Today's logs

# Configuration
sudo nano /etc/darklock/hardware.env        # Edit config
sudo systemctl restart darklock-hardware    # Apply changes

# Testing
python3 hardware/rfid_presence_service.py --port /dev/ttyACM0
curl http://localhost:5555/health
curl http://localhost:5555/hardware/status

# Arduino
ls /dev/ttyACM*                             # Find Arduino port
sudo usermod -a -G dialout $USER            # Add serial permissions
```

### Pin Reference

```
Arduino Mega 2560 SPI Pins:
  SS   (Slave Select) = Pin 53
  SCK  (Clock)        = Pin 52
  MOSI (Master Out)   = Pin 51
  MISO (Master In)    = Pin 50
  RST  (Reset)        = Pin 49
```

### Status Codes

```
State Values:
  absent        - No card present
  present       - Authorized card detected
  unauthorized  - Unknown card detected
  error         - Hardware error

Presence Reasons:
  AUTHORIZED_CARD    - Card authorized
  UNAUTHORIZED_CARD  - Card not in list
  CARD_TIMEOUT       - Card removed or timeout
  SERIAL_DISCONNECT  - Arduino unplugged
  RFID_INIT_FAILED   - Reader hardware error
  SERVICE_STARTED    - Service booted
```

---

**Document Version:** 1.0  
**Last Updated:** February 7, 2026  
**Author:** Darklock Security Team
