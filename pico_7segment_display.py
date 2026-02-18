"""
DarkLock 7-Segment Display — Raspberry Pi Pico (MicroPython)
Shows Discord bot server count on 5461AS 4-digit 7-segment display.
Connected to Pi 5 via USB serial, receives COUNT:N commands.

Wiring (5461AS common-cathode):
  Segments through 220Ω resistors:
    A=GP2  B=GP3  C=GP4  D=GP5  E=GP6  F=GP7  G=GP8  DP=GP9
  Digit select (direct):
    DIG1=GP10  DIG2=GP11  DIG3=GP12  DIG4=GP13

NOTE: This is a copy of hardware/pico_guild_display/main.py.
      The canonical version lives there.
"""

import machine
import utime
import sys
import select

# Digit select pins (common-cathode: LOW = digit off, HIGH = digit on)
DIGIT_PINS = {0: 10, 1: 11, 2: 12, 3: 13}

# Segment pins (HIGH = segment on)
SEGMENT_PINS = {
    'A': 2, 'B': 3, 'C': 4, 'D': 5,
    'E': 6, 'F': 7, 'G': 8, 'DP': 9
}

DIGIT_PATTERNS = {
    0: ['A','B','C','D','E','F'],
    1: ['B','C'],
    2: ['A','B','D','E','G'],
    3: ['A','B','C','D','G'],
    4: ['B','C','F','G'],
    5: ['A','C','D','F','G'],
    6: ['A','C','D','E','F','G'],
    7: ['A','B','C'],
    8: ['A','B','C','D','E','F','G'],
    9: ['A','B','C','D','F','G']
}


class SevenSegmentDisplay:
    def __init__(self):
        self.digit_pins = {}
        for pos, pin in DIGIT_PINS.items():
            self.digit_pins[pos] = machine.Pin(pin, machine.Pin.OUT)
            self.digit_pins[pos].value(0)

        self.segment_pins = {}
        for seg, pin in SEGMENT_PINS.items():
            self.segment_pins[seg] = machine.Pin(pin, machine.Pin.OUT)
            self.segment_pins[seg].value(0)

        self.current_number = 0
        self.poll = select.poll()
        self.poll.register(sys.stdin, select.POLLIN)
        print("[Pico] 7-Segment initialized (common-cathode)")

    def clear_all(self):
        for p in self.digit_pins.values(): p.value(0)
        for p in self.segment_pins.values(): p.value(0)

    def display_digit(self, pos, value):
        self.clear_all()
        if 0 <= value <= 9:
            for seg in DIGIT_PATTERNS[value]:
                self.segment_pins[seg].value(1)
            self.digit_pins[pos].value(1)

    def display_number(self, number):
        number = max(0, min(9999, number))
        digits = [
            (number // 1000) % 10,
            (number // 100) % 10,
            (number // 10) % 10,
            number % 10
        ]
        for i in range(4):
            self.display_digit(i, digits[i])
            utime.sleep_ms(2)

    def check_serial(self):
        events = self.poll.poll(0)
        if events:
            line = sys.stdin.readline().strip()
            if line.startswith("COUNT:"):
                try:
                    self.current_number = max(0, min(9999, int(line[6:])))
                    print(f"Count: {self.current_number}")
                except ValueError:
                    pass
            elif line == "PING":
                print("PONG")
            elif line == "RESET":
                self.current_number = 0

    def run(self):
        while True:
            self.check_serial()
            self.display_number(self.current_number)


if __name__ == "__main__":
    display = SevenSegmentDisplay()
    # Startup test
    print("Testing 8888...")
    for _ in range(500):
        display.display_number(8888)
    display.current_number = 0
    print("Ready — send COUNT:N")
    try:
        display.run()
    except KeyboardInterrupt:
        display.clear_all()
        print("Stopped")
