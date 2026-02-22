#!/usr/bin/env python3
"""
Hardware Controller for DarkLock (Raspberry Pi 5)

All LEDs, LCD, and dot matrix are physically connected to the Elegoo
Arduino Mega 2560 (via USB serial), NOT to Pi 5 GPIO directly.

This script bridges bot status → Elegoo serial commands.
The Pico handles the 7-segment guild count display separately.

─── ELEGOO PIN MAP ────────────────────────────────────────────────
  RGB-LED 1 (Bot Status):  R=D29  G=D31  B=D33
  RGB-LED 2 (Secondary):   R=D23  G=D25  B=D27
  Tamper Shutdown LED:      R=D32
  RFID Scanner LED:         G=D28  R=D30
  LCD 16×2:  RS=P7  EN=P8  D4=P9  D5=P10  D6=P11  D7=P12
  MAX7219:   DIN=D22  CS=D24  CLK=D26

─── PICO PIN MAP ──────────────────────────────────────────────────
  7-Segment (5461AS):
    Segments A-G,DP → GP2-GP9 (220Ω resistors)
    Digits 1-4 → GP10-GP13 (direct)
"""

import json
import os
import signal
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime

try:
    import serial
    SERIAL_AVAILABLE = True
except ImportError:
    print("[Hardware] pyserial not available — install with: pip3 install pyserial")
    SERIAL_AVAILABLE = False

# ─── Configuration ───────────────────────────────────────────────
ELEGOO_PORT = os.environ.get("ELEGOO_PORT", "/dev/elegoo")
BAUD_RATE = 115200
STATUS_CHECK_INTERVAL = 2.0
HEARTBEAT_INTERVAL = 10.0

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "darklock.db")
STATUS_FILE = os.path.join(DATA_DIR, "bot_status.json")
BOT_SERVICE = "darklock-bot.service"


