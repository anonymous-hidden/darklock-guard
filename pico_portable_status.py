"""
DarkLock Portable — Pico LED Firmware (MicroPython)
====================================================
Flash this as main.py onto your Pico W.

Driven by pico-bridge.js running on the host over USB serial.
The bridge reads bot_status.json and sends one of these commands:

  OK        → green solid          (bot online, all good)
  CHECKING  → blue pulse           (bot starting / bridge connecting)
  DEGRADED  → yellow slow blink    (partial failure)
  FAIL      → red fast blink       (bot down / critical)
  SHUTDOWN  → all LEDs off

If no command arrives within TIMEOUT_MS the Pico falls back to
FAIL mode so a dead USB cable is immediately obvious.

LED PIN MAP
-----------
  Green  → GP20
  Blue   → GP19
  Red    → GP21
  Yellow → GP22
"""

import sys
import utime
from machine import Pin, UART

# ─── GPIO Setup ───────────────────────────────────────────────────────────────
led_green  = Pin(20, Pin.OUT)
led_blue   = Pin(19, Pin.OUT)
led_red    = Pin(21, Pin.OUT)
led_yellow = Pin(22, Pin.OUT)

# USB serial — sys.stdin works on Pico W MicroPython over USB CDC
# We use a non-blocking read via select so the blink loop keeps running.
import select

# ─── Config ───────────────────────────────────────────────────────────────────

BLINK_TICK_MS = 250    # how often the main loop ticks (ms)
TIMEOUT_MS    = 15000  # ms without a command before falling back to FAIL

# ─── LED Helpers ──────────────────────────────────────────────────────────────

def all_off():
    led_green.off()
    led_blue.off()
    led_red.off()
    led_yellow.off()

def show_green():
    all_off()
    led_green.on()

def show_blue():
    all_off()
    led_blue.on()

def show_yellow():
    all_off()
    led_yellow.on()

def show_red():
    all_off()
    led_red.on()

def startup_sequence():
    """Cycle all LEDs once so you can verify wiring."""
    for led in (led_blue, led_green, led_yellow, led_red):
        led.on()
        utime.sleep_ms(250)
        led.off()
    utime.sleep_ms(150)
    # Brief all-on flash
    for led in (led_blue, led_green, led_yellow, led_red):
        led.on()
    utime.sleep_ms(350)
    all_off()

# ─── LED State Display ────────────────────────────────────────────────────────

_tick = 0

def update_leds(state):
    """Non-blocking LED driver — call every BLINK_TICK_MS."""
    global _tick
    _tick += 1

    if state == "OK":
        show_green()

    elif state in ("CHECKING", "NO_SIGNAL"):
        # Blue slow pulse — 50% duty, 500 ms period
        all_off()
        if _tick % 2 == 0:
            led_blue.on()

    elif state == "DEGRADED":
        # Yellow — on 2 ticks, off 1 tick  (~667 ms on, ~333 ms off)
        all_off()
        if _tick % 3 != 0:
            led_yellow.on()

    elif state == "FAIL":
        # Red fast blink — alternates every tick (250 ms)
        all_off()
        if _tick % 2 == 0:
            led_red.on()

    elif state == "SHUTDOWN":
        all_off()

# ─── Main Loop ────────────────────────────────────────────────────────────────

def main():
    print("DarkLock Portable firmware ready")
    startup_sequence()

    current_state  = "CHECKING"
    last_cmd_time  = utime.ticks_ms()
    buf            = ""

    while True:
        # ── Non-blocking USB serial read ──────────────────────────
        r, _, _ = select.select([sys.stdin], [], [], 0)
        if r:
            ch = sys.stdin.read(1)
            if ch in ('\n', '\r'):
                cmd = buf.strip().upper()
                buf = ""
                if cmd in ("OK", "CHECKING", "DEGRADED", "FAIL", "SHUTDOWN"):
                    current_state = cmd
                    last_cmd_time = utime.ticks_ms()
                    print("CMD:", cmd)
                elif cmd == "PING":
                    sys.stdout.write("PONG\n")
                    last_cmd_time = utime.ticks_ms()
            else:
                buf += ch

        # ── Watchdog: no signal → FAIL ─────────────────────────────
        if utime.ticks_diff(utime.ticks_ms(), last_cmd_time) > TIMEOUT_MS:
            if current_state not in ("FAIL", "SHUTDOWN"):
                print("No signal from bridge — FAIL")
                current_state = "NO_SIGNAL"

        # ── Drive LEDs ────────────────────────────────────────────
        update_leds(current_state)
        utime.sleep_ms(BLINK_TICK_MS)


main()
