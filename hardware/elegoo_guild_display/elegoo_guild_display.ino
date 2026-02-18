/*
 * Guild Count Display for Elegoo Mega 2560 + 5461AS
 * Displays Discord bot server count on 4-digit 7-segment display
 * 
 * Wiring (5461AS pins to Elegoo Mega):
 * Bottom row (left to right): 1,2,3,4,5
 * Top row (left to right):    12,11,10,9,8,7,6
 * 
 * Pin mapping (adjust based on your exact wiring):
 * 5461AS Pin 1  (E)   → Digital 53
 * 5461AS Pin 2  (D)   → Digital 51  
 * 5461AS Pin 3  (DP)  → Digital 49
 * 5461AS Pin 4  (C)   → Digital 47
 * 5461AS Pin 5  (G)   → Digital 45
 * 5461AS Pin 6  (D4)  → Digital 43
 * 5461AS Pin 7  (B)   → Digital 42
 * 5461AS Pin 8  (D3)  → Digital 44
 * 5461AS Pin 9  (D2)  → Digital 46
 * 5461AS Pin 10 (F)   → Digital 48
 * 5461AS Pin 11 (A)   → Digital 50
 * 5461AS Pin 12 (D1)  → Digital 52
 * 
 * For 5461AS common-cathode:
 * - Segments: A=11, B=7, C=4, D=2, E=1, F=10, G=5, DP=3
 * - Digits: D1=12, D2=9, D3=8, D4=6
 */

#include <Arduino.h>

// Segment pins (A, B, C, D, E, F, G, DP) mapped to 5461AS
// 5461AS: A=pin11, B=pin7, C=pin4, D=pin2, E=pin1, F=pin10, G=pin5, DP=pin3
const byte SEG_PINS[8] = {
  50,  // A - 5461AS pin 11 → Mega pin 50
  42,  // B - 5461AS pin 7  → Mega pin 42
  47,  // C - 5461AS pin 4  → Mega pin 47
  51,  // D - 5461AS pin 2  → Mega pin 51
  53,  // E - 5461AS pin 1  → Mega pin 53
  48,  // F - 5461AS pin 10 → Mega pin 48
  45,  // G - 5461AS pin 5  → Mega pin 45
  49   // DP - 5461AS pin 3 → Mega pin 49
};

// Digit common pins (D1, D2, D3, D4) - cathodes for common-cathode display
// 5461AS: D1=pin12, D2=pin9, D3=pin8, D4=pin6
const byte DIGIT_PINS[4] = {
  52,  // D1 - 5461AS pin 12 → Mega pin 52
  46,  // D2 - 5461AS pin 9  → Mega pin 46
  44,  // D3 - 5461AS pin 8  → Mega pin 44
  43   // D4 - 5461AS pin 6  → Mega pin 43
};

// 7-segment patterns for digits 0-9 (common-cathode: HIGH = ON)
// Bit order: [DP, G, F, E, D, C, B, A]
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
volatile bool newDataReceived = false;

void setup() {
  Serial.begin(115200);
  
  // Initialize all pins
  for (byte i = 0; i < 8; i++) {
    pinMode(SEG_PINS[i], OUTPUT);
    digitalWrite(SEG_PINS[i], LOW);  // Common-cathode: LOW = OFF
  }
  
  for (byte i = 0; i < 4; i++) {
    pinMode(DIGIT_PINS[i], OUTPUT);
    digitalWrite(DIGIT_PINS[i], LOW);  // Common-cathode: LOW = digit OFF
  }
  
  Serial.println(F("[Elegoo] Guild Display Ready"));
  Serial.println(F("[Elegoo] Wiring: 5461AS pins 1-6 → Mega 53,51,49,47,45,43"));
  Serial.println(F("[Elegoo]         5461AS pins 7-12 → Mega 52,50,48,46,44,42"));
  Serial.println(F("[Elegoo] Send: COUNT:1234 to update display"));
  
  // Show test pattern "8888" for 2 seconds
  displayValue = 8888;
  unsigned long testStart = millis();
  while (millis() - testStart < 2000) {
    multiplexDisplay();
  }
  
  displayValue = 0;
  Serial.println(F("[Elegoo] Ready for data"));
}

void loop() {
  readSerial();
  multiplexDisplay();
}

void readSerial() {
  static String inputBuffer = "";
  
  while (Serial.available() > 0) {
    char c = Serial.read();
    
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processCommand(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }
}

void processCommand(String cmd) {
  cmd.trim();
  
  if (cmd.startsWith("COUNT:")) {
    int val = cmd.substring(6).toInt();
    displayValue = constrain(val, 0, 9999);
    Serial.print(F("[Elegoo] Display set to: "));
    Serial.println(displayValue);
    newDataReceived = true;
  }
  else if (cmd == "PING") {
    Serial.println(F("[Elegoo] PONG"));
  }
  else if (cmd == "RESET") {
    displayValue = 0;
    Serial.println(F("[Elegoo] Display reset"));
  }
  else if (cmd == "TEST") {
    displayValue = 8888;
    Serial.println(F("[Elegoo] Test pattern: 8888"));
  }
  else if (cmd.startsWith("BRIGHTNESS:")) {
    // Could implement PWM brightness control here
    Serial.println(F("[Elegoo] Brightness control not implemented"));
  }
  else {
    Serial.print(F("[Elegoo] Unknown command: "));
    Serial.println(cmd);
  }
}

void multiplexDisplay() {
  static byte currentDigit = 0;
  static unsigned long lastUpdate = 0;
  const unsigned long digitDelay = 2000; // 2ms per digit = 125Hz refresh
  
  unsigned long now = micros();
  if (now - lastUpdate < digitDelay) {
    return;
  }
  lastUpdate = now;
  
  // Turn off all digits first
  for (byte i = 0; i < 4; i++) {
    digitalWrite(DIGIT_PINS[i], LOW);
  }
  
  // Extract digits (left to right: thousands, hundreds, tens, ones)
  uint16_t val = displayValue;
  byte digits[4] = {
    (byte)((val / 1000) % 10),
    (byte)((val / 100) % 10),
    (byte)((val / 10) % 10),
    (byte)(val % 10)
  };
  
  // Set segments for current digit
  byte pattern = DIGIT_MAP[digits[currentDigit]];
  for (byte i = 0; i < 8; i++) {
    // Common-cathode: HIGH lights the segment
    digitalWrite(SEG_PINS[i], (pattern & (1 << i)) ? HIGH : LOW);
  }
  
  // Turn on current digit (common-cathode: HIGH = ON)
  digitalWrite(DIGIT_PINS[currentDigit], HIGH);
  
  // Move to next digit
  currentDigit = (currentDigit + 1) % 4;
}

void clearDisplay() {
  for (byte i = 0; i < 8; i++) {
    digitalWrite(SEG_PINS[i], LOW);
  }
  for (byte i = 0; i < 4; i++) {
    digitalWrite(DIGIT_PINS[i], LOW);
  }
}
