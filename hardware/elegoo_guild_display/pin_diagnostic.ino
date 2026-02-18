/*
 * DARKLOCK Pin Diagnostic — Elegoo Mega 2560
 * Tests all hardware pins one by one to verify wiring.
 *
 * Pin Map:
 *   LCD:     RS=P7  EN=P8  D4=P9  D5=P10  D6=P11  D7=P12
 *   LED1:    R=D29  G=D31  B=D33
 *   LED2:    R=D23  G=D25  B=D27
 *   Tamper:  R=D32
 *   RFID:    G=D28  R=D30
 *   Matrix:  DIN=D22  CS=D24  CLK=D26
 */

// All testable digital output pins
const int TEST_PINS[] = {
  7, 8, 9, 10, 11, 12,   // LCD (P7-P12)
  29, 31, 33,              // RGB LED 1
  23, 25, 27,              // RGB LED 2
  32,                      // Tamper LED
  28, 30,                  // RFID LEDs
  22, 24, 26               // MAX7219
};
const char* PIN_NAMES[] = {
  "LCD_RS(P7)", "LCD_EN(P8)", "LCD_D4(P9)", "LCD_D5(P10)", "LCD_D6(P11)", "LCD_D7(P12)",
  "LED1_R(D29)", "LED1_G(D31)", "LED1_B(D33)",
  "LED2_R(D23)", "LED2_G(D25)", "LED2_B(D27)",
  "TAMPER(D32)",
  "RFID_G(D28)", "RFID_R(D30)",
  "MX_DIN(D22)", "MX_CS(D24)", "MX_CLK(D26)"
};
const int PIN_COUNT = sizeof(TEST_PINS) / sizeof(TEST_PINS[0]);

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < PIN_COUNT; i++) {
    pinMode(TEST_PINS[i], OUTPUT);
    digitalWrite(TEST_PINS[i], LOW);
  }
  Serial.println("=== DARKLOCK Pin Diagnostic ===");
  Serial.println("Testing each pin for 1 second...\n");
}

void loop() {
  for (int i = 0; i < PIN_COUNT; i++) {
    Serial.print("ON:  ");
    Serial.print(PIN_NAMES[i]);
    Serial.print(" (pin ");
    Serial.print(TEST_PINS[i]);
    Serial.println(")");

    digitalWrite(TEST_PINS[i], HIGH);
    delay(1000);
    digitalWrite(TEST_PINS[i], LOW);

    Serial.println("OFF\n");
    delay(300);
  }

  Serial.println("--- All pins tested. Restarting in 3s ---\n");
  delay(3000);
}
