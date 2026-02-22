#!/usr/bin/env python3 -u
"""
Arduino Bridge — Communicates with Elegoo Mega 2560 over USB serial.
Monitors bot status and sends updates to LCD, RGB LEDs, tamper LED,
RFID LEDs, and MAX7219 dot matrix.

Pin map (on Elegoo Mega):
  RGB-LED 1 (Bot Status):  R=D29  G=D31  B=D33
  RGB-LED 2 (Secondary):   R=D23  G=D25  B=D27
  Tamper LED:               R=D32
  RFID LEDs:                G=D28  R=D30
  LCD 16×2:  RS=P7  EN=P8  D4=P9  D5=P10  D6=P11  D7=P12
  MAX7219:   DIN=D22  CS=D24  CLK=D26

Serial protocol: 115200 baud, newline-delimited commands.
"""

import serial
import time
import subprocess
import sys
import os
import json
import traceback
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

SERIAL_PORT = os.environ.get("ELEGOO_PORT", "/dev/elegoo")
BAUD_RATE = 115200
HEARTBEAT_INTERVAL = 5  # seconds
STATUS_INTERVAL = 2     # seconds between status checks

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
STATUS_FILE = DATA_DIR / "bot_status.json"
DB_PATH = DATA_DIR / "darklock.db"


def is_bot_running():
    """Check if discord-bot service is running."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "discord-bot"],
            capture_output=True, text=True
        )
        return result.stdout.strip() == "active"
    except Exception:
        return False


def is_tamper_detected():
    """Check if tamper protection has detected a violation."""
    try:
        result = subprocess.run(
            ["journalctl", "-u", "discord-bot", "-n", "20", "--no-pager"],
            capture_output=True, text=True, timeout=3
        )
        for line in reversed(result.stdout.split('\n')):
            if "TAMPER" in line.upper() and "VIOLATION" in line.upper():
                return True
    except Exception:
        pass
    return False


def get_guild_count():
    """Read guild count from status file."""
    try:
        if STATUS_FILE.exists():
            with open(STATUS_FILE, 'r') as f:
                data = json.load(f)
                return data.get('guild_count', 0)
    except Exception:
        pass
    return None


def send_command(ser, cmd):
    """Send command to Elegoo."""
    try:
        ser.write(f"{cmd}\n".encode())
        ser.flush()
        print(f"[Bridge] → {cmd}")
    except Exception as e:
        print(f"[Bridge] Send error: {e}")


def read_responses(ser):
    """Read responses from Elegoo (non-blocking)."""
    try:
        while ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(f"[Elegoo] {line}")
    except Exception:
        pass


def wait_for_device(port, max_wait=60):
    """Wait for serial device to appear."""
    print(f"[Bridge] Waiting for Elegoo on {port}...")
    start = time.time()
    while time.time() - start < max_wait:
        if os.path.exists(port):
            time.sleep(1)
            return True
        time.sleep(2)
        print(f"[Bridge] Waiting... ({int(time.time() - start)}s)")
    return False


def main():
    print("[Bridge] ═══════════════════════════════════════")
    print("[Bridge]  DarkLock Arduino Bridge")
    print("[Bridge]  Elegoo Mega 2560 Controller")
    print("[Bridge] ═══════════════════════════════════════")

    if not os.path.exists(SERIAL_PORT):
        print(f"[Bridge] Elegoo not found at {SERIAL_PORT}")
        if not wait_for_device(SERIAL_PORT):
            print("[Bridge] Timeout — is the Elegoo connected via USB?")
            sys.exit(1)

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(3)  # Wait for Arduino reset
        print(f"[Bridge] Connected to {SERIAL_PORT}")

        # Initial ping
        send_command(ser, "PING")
        time.sleep(0.5)
        read_responses(ser)

        last_bot_state = None
        last_tamper = False
        last_guild_count = None

        print("[Bridge] Starting status monitor loop...")

        while True:
            try:
                # — Bot status → LED1 + LCD —
                bot_running = is_bot_running()
                if bot_running != last_bot_state:
                    if bot_running:
                        send_command(ser, "LED1:0,255,0")   # Green = online
                        send_command(ser, "LCD:DARKLOCK v2.0|Bot Online")
                        send_command(ser, "MATRIX_LOCK")
                    else:
                        send_command(ser, "LED1:255,0,0")   # Red = offline
                        send_command(ser, "LCD:DARKLOCK v2.0|Bot OFFLINE")
                        send_command(ser, "MATRIX_ALERT")
                    last_bot_state = bot_running

                # — Tamper detection → Tamper LED —
                tamper = is_tamper_detected()
                if tamper != last_tamper:
                    send_command(ser, f"TAMPER:{1 if tamper else 0}")
                    if tamper:
                        send_command(ser, "LED2:255,0,0")  # Red on LED2
                    else:
                        send_command(ser, "LED2:0,0,0")
                    last_tamper = tamper

                # — Guild count on LCD line 2 —
                guild_count = get_guild_count()
                if guild_count is not None and guild_count != last_guild_count:
                    if bot_running:
                        send_command(ser, f"LCD:DARKLOCK v2.0|{guild_count} Servers")
                    last_guild_count = guild_count

                # Read any responses
                read_responses(ser)

                # Heartbeat
                send_command(ser, "PING")

                time.sleep(STATUS_INTERVAL)

            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"[Bridge] Loop error: {e}")
                time.sleep(STATUS_INTERVAL)

    except serial.SerialException as e:
        print(f"[Bridge] Serial error: {e}")
        print("[Bridge] Ensure Elegoo is connected and sketch is uploaded")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[Bridge] Shutting down...")
        if 'ser' in locals() and ser.is_open:
            send_command(ser, "LCD:DARKLOCK v2.0|Shutting down..")
            send_command(ser, "LED1:0,0,0")
            send_command(ser, "LED2:0,0,0")
            send_command(ser, "TAMPER:0")
            send_command(ser, "RFID:OFF")
            ser.close()
    except Exception as e:
        print(f"[Bridge] Fatal: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
