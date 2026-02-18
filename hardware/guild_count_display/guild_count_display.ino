/*
 * Guild Count Display for 5461AS (common-anode) 4-digit 7-seg
 * Elegoo/Arduino Mega 2560 wiring (matches user's existing segment pins):
 *   Segment a (pin 11) -> D13
 *   Segment b (pin 7)  -> D11
 *   Segment c (pin 4)  -> D7
 *   Segment d (pin 2)  -> D9
 *   Segment e (pin 1)  -> D10
 *   Segment f (pin 10) -> D12
 *   Segment g (pin 5)  -> D6
 *   Decimal point (pin 3) -> D8
 *
 *   Digit commons (pins 12, 9, 8, 6) MUST go to GPIO, not 5V:
 *     Pin 12 -> D2, Pin 9 -> D3, Pin 8 -> D4, Pin 6 -> D5
 *
 * Protocol: send lines like `COUNT:1234` over Serial @115200.
 */

#include <Arduino.h>

// Segment pins: a,b,c,d,e,f,g,dp
const byte SEG_PINS[8] = {13, 11, 7, 9, 10, 12, 6, 8};
// Digit common-anode pins D1..D4 (left to right)
const byte DIGIT_PINS[4] = {2, 3, 4, 5};

// Bitmaps for 0-9 (bit order matches SEG_PINS array)
const byte DIGIT_MAP[10] = {
  0b00111111, // 0
  0b00000110, // 1
  0b01011011, // 2
  0b01001111, // 3
  0b01100110, // 4
  0b01101101, // 5
  0b01111101, // 6
  0b00000111, // 7
  0b01111111, // 8
  0b01101111  // 9
};

volatile uint16_t displayValue = 0;

void setup() {
  Serial.begin(115200);

  for (byte p : SEG_PINS) pinMode(p, OUTPUT);
  for (byte p : DIGIT_PINS) pinMode(p, OUTPUT);

  clearSegments();
}

void loop() {
  readSerial();
  multiplexDigits();
}

// Accepts lines like COUNT:1234
void readSerial() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.startsWith("COUNT:")) return;

  int val = line.substring(6).toInt();
  displayValue = constrain(val, 0, 9999);
}

// Simple multiplexing ~330 Hz / 4 digits
void multiplexDigits() {
  static byte digit = 0;
  static unsigned long last = 0;
  const unsigned long interval = 3000; // microseconds per digit

  if (micros() - last < interval) return;
  last = micros();

  // extract digits (D1 is thousands)
  uint16_t val = displayValue;
  byte nums[4] = {
    (byte)((val / 1000) % 10),
    (byte)((val / 100)  % 10),
    (byte)((val / 10)   % 10),
    (byte)(val % 10)
  };

  setSegments(nums[digit]);

  digitalWrite(DIGIT_PINS[digit], HIGH);   // turn current digit ON
  delayMicroseconds(800);
  digitalWrite(DIGIT_PINS[digit], LOW);    // turn digit OFF

  digit = (digit + 1) % 4;
}

void setSegments(byte num) {
  byte mask = DIGIT_MAP[num];
  for (byte i = 0; i < 8; i++) {
    // Common-anode: LOW lights a segment
    digitalWrite(SEG_PINS[i], (mask & (1 << i)) ? LOW : HIGH);
  }
}

void clearSegments() {
  for (byte p : SEG_PINS) digitalWrite(p, HIGH);
  for (byte p : DIGIT_PINS) digitalWrite(p, LOW);
}
