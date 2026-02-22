#!/usr/bin/env python3 -u
"""
Pico Guild Display Bridge for Raspberry Pi 5
Reads Discord bot guild count and sends to Pico over serial

Communicates with Raspberry Pi Pico running guild display firmware
"""

import serial
import time
import json
import os
import sys
import subprocess
import requests
from pathlib import Path

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Configuration
PICO_SERIAL_PORT = os.environ.get("PICO_PORT", "/dev/pico")
BAUD_RATE = 115200
UPDATE_INTERVAL = 5  # seconds between updates
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3001")
API_KEY = os.environ.get("INTERNAL_API_KEY", "")

# Try to find the bot's base directory
BASE_DIR = Path(__file__).parent.parent.parent
DATA_DIR = BASE_DIR / "data"
STATUS_FILE = DATA_DIR / "bot_status.json"

print("[Guild Display Bridge] Starting...")
print(f"[Guild Display Bridge] Base directory: {BASE_DIR}")
print(f"[Guild Display Bridge] Status file: {STATUS_FILE}")


def get_guild_count_from_file():
    """Try to read guild count from status file"""
    try:
        if STATUS_FILE.exists():
            with open(STATUS_FILE, 'r') as f:
                data = json.load(f)
                return data.get('guild_count', 0)
    except Exception as e:
        pass
    return None


def get_guild_count_from_api():
    """Try to get guild count from dashboard API"""
    try:
        # Try platform metrics endpoint
        response = requests.get(
            f"{DASHBOARD_URL}/platform/api/metrics",
            timeout=2
        )
        if response.status_code == 200:
            data = response.json()
            if 'bot' in data and 'guilds' in data['bot']:
                return data['bot']['guilds']
    except Exception as e:
        pass
    
    try:
        # Try admin API if we have a key
        if API_KEY:
            response = requests.get(
                f"{DASHBOARD_URL}/admin/api/bot/status",
                headers={"x-api-key": API_KEY},
                timeout=2
            )
            if response.status_code == 200:
                data = response.json()
                return data.get('guilds', 0)
    except Exception as e:
        pass
    
    return None


def get_guild_count_from_systemd():
    """Try to parse guild count from bot service logs"""
    try:
        result = subprocess.run(
            ["journalctl", "-u", "discord-bot", "-n", "50", "--no-pager"],
            capture_output=True,
            text=True,
            timeout=2
        )
        
        if result.returncode == 0:
            # Look for log lines like "Serving X guilds" or "Monitoring X servers"
            for line in reversed(result.stdout.split('\n')):
                if "Serving" in line and "guild" in line:
                    # Extract number from line like "Serving 5 guilds"
                    import re
                    match = re.search(r'Serving (\d+) guild', line)
                    if match:
                        return int(match.group(1))
                if "Monitoring" in line and "server" in line:
                    import re
                    match = re.search(r'Monitoring (\d+) server', line)
                    if match:
                        return int(match.group(1))
    except Exception as e:
        pass
    
    return None


def get_guild_count():
    """Get guild count from various sources (in order of preference)"""
    
    # Try file first (fastest)
    count = get_guild_count_from_file()
    if count is not None:
        return count
    
    # Try API
    count = get_guild_count_from_api()
    if count is not None:
        return count
    
    # Try systemd logs (last resort)
    count = get_guild_count_from_systemd()
    if count is not None:
        return count
    
    return 0


def send_to_pico(ser, count):
    """Send guild count to Pico"""
    try:
        command = f"COUNT:{count}\n"
        ser.write(command.encode())
        ser.flush()
        return True
    except Exception as e:
        print(f"[Guild Display Bridge] Error sending to Pico: {e}")
        return False


def read_pico_response(ser):
    """Read any responses from Pico (non-blocking)"""
    try:
        while ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(f"[Pico] {line}")
    except Exception as e:
        pass


def wait_for_pico(port_path, max_wait=30):
    """Wait for Pico to appear on serial port"""
    print(f"[Guild Display Bridge] Waiting for Pico on {port_path}...")
    
    start_time = time.time()
    while time.time() - start_time < max_wait:
        if os.path.exists(port_path):
            # Give it a moment to settle
            time.sleep(1)
            return True
        time.sleep(1)
        print(f"[Guild Display Bridge] Still waiting... ({int(time.time() - start_time)}s)")
    
    return False


def main():
    """Main loop"""
    
    # Wait for Pico to be available
    if not os.path.exists(PICO_SERIAL_PORT):
        print(f"[Guild Display Bridge] Pico not found at {PICO_SERIAL_PORT}")
        if not wait_for_pico(PICO_SERIAL_PORT):
            print(f"[Guild Display Bridge] Timeout waiting for Pico")
            sys.exit(1)
    
    try:
        # Connect to Pico
        print(f"[Guild Display Bridge] Connecting to Pico at {PICO_SERIAL_PORT}...")
        ser = serial.Serial(PICO_SERIAL_PORT, BAUD_RATE, timeout=1)
        
        # Wait for Pico to boot and initialize
        time.sleep(3)
        print(f"[Guild Display Bridge] Connected!")
        
        # Send initial ping
        ser.write(b"PING\n")
        ser.flush()
        time.sleep(0.5)
        read_pico_response(ser)
        
        last_count = None
        consecutive_errors = 0
        
        print("[Guild Display Bridge] Starting monitor loop...")
        
        while True:
            try:
                # Get current guild count
                guild_count = get_guild_count()
                
                # Only send if changed or it's been a while
                if guild_count != last_count:
                    print(f"[Guild Display Bridge] Guild count: {guild_count}")
                    
                    if send_to_pico(ser, guild_count):
                        last_count = guild_count
                        consecutive_errors = 0
                    else:
                        consecutive_errors += 1
                
                # Read any responses from Pico
                read_pico_response(ser)
                
                # Check for too many errors
                if consecutive_errors > 10:
                    print("[Guild Display Bridge] Too many serial errors, reconnecting...")
                    ser.close()
                    time.sleep(2)
                    ser = serial.Serial(PICO_SERIAL_PORT, BAUD_RATE, timeout=1)
                    time.sleep(2)
                    consecutive_errors = 0
                    last_count = None  # Force resend
                
                time.sleep(UPDATE_INTERVAL)
                
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"[Guild Display Bridge] Loop error: {e}")
                consecutive_errors += 1
                time.sleep(UPDATE_INTERVAL)
    
    except serial.SerialException as e:
        print(f"[Guild Display Bridge] Serial error: {e}")
        print("[Guild Display Bridge] Make sure:")
        print("  1. Pico is connected via USB")
        print(f"  2. Pico firmware is running on {PICO_SERIAL_PORT}")
        print("  3. User has permission to access serial port (add to 'dialout' group)")
        sys.exit(1)
    
    except KeyboardInterrupt:
        print("\n[Guild Display Bridge] Shutting down...")
        if 'ser' in locals() and ser.is_open:
            send_to_pico(ser, 0)  # Clear display
            ser.close()
        sys.exit(0)
    
    except Exception as e:
        print(f"[Guild Display Bridge] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
