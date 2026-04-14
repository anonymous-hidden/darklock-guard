not """
pico_led_bridge.py  --  Pi5 bridge for the DarkLock LED Pico (v2)
==================================================================
Monitors three services and drives three independent LED sets on
the Pico over USB serial.

  SET1 = Bot status       (data/bot_status.json)
  SET2 = Guard status     (http://localhost:3002/health)
  SET3 = Notes status     (http://localhost:3003/health)

Environment variables:
  PICO_LED_PORT     -- serial device  (default: /dev/pico-led)
  STATUS_INTERVAL   -- poll interval in seconds  (default: 5)
  LED_BAUDRATE      -- serial baud rate  (default: 115200)
  STATUS_FILE       -- override path to bot_status.json
"""

import os
import sys
import json
import time
import datetime
import logging
import urllib.request
import urllib.error
import serial
from pathlib import Path

# --- Configuration ------------------------------------------------------------
PICO_PORT        = os.environ.get("PICO_LED_PORT",    "/dev/pico-led")
STATUS_INTERVAL  = int(os.environ.get("STATUS_INTERVAL", "5"))
BAUDRATE         = int(os.environ.get("LED_BAUDRATE",    "115200"))
HEARTBEAT_SECS   = 60    # re-send each set's command every 60 s even if unchanged
HTTP_TIMEOUT     = 4     # seconds per HTTP health check
BOT_STALE_SECS   = 60   # bot_status.json older than this -> FAIL

GUARD_URL = "http://localhost:3002/health"
NOTES_URL = "http://localhost:3003/health"

_HERE = Path(__file__).parent
_BOT_CANDIDATES = [
    Path(os.environ["STATUS_FILE"]) if "STATUS_FILE" in os.environ else None,
    _HERE / "data" / "bot_status.json",
    _HERE / "bot_status.json",
]
BOT_STATUS_FILE = next((p for p in _BOT_CANDIDATES if p and p.exists()), _HERE / "data" / "bot_status.json")

# --- Logging ------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [pico-led-bridge] %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_HERE / "logs" / "pico_led_bridge.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("pico-led-bridge")

# --- Status derivation --------------------------------------------------------
def derive_bot_cmd() -> str:
    try:
        with open(BOT_STATUS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        log.warning("bot_status.json unreadable: %s", e)
        return "FAIL"

    # Stale check (supports both unix ts float and ISO-8601 string)
    ts_raw = data.get("timestamp", 0)
    try:
        if isinstance(ts_raw, str):
            ts = datetime.datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            age = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
        else:
            age = time.time() - float(ts_raw)
        if age > BOT_STALE_SECS:
            return "FAIL"
    except (ValueError, OverflowError, TypeError):
        pass

    if not data.get("online", data.get("bot_online", False)):
        return "FAIL"

    error_level = str(data.get("error_level", "")).lower()
    if error_level in ("fail", "error", "2"):
        return "FAIL"
    if error_level in ("warn", "1"):
        return "DEGRADED"

    if data.get("checking", False):
        return "CHECKING"

    if data.get("guild_count", 1) == 0:
        return "DEGRADED"
    if data.get("ping", data.get("ping_ms", 0)) > 500:
        return "DEGRADED"

    return "OK"


def check_http(url: str) -> str:
    """HTTP GET url; returns OK if 2xx/3xx/4xx, FAIL on 5xx or connection error."""
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as resp:
            return "OK" if resp.status < 500 else "FAIL"
    except urllib.error.HTTPError as e:
        return "OK" if e.code < 500 else "FAIL"
    except Exception as e:
        log.debug("HTTP check %s failed: %s", url, e)
        return "FAIL"

# --- Serial helpers -----------------------------------------------------------
def open_serial() -> "serial.Serial | None":
    try:
        s = serial.Serial(PICO_PORT, BAUDRATE, timeout=2)
        log.info("Opened %s", PICO_PORT)
        # Wait for READY (Pico sends it on boot)
        deadline = time.time() + 6
        while time.time() < deadline:
            line = s.readline().decode("utf-8", errors="replace").strip()
            if line == "READY":
                log.info("Pico READY")
                return s
            if line:
                log.debug("Pico boot: %s", line)
        log.warning("Pico did not send READY within 6 s -- continuing")
        return s
    except serial.SerialException as e:
        log.error("Cannot open %s: %s", PICO_PORT, e)
        return None


def send_cmd(ser: "serial.Serial", set_num: int, cmd: str) -> bool:
    """Send SET{n}:{cmd} and return True on ACK."""
    try:
        ser.write(f"SET{set_num}:{cmd}\n".encode())
        ser.flush()
        deadline = time.time() + 2
        while time.time() < deadline:
            resp = ser.readline().decode("utf-8", errors="replace").strip()
            if resp == f"ACK:SET{set_num}:{cmd}":
                return True
            if resp:
                log.debug("Pico: %s", resp)
        log.warning("No ACK for SET%d:%s", set_num, cmd)
        return False
    except serial.SerialException as e:
        log.error("Serial write error: %s", e)
        return False


def ping(ser: "serial.Serial") -> bool:
    try:
        ser.write(b"PING\n")
        ser.flush()
        deadline = time.time() + 2
        while time.time() < deadline:
            resp = ser.readline().decode("utf-8", errors="replace").strip()
            if resp == "PONG":
                return True
        return False
    except serial.SerialException:
        return False

# --- Main loop ----------------------------------------------------------------
def run():
    log.info("Starting -- port=%s interval=%ss", PICO_PORT, STATUS_INTERVAL)

    ser = None
    prev     = {1: None, 2: None, 3: None}
    sent_at  = {1: 0.0,  2: 0.0,  3: 0.0}

    # Initial connection: retry up to 10 times
    for attempt in range(10):
        ser = open_serial()
        if ser:
            break
        log.warning("Retry %d/10 in 3 s", attempt + 1)
        time.sleep(3)

    while True:
        # Reconnect if needed
        if ser is None or not ser.is_open:
            log.info("Reconnecting...")
            ser = open_serial()
            if ser is None:
                time.sleep(10)
                continue
            prev = {1: None, 2: None, 3: None}  # force re-send after reconnect

        # Ping watchdog
        if not ping(ser):
            log.warning("Ping failed -- reconnecting")
            try:
                ser.close()
            except Exception:
                pass
            ser = None
            time.sleep(5)
            continue

        # Derive current states for all three sets
        current = {
            1: derive_bot_cmd(),
            2: check_http(GUARD_URL),
            3: check_http(NOTES_URL),
        }

        now = time.time()
        dead = False

        for n in (1, 2, 3):
            cmd = current[n]
            if cmd == prev[n] and (now - sent_at[n]) < HEARTBEAT_SECS:
                continue

            if cmd != prev[n]:
                log.info("SET%d: %s -> %s", n, prev[n] or "none", cmd)
            else:
                log.debug("SET%d heartbeat: %s", n, cmd)

            if send_cmd(ser, n, cmd):
                prev[n]    = cmd
                sent_at[n] = now
            else:
                try:
                    ser.close()
                except Exception:
                    pass
                ser  = None
                dead = True
                break

        if dead:
            time.sleep(2)
            continue

        time.sleep(STATUS_INTERVAL)

# --- Entry point --------------------------------------------------------------
if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        log.info("Interrupted -- sending SHUTDOWN to all sets")
        try:
            s = serial.Serial(PICO_PORT, BAUDRATE, timeout=1)
            for n in (1, 2, 3):
                s.write(f"SET{n}:SHUTDOWN\n".encode())
                s.flush()
                time.sleep(0.1)
            s.close()
        except Exception:
            pass
