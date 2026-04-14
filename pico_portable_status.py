"""
DarkLock -- Pico LED Firmware v2 (MicroPython)
=============================================
Flash as main.py onto the Pico.

Three independent LED sets driven over USB serial:

  SET1:{CMD}  -> Set 1 -- Bot status     GP8=G  GP9=B  GP10=Y  GP11=R
  SET2:{CMD}  -> Set 2 -- Guard status   GP16=R GP17=Y GP18=B  GP19=G
  SET3:{CMD}  -> Set 3 -- Notes status   GP12=G GP13=B GP14=Y  GP15=R

{CMD} options:
  OK        -> green solid
  CHECKING  -> blue slow pulse  (starting / bridge connecting)
  DEGRADED  -> yellow slow blink (high latency / degraded)
  FAIL      -> red fast blink   (service down / critical)
  SHUTDOWN  -> all LEDs off for that set

Global commands:
  PING      -> responds PONG, resets watchdog

Watchdog: if no command or PING arrives within TIMEOUT_MS, all sets -> FAIL.
"""

import sys
import select
import utime
from machine import Pin

# --- Pin Setup ----------------------------------------------------------------
# Set 1 -- Bot status     (green, blue, yellow, red)
_s1 = (Pin(8, Pin.OUT), Pin(9, Pin.OUT), Pin(10, Pin.OUT), Pin(11, Pin.OUT))

# Set 2 -- Guard status   (green, blue, yellow, red)
_s2 = (Pin(19, Pin.OUT), Pin(18, Pin.OUT), Pin(17, Pin.OUT), Pin(16, Pin.OUT))

# Set 3 -- Notes status   (green, blue, yellow, red)
_s3 = (Pin(12, Pin.OUT), Pin(13, Pin.OUT), Pin(14, Pin.OUT), Pin(15, Pin.OUT))

# Each entry: (green, blue, yellow, red)
SETS = [_s1, _s2, _s3]

# --- Config -------------------------------------------------------------------
BLINK_TICK_MS = 250
TIMEOUT_MS    = 30000   # watchdog: bridge pings every ~5 s, 30 s = 6x margin

VALID_CMDS = {"OK", "CHECKING", "DEGRADED", "FAIL", "SHUTDOWN"}

# --- LED Helpers --------------------------------------------------------------
def _off(pins):
    for p in pins:
        p.off()

def all_off():
    for pins in SETS:
        _off(pins)

def startup_sequence():
    """Cycle every LED once so wiring can be verified on boot."""
    for pins in SETS:
        for p in pins:
            p.on()
            utime.sleep_ms(80)
            p.off()
    utime.sleep_ms(80)
    for pins in SETS:
        for p in pins:
            p.on()
    utime.sleep_ms(300)
    all_off()

def update_set(pins, state, tick):
    """Drive one LED set (non-blocking). pins = (green, blue, yellow, red)."""
    g, b, y, r = pins
    _off(pins)
    if state == "OK":
        g.on()
    elif state == "CHECKING":
        # Blue slow pulse -- 50% duty, 500 ms period (2 ticks)
        if tick % 2 == 0:
            b.on()
    elif state == "DEGRADED":
        # Yellow -- on 2 ticks, off 1 tick (~500 ms on, ~250 ms off)
        if tick % 3 != 0:
            y.on()
    elif state == "FAIL":
        # Red fast blink -- alternates every tick (250 ms)
        if tick % 2 == 0:
            r.on()
    # SHUTDOWN: all off (already done above)

# --- Main Loop ----------------------------------------------------------------
def main():
    sys.stdout.write("READY\n")
    startup_sequence()

    states        = ["CHECKING", "CHECKING", "CHECKING"]
    last_cmd_time = utime.ticks_ms()
    buf           = ""
    tick          = 0

    while True:
        # Drain all available serial bytes before sleeping -- read in a tight
        # inner loop so a full command (e.g. "SET1:FAIL\n" = 10 bytes) is
        # consumed in one pass rather than one byte per 250 ms tick.
        while True:
            r, _, _ = select.select([sys.stdin], [], [], 0)
            if not r:
                break
            ch = sys.stdin.read(1)
            if ch in ('\n', '\r'):
                line = buf.strip().upper()
                buf  = ""
                if line == "PING":
                    sys.stdout.write("PONG\n")
                    last_cmd_time = utime.ticks_ms()
                elif line.startswith("SET") and ":" in line:
                    try:
                        prefix, cmd = line.split(":", 1)
                        idx = int(prefix[3:]) - 1   # "SET1"->0, "SET2"->1, "SET3"->2
                        if 0 <= idx <= 2 and cmd in VALID_CMDS:
                            states[idx] = cmd
                            last_cmd_time = utime.ticks_ms()
                            sys.stdout.write("ACK:SET" + str(idx + 1) + ":" + cmd + "\n")
                    except (ValueError, IndexError):
                        pass  # malformed line -- ignore
            else:
                buf += ch

        # Watchdog
        if utime.ticks_diff(utime.ticks_ms(), last_cmd_time) > TIMEOUT_MS:
            for i in range(3):
                if states[i] not in ("FAIL", "SHUTDOWN"):
                    states[i] = "FAIL"

        # Drive all 3 LED sets
        tick += 1
        for i, pins in enumerate(SETS):
            update_set(pins, states[i], tick)

        utime.sleep_ms(BLINK_TICK_MS)


main()
