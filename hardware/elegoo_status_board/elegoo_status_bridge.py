#!/usr/bin/env python3 -u
"""
Elegoo Status Board Bridge — Raspberry Pi 5

Monitors three services and Discord bot, sends status to Elegoo Mega 2560.

Components:
  - 4-digit 7-segment: guild count (servers the bot is in)
  - LCD 16x2: rotating status info
  - LED Group 1 (D23/25/27/29): Darklock server status
  - LED Group 2 (D22/24/26/28): Jarvis (Nova AI) status
  - LED Group 3 (D31/33/35/37): Pi5 system status

Serial Protocol (115200 baud):
  COUNT:N                        7-segment (0-9999)
  LCD:line1|line2                LCD display
  DARKLOCK:GREEN/BLUE/YELLOW/RED/OFF   LED group 1
  JARVIS:GREEN/BLUE/YELLOW/RED/OFF     LED group 2
  PI5:GREEN/BLUE/YELLOW/RED/OFF        LED group 3
  PING                           Heartbeat

LED Colors:
  GREEN  = online / healthy
  BLUE   = starting / connecting
  YELLOW = warning / degraded
  RED    = offline / error
"""

import json
import os
import signal
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

try:
    import serial
    SERIAL_AVAILABLE = True
except ImportError:
    print("[StatusBoard] pyserial not installed — pip3 install pyserial")
    SERIAL_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# ─── Configuration ───────────────────────────────────────────────
ELEGOO_PORT = os.environ.get("ELEGOO_PORT", "/dev/elegoo")
BAUD_RATE = 115200
UPDATE_INTERVAL = 3          # seconds between status checks
HEARTBEAT_INTERVAL = 10      # seconds between PINGs
LCD_ROTATE_INTERVAL = 5      # seconds between LCD info rotation

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
STATUS_FILE = DATA_DIR / "bot_status.json"

DARKLOCK_PORT = 3001         # Darklock platform
JARVIS_PORT = 8950           # Jarvis / Nova AI
GUARD_PORT = 3002            # Guard service


