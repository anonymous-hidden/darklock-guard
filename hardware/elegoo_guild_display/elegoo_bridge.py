#!/usr/bin/env python3 -u
"""
Elegoo Bridge for Raspberry Pi 5
Reads Discord bot status and sends to Elegoo Mega via USB serial.
Controls LCD, RGB LEDs, tamper LED, RFID LEDs, and MAX7219 dot matrix.

NOTE: Guild count display (7-segment) is handled by the Pico bridge,
      not this script. This script controls the Elegoo Mega only.

Elegoo Pin Map:
  RGB-LED 1: R=D29  G=D31  B=D33
  RGB-LED 2: R=D23  G=D25  B=D27
  Tamper LED: R=D32
  RFID LEDs: G=D28  R=D30
  LCD 16x2: RS=P7  EN=P8  D4=P9  D5=P10  D6=P11  D7=P12
  MAX7219: DIN=D22  CS=D24  CLK=D26
"""

import serial
import time
import json
import os
import sys
import subprocess
import requests
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

ELEGOO_SERIAL_PORT = os.environ.get("ELEGOO_PORT", "/dev/ttyACM0")
BAUD_RATE = 115200
UPDATE_INTERVAL = 3
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3001")
API_KEY = os.environ.get("INTERNAL_API_KEY", "")

BASE_DIR = Path(__file__).parent.parent.parent
DATA_DIR = BASE_DIR / "data"
STATUS_FILE = DATA_DIR / "bot_status.json"

print("[Elegoo Bridge] Starting...")
print(f"[Elegoo Bridge] Base: {BASE_DIR}")


def get_guild_count():
    """Get guild count from status file, API, or logs."""
    # File
    try:
        if STATUS_FILE.exists():
            with open(STATUS_FILE, 'r') as f:
                data = json.load(f)
                c = data.get('guild_count')
                if c is not None:
                    return c
    except Exception:
        pass
    # API
    try:
        r = requests.get(f"{DASHBOARD_URL}/platform/api/metrics", timeout=2)
        if r.status_code == 200:
            d = r.json()
            if 'bot' in d and 'guilds' in d['bot']:
                return d['bot']['guilds']
    except Exception:
        pass
    # Logs
    try:
        import re
        r = subprocess.run(
            ["journalctl", "-u", "discord-bot", "-n", "50", "--no-pager"],
            capture_output=True, text=True, timeout=2
        )
        for line in reversed(r.stdout.split('\n')):
            m = re.search(r'Serving (\d+) guild', line)
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return 0


def is_bot_running():
    try:
        r = subprocess.run(["systemctl", "is-active", "discord-bot"],
                           capture_output=True, text=True, timeout=2)
        return r.stdout.strip() == "active"
    except Exception:
        return False


def send(ser, cmd):
    try:
        ser.write(f"{cmd}\n".encode())
        ser.flush()
        print(f"[→Elegoo] {cmd}")
        return True
    except Exception as e:
        print(f"[Elegoo Bridge] Send error: {e}")
        return False


def read_responses(ser):
    try:
        while ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(f"[Elegoo] {line}")
    except Exception:
        pass


def wait_for_device(port, max_wait=60):
    print(f"[Elegoo Bridge] Waiting for Elegoo on {port}...")
    start = time.time()
    while time.time() - start < max_wait:
        if os.path.exists(port):
            time.sleep(1)
            return True
        time.sleep(2)
    return False


def main():
    if not os.path.exists(ELEGOO_SERIAL_PORT):
        if not wait_for_device(ELEGOO_SERIAL_PORT):
            print("[Elegoo Bridge] Timeout waiting for Elegoo")
            sys.exit(1)

    try:
        ser = serial.Serial(ELEGOO_SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(3)
        print(f"[Elegoo Bridge] Connected to {ELEGOO_SERIAL_PORT}")

        send(ser, "PING")
        time.sleep(0.5)
        read_responses(ser)

        last_bot = None
        last_count = None
        errors = 0

        print("[Elegoo Bridge] Starting monitor loop...")

        while True:
            try:
                # Bot status
                bot = is_bot_running()
                if bot != last_bot:
                    if bot:
                        send(ser, "LED1:0,255,0")
                        send(ser, "MATRIX_LOCK")
                    else:
                        send(ser, "LED1:255,0,0")
                        send(ser, "MATRIX_ALERT")
                    last_bot = bot

                # Guild count on LCD
                count = get_guild_count()
                if count != last_count:
                    if bot:
                        send(ser, f"LCD:DARKLOCK v2.0|{count} Servers")
                    last_count = count
                    errors = 0

                read_responses(ser)

                if errors > 10:
                    print("[Elegoo Bridge] Too many errors, reconnecting...")
                    ser.close()
                    time.sleep(2)
                    ser = serial.Serial(ELEGOO_SERIAL_PORT, BAUD_RATE, timeout=1)
                    time.sleep(2)
                    errors = 0
                    last_bot = None
                    last_count = None

                time.sleep(UPDATE_INTERVAL)

            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"[Elegoo Bridge] Error: {e}")
                errors += 1
                time.sleep(UPDATE_INTERVAL)

    except serial.SerialException as e:
        print(f"[Elegoo Bridge] Serial error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[Elegoo Bridge] Shutting down...")
        if 'ser' in locals() and ser.is_open:
            send(ser, "LED1:0,0,0")
            send(ser, "RFID:OFF")
            ser.close()
    except Exception as e:
        print(f"[Elegoo Bridge] Fatal: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
