"""
DarkLock Guild Count Display — Raspberry Pi Pico
Displays Discord bot server count on 5461AS 4-digit 7-segment display.
Connected to Pi 5 via USB serial. Updates live when bot joins/leaves servers.

Wiring (5461AS is common-cathode):
  Segments A-G, DP → Pico GP2-GP9 through 220Ω resistors
  Digit select DIG1-4 → Pico GP10-GP13 (direct, no resistor)

Protocol: Receives "COUNT:1234\n" over USB serial @ 115200 baud
"""

import machine
import time
import sys

# ─── Pin Assignments ─────────────────────────────────────────────
# Segment pins: A=GP2, B=GP3, C=GP4, D=GP5, E=GP6, F=GP7, G=GP8, DP=GP9
SEGMENT_PINS = [2, 3, 4, 5, 6, 7, 8, 9]

# Digit select pins: DIG1=GP10, DIG2=GP11, DIG3=GP12, DIG4=GP13
DIGIT_PINS = [10, 11, 12, 13]

# 7-segment patterns (common-cathode: HIGH = ON)
# Bit order: [DP, G, F, E, D, C, B, A]
PATTERNS = [
    0b00111111,  # 0
    0b00000110,  # 1
    0b01011011,  # 2
    0b01001111,  # 3
    0b01100110,  # 4
    0b01101101,  # 5
    0b01111101,  # 6
    0b00000111,  # 7
    0b01111111,  # 8
    0b01101111,  # 9
]


class GuildDisplay:
    def __init__(self):
        self.seg_pins = [machine.Pin(p, machine.Pin.OUT) for p in SEGMENT_PINS]
        self.dig_pins = [machine.Pin(p, machine.Pin.OUT) for p in DIGIT_PINS]
        self.value = 0
        self.clear()
        print("[Pico] 7-Segment Display initialized")

    def clear(self):
        for p in self.seg_pins: p.value(0)
        for p in self.dig_pins: p.value(0)

    def set_segments(self, pattern):
        for i, p in enumerate(self.seg_pins):
            p.value((pattern >> i) & 1)

    def show_digit(self, pos):
        digits = [
            (self.value // 1000) % 10,
            (self.value // 100) % 10,
            (self.value // 10) % 10,
            self.value % 10,
        ]
        # All digits off
        for p in self.dig_pins: p.value(0)
        # Set segments
        self.set_segments(PATTERNS[digits[pos]])
        # Enable this digit (common-cathode: HIGH = on)
        self.dig_pins[pos].value(1)

    def set_count(self, count):
        self.value = max(0, min(9999, count))
        print(f"[Pico] Count: {self.value}")


def main():
    print("=" * 40)
    print("DarkLock Guild Count Display")
    print("Raspberry Pi Pico — 5461AS 7-Segment")
    print("=" * 40)

    display = GuildDisplay()

    # Boot test: show 8888 for 2 seconds
    display.set_count(8888)
    start = time.ticks_ms()
    digit = 0
    while time.ticks_diff(time.ticks_ms(), start) < 2000:
        display.show_digit(digit)
        digit = (digit + 1) % 4
        time.sleep_us(2000)

    display.set_count(0)
    print("[Pico] Ready — send 'COUNT:N' to update")

    # Main loop
    buf = ""
    digit = 0

    try:
        import select
        poll = select.poll()
        poll.register(sys.stdin, select.POLLIN)

        while True:
            # Check serial (non-blocking via poll)
            events = poll.poll(0)
            if events:
                ch = sys.stdin.read(1)
                if ch:
                    if ch == '\n':
                        line = buf.strip()
                        if line.startswith("COUNT:"):
                            try:
                                display.set_count(int(line[6:]))
                            except ValueError:
                                pass
                        elif line == "PING":
                            print("[Pico] PONG")
                        elif line == "RESET":
                            display.set_count(0)
                        buf = ""
                    else:
                        buf += ch

            # Multiplex display (cycle through 4 digits)
            display.show_digit(digit)
            digit = (digit + 1) % 4
            time.sleep_us(2000)  # 2ms per digit = ~125Hz refresh

    except ImportError:
        # Fallback if select not available
        print("[Pico] select unavailable, using polling")
        counter = 0
        while True:
            if counter % 50 == 0:
                try:
                    while True:
                        ch = sys.stdin.read(1) if hasattr(sys.stdin, 'read') else None
                        if not ch:
                            break
                        if ch == '\n':
                            line = buf.strip()
                            if line.startswith("COUNT:"):
                                try:
                                    display.set_count(int(line[6:]))
                                except ValueError:
                                    pass
                            elif line == "PING":
                                print("[Pico] PONG")
                            buf = ""
                        else:
                            buf += ch
                except Exception:
                    pass
            display.show_digit(digit)
            digit = (digit + 1) % 4
            counter += 1
            time.sleep_us(2000)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[Pico] Stopped")
        d = GuildDisplay()
        d.clear()
    except Exception as e:
        print(f"[Pico] Error: {e}")
        sys.print_exception(e)