class StatusBoardBridge:
    """Bridges Pi5 service statuses to Elegoo Mega 2560 via USB serial."""

    def __init__(self):
        self.running = True
        self.ser = None

        # Last known states (to send only on change)
        self.last_darklock = None
        self.last_jarvis = None
        self.last_pi5 = None
        self.last_guild_count = None
        self.last_lcd = None

        # LCD rotation
        self.lcd_index = 0
        self.last_lcd_rotate = 0

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def start(self):
        print("[StatusBoard] ═══════════════════════════════════════")
        print("[StatusBoard]  Elegoo Status Board Bridge")
        print("[StatusBoard]  7-Seg + LCD + 12 Status LEDs")
        print("[StatusBoard] ═══════════════════════════════════════")
        print(f"[StatusBoard] Status file: {STATUS_FILE}")
        print(f"[StatusBoard] Elegoo port: {ELEGOO_PORT}")

        if not SERIAL_AVAILABLE:
            print("[StatusBoard] ERROR: pyserial required")
            sys.exit(1)

        if not self._wait_for_device(ELEGOO_PORT):
            print(f"[StatusBoard] Elegoo not found at {ELEGOO_PORT}")
            print("[StatusBoard] Running in print-only mode")
            self._run_print_only()
            return

        try:
            self.ser = serial.Serial(ELEGOO_PORT, BAUD_RATE, timeout=1)
            time.sleep(3)  # Wait for Arduino reset after serial connect
            print(f"[StatusBoard] Connected to Elegoo at {ELEGOO_PORT}")

            self._send("PING")
            time.sleep(0.5)
            self._read_responses()

            self._run_main_loop()

        except serial.SerialException as e:
            print(f"[StatusBoard] Serial error: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"[StatusBoard] Fatal: {e}")
            traceback.print_exc()
            sys.exit(1)
        finally:
            self._cleanup()

    # ─── Main Loop ───────────────────────────────────────────────
    def _run_main_loop(self):
        print("[StatusBoard] Starting monitor loop...")
        last_heartbeat = time.time()

        while self.running:
            try:
                now = time.time()

                # ── Check all service statuses ──
                darklock_status = self._check_darklock()
                jarvis_status = self._check_jarvis()
                pi5_status = self._check_pi5()
                guild_count = self._get_guild_count()

                # ── Update LEDs on change ──
                if darklock_status != self.last_darklock:
                    self._send(f"DARKLOCK:{darklock_status}")
                    self.last_darklock = darklock_status

                if jarvis_status != self.last_jarvis:
                    self._send(f"JARVIS:{jarvis_status}")
                    self.last_jarvis = jarvis_status

                if pi5_status != self.last_pi5:
                    self._send(f"PI5:{pi5_status}")
                    self.last_pi5 = pi5_status

                # ── Update 7-segment on change ──
                if guild_count is not None and guild_count != self.last_guild_count:
                    self._send(f"COUNT:{guild_count}")
                    self.last_guild_count = guild_count

                # ── Rotate LCD info ──
                if now - self.last_lcd_rotate >= LCD_ROTATE_INTERVAL:
                    self._update_lcd(darklock_status, jarvis_status, pi5_status, guild_count)
                    self.last_lcd_rotate = now

                # ── Heartbeat ──
                if now - last_heartbeat > HEARTBEAT_INTERVAL:
                    self._send("PING")
                    last_heartbeat = now

                self._read_responses()
                time.sleep(UPDATE_INTERVAL)

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[StatusBoard] Loop error: {e}")
                time.sleep(UPDATE_INTERVAL)

    def _run_print_only(self):
        """Fallback: just print statuses without serial."""
        while self.running:
            try:
                dl = self._check_darklock()
                jv = self._check_jarvis()
                pi = self._check_pi5()
                gc = self._get_guild_count()
                print(f"[Status] Darklock={dl} Jarvis={jv} Pi5={pi} Guilds={gc or '?'}")
                time.sleep(5)
            except KeyboardInterrupt:
                break

    # ─── Status Checks ──────────────────────────────────────────
    def _check_darklock(self):
        """
        Check Darklock server status.
        GREEN  = bot online + platform reachable
        BLUE   = bot starting (status file exists but stale)
        YELLOW = bot online but platform unreachable
        RED    = bot offline
        """
        bot_online = self._is_bot_online()
        platform_up = self._check_http("127.0.0.1", DARKLOCK_PORT)

        if bot_online and platform_up:
            return "GREEN"
        elif bot_online and not platform_up:
            return "YELLOW"
        elif not bot_online and platform_up:
            return "BLUE"
        else:
            return "RED"

    def _check_jarvis(self):
        """
        Check Jarvis/Nova AI status.
        GREEN  = health endpoint responds OK
        BLUE   = process running but health not responding
        YELLOW = health responds but degraded
        RED    = not running
        """
        # Try health endpoint first
        try:
            if REQUESTS_AVAILABLE:
                r = requests.get(f"http://127.0.0.1:{JARVIS_PORT}/api/health",
                                 timeout=2)
                if r.status_code == 200:
                    data = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
                    status = data.get('status', 'ok')
                    if status in ('ok', 'healthy', 'running'):
                        return "GREEN"
                    else:
                        return "YELLOW"
                elif r.status_code < 500:
                    return "YELLOW"
        except Exception:
            pass

        # Fallback: check if process is running
        try:
            result = subprocess.run(
                ['pgrep', '-f', 'jarvis.*main.py'],
                capture_output=True, text=True, timeout=3
            )
            if result.stdout.strip():
                return "BLUE"
        except Exception:
            pass

        # Also try systemd
        try:
            result = subprocess.run(
                ['systemctl', '--user', 'is-active', 'jarvis@darklock'],
                capture_output=True, text=True, timeout=3
            )
            if result.stdout.strip() == 'active':
                return "BLUE"
        except Exception:
            pass

        return "RED"

    def _check_pi5(self):
        """
        Check Pi5 system health.
        GREEN  = load OK, temp OK, disk OK
        BLUE   = just booted (uptime < 120s)
        YELLOW = high load or high temp or low disk
        RED    = critical temp or disk full
        """
        try:
            # Check uptime
            with open('/proc/uptime', 'r') as f:
                uptime_sec = float(f.read().split()[0])
            if uptime_sec < 120:
                return "BLUE"

            warnings = 0

            # CPU temperature
            try:
                with open('/sys/class/thermal/thermal_zone0/temp', 'r') as f:
                    temp_c = int(f.read().strip()) / 1000.0
                if temp_c > 80:
                    return "RED"
                elif temp_c > 70:
                    warnings += 1
            except Exception:
                pass

            # Load average (compare to CPU count)
            try:
                load1 = os.getloadavg()[0]
                cpu_count = os.cpu_count() or 4
                if load1 > cpu_count * 2:
                    return "RED"
                elif load1 > cpu_count * 1.5:
                    warnings += 1
            except Exception:
                pass

            # Disk usage
            try:
                st = os.statvfs('/')
                free_pct = (st.f_bavail / st.f_blocks) * 100
                if free_pct < 5:
                    return "RED"
                elif free_pct < 15:
                    warnings += 1
            except Exception:
                pass

            # Memory
            try:
                with open('/proc/meminfo', 'r') as f:
                    lines = f.readlines()
                mem = {}
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 2:
                        mem[parts[0].rstrip(':')] = int(parts[1])
                total = mem.get('MemTotal', 1)
                avail = mem.get('MemAvailable', total)
                used_pct = ((total - avail) / total) * 100
                if used_pct > 95:
                    return "RED"
                elif used_pct > 85:
                    warnings += 1
            except Exception:
                pass

            return "YELLOW" if warnings >= 2 else "GREEN"

        except Exception:
            return "RED"

    def _is_bot_online(self):
        """Check Discord bot status from status file or process."""
        try:
            if STATUS_FILE.exists():
                with open(STATUS_FILE, 'r') as f:
                    data = json.load(f)
                ts = data.get('timestamp', '')
                if ts:
                    age = (datetime.now(timezone.utc) -
                           datetime.fromisoformat(ts.replace('Z', '+00:00'))).total_seconds()
                    if age < 60:
                        return bool(data.get('online', False))
        except Exception:
            pass
        # Fallback: process check
        try:
            r = subprocess.run(['pgrep', '-f', 'src/bot.js'],
                               capture_output=True, text=True, timeout=3)
            return bool(r.stdout.strip())
        except Exception:
            return False

    def _get_guild_count(self):
        """Get guild count from bot status file."""
        try:
            if STATUS_FILE.exists():
                with open(STATUS_FILE, 'r') as f:
                    data = json.load(f)
                count = data.get('guild_count')
                if count is not None:
                    return min(int(count), 9999)
        except Exception:
            pass
        return None

    def _check_http(self, host, port):
        """Quick HTTP health check."""
        if REQUESTS_AVAILABLE:
            try:
                r = requests.get(f"http://{host}:{port}/", timeout=2)
                return r.status_code < 500
            except Exception:
                pass
        # Fallback: try TCP connect
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            s.connect((host, port))
            s.close()
            return True
        except Exception:
            return False

    # ─── LCD Rotation ────────────────────────────────────────────
    def _update_lcd(self, darklock, jarvis, pi5, guild_count):
        """Rotate through useful info on the LCD."""
        pages = []

        # Page 0: Service overview
        pages.append(("DARKLOCK v2.0", f"DL:{darklock[:3]} JV:{jarvis[:3]} Pi:{pi5[:3]}"))

        # Page 1: Guild count
        if guild_count is not None:
            pages.append(("Discord Bot", f"{guild_count} Servers"))

        # Page 2: Bot details from status file
        try:
            if STATUS_FILE.exists():
                with open(STATUS_FILE, 'r') as f:
                    data = json.load(f)
                users = data.get('user_count', '?')
                ping = data.get('ping', '?')
                pages.append(("Bot Stats", f"{users} Users {ping}ms"))

                # Uptime
                uptime_ms = data.get('uptime')
                if uptime_ms:
                    hours = int(uptime_ms / 3600000)
                    mins = int((uptime_ms % 3600000) / 60000)
                    pages.append(("Bot Uptime", f"{hours}h {mins}m"))
        except Exception:
            pass

        # Page 3: Pi5 system stats
        try:
            with open('/sys/class/thermal/thermal_zone0/temp', 'r') as f:
                temp = int(f.read().strip()) / 1000.0
            load = os.getloadavg()[0]
            pages.append(("Pi5 System", f"{temp:.0f}C Load:{load:.1f}"))
        except Exception:
            pass

        # Page 4: Time
        now = datetime.now()
        pages.append((now.strftime("%Y-%m-%d"), now.strftime("    %H:%M:%S")))

        if not pages:
            return

        self.lcd_index = self.lcd_index % len(pages)
        line1, line2 = pages[self.lcd_index]

        lcd_key = f"{line1}|{line2}"
        if lcd_key != self.last_lcd:
            self._send(f"LCD:{line1}|{line2}")
            self.last_lcd = lcd_key

        self.lcd_index = (self.lcd_index + 1) % len(pages)

    # ─── Serial Helpers ──────────────────────────────────────────
    def _send(self, cmd):
        if self.ser and self.ser.is_open:
            try:
                self.ser.write(f"{cmd}\n".encode())
                self.ser.flush()
                print(f"[→Elegoo] {cmd}")
            except Exception as e:
                print(f"[StatusBoard] Send error: {e}")

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
        print(f"[StatusBoard] Waiting for {port}...")
        start = time.time()
        while time.time() - start < timeout:
            if os.path.exists(port):
                time.sleep(1)
                return True
            time.sleep(2)
        return False

    # ─── Cleanup ─────────────────────────────────────────────────
    def _signal_handler(self, signum, frame):
        print(f"\n[StatusBoard] Signal {signum}, shutting down...")
        self.running = False

    def _cleanup(self):
        if self.ser and self.ser.is_open:
            try:
                self._send("LCD:DARKLOCK v2.0|Shutting down..")
                self._send("DARKLOCK:OFF")
                self._send("JARVIS:OFF")
                self._send("PI5:OFF")
                self._send("DISPLAY:OFF")
                time.sleep(0.5)
                self.ser.close()
            except Exception:
                pass
        print("[StatusBoard] Shutdown complete")


if __name__ == "__main__":
    bridge = StatusBoardBridge()
    bridge.start()