class HardwareController:
    """Bridges Pi 5 bot status to Elegoo Mega via USB serial."""

    def __init__(self):
        self.running = True
        self.ser = None
        self.last_bot_state = None
        self.last_tamper = False
        self.last_guild_count = None

    def start(self):
        """Main entry point."""
        print("[Hardware] ═══════════════════════════════════════")
        print("[Hardware]  DarkLock Hardware Controller")
        print("[Hardware]  Elegoo Mega 2560 + Pico Display")
        print("[Hardware] ═══════════════════════════════════════")

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        if not SERIAL_AVAILABLE:
            print("[Hardware] ERROR: pyserial required")
            sys.exit(1)

        # Wait for Elegoo
        if not self._wait_for_device(ELEGOO_PORT):
            print(f"[Hardware] Elegoo not found at {ELEGOO_PORT}")
            print("[Hardware] Running in no-hardware mode (status only)")
            self._run_status_only()
            return

        try:
            self.ser = serial.Serial(ELEGOO_PORT, BAUD_RATE, timeout=1)
            time.sleep(3)  # Wait for Arduino reset
            print(f"[Hardware] Connected to Elegoo at {ELEGOO_PORT}")

            self._send("PING")
            time.sleep(0.5)
            self._read_responses()

            self._run_main_loop()

        except serial.SerialException as e:
            print(f"[Hardware] Serial error: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"[Hardware] Fatal: {e}")
            traceback.print_exc()
            sys.exit(1)
        finally:
            self._cleanup()

    def _run_main_loop(self):
        """Main monitoring loop."""
        print("[Hardware] Starting status monitor...")
        last_heartbeat = time.time()

        while self.running:
            try:
                now = time.time()

                # Bot status → LED1 + LCD
                bot_running = self._is_bot_running()
                if bot_running != self.last_bot_state:
                    if bot_running:
                        self._send("LED1:0,255,0")
                        self._send("LCD:DARKLOCK v2.0|Bot Online")
                        self._send("MATRIX_LOCK")
                    else:
                        self._send("LED1:255,0,0")
                        self._send("LCD:DARKLOCK v2.0|Bot OFFLINE")
                        self._send("MATRIX_ALERT")
                    self.last_bot_state = bot_running

                # Tamper detection → Tamper LED + LED2
                tamper = self._check_tamper()
                if tamper != self.last_tamper:
                    self._send(f"TAMPER:{1 if tamper else 0}")
                    if tamper:
                        self._send("LED2:255,0,0")
                    else:
                        self._send("LED2:0,255,0" if bot_running else "LED2:0,0,0")
                    self.last_tamper = tamper

                # Guild count on LCD
                count = self._get_guild_count()
                if count is not None and count != self.last_guild_count:
                    if bot_running:
                        self._send(f"LCD:DARKLOCK v2.0|{count} Servers")
                    self.last_guild_count = count

                # Heartbeat
                if now - last_heartbeat > HEARTBEAT_INTERVAL:
                    self._send("PING")
                    last_heartbeat = now

                self._read_responses()
                time.sleep(STATUS_CHECK_INTERVAL)

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[Hardware] Loop error: {e}")
                time.sleep(STATUS_CHECK_INTERVAL)

    def _run_status_only(self):
        """Run without serial (just print status)."""
        print("[Hardware] No-hardware mode — printing status only")
        while self.running:
            try:
                bot = self._is_bot_running()
                tamper = self._check_tamper()
                count = self._get_guild_count()
                print(f"[Status] Bot={'ON' if bot else 'OFF'} | "
                      f"Tamper={'YES' if tamper else 'No'} | "
                      f"Guilds={count or '?'}")
                time.sleep(5)
            except KeyboardInterrupt:
                break

    # ─── Serial Helpers ──────────────────────────────────────────
    def _send(self, cmd):
        if self.ser and self.ser.is_open:
            try:
                self.ser.write(f"{cmd}\n".encode())
                self.ser.flush()
                print(f"[Hardware] → {cmd}")
            except Exception as e:
                print(f"[Hardware] Send error: {e}")

    def _read_responses(self):
        if not self.ser:
            return
        try:
            while self.ser.in_waiting:
                line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    print(f"[Elegoo] {line}")
        except Exception:
            pass

    def _wait_for_device(self, port, timeout=30):
        print(f"[Hardware] Waiting for {port}...")
        start = time.time()
        while time.time() - start < timeout:
            if os.path.exists(port):
                time.sleep(1)
                return True
            time.sleep(2)
        return False

    # ─── Status Checks ──────────────────────────────────────────
    def _is_bot_running(self):
        try:
            r = subprocess.run(["systemctl", "is-active", "discord-bot"],
                               capture_output=True, text=True, timeout=3)
            return r.stdout.strip() == "active"
        except Exception:
            return False

    def _check_tamper(self):
        try:
            r = subprocess.run(
                ["journalctl", "-u", "discord-bot", "-n", "20", "--no-pager"],
                capture_output=True, text=True, timeout=3
            )
            for line in reversed(r.stdout.split('\n')):
                if "TAMPER" in line.upper() and "VIOLATION" in line.upper():
                    return True
        except Exception:
            pass
        return False

    def _get_guild_count(self):
        try:
            if os.path.exists(STATUS_FILE):
                with open(STATUS_FILE, 'r') as f:
                    return json.load(f).get('guild_count', 0)
        except Exception:
            pass
        return None

    # ─── Cleanup ─────────────────────────────────────────────────
    def _signal_handler(self, signum, frame):
        print(f"\n[Hardware] Signal {signum} received, shutting down...")
        self.running = False

    def _cleanup(self):
        if self.ser and self.ser.is_open:
            try:
                self._send("LCD:DARKLOCK v2.0|Shutting down..")
                self._send("LED1:0,0,0")
                self._send("LED2:0,0,0")
                self._send("TAMPER:0")
                self._send("RFID:OFF")
                self.ser.close()
            except Exception:
                pass
        print("[Hardware] Shutdown complete")


if __name__ == "__main__":
    controller = HardwareController()
    controller.start()
