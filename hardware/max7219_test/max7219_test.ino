/*
 * MAX7219 8x8 Dot Matrix Test — Elegoo Mega 2560
 * Tests the MAX7219 with the correct DarkLock pin assignments.
 *
 * Wiring:
 *   VCC → +5V    GND → GND
 *   DIN → D22    CS  → D24    CLK → D26
 */

#include <LedControl.h>

#define MATRIX_DIN  22
#define MATRIX_CS   24
#define MATRIX_CLK  26

LedControl matrix = LedControl(MATRIX_DIN, MATRIX_CLK, MATRIX_CS, 1);

void setup() {
  Serial.begin(115200);
  matrix.shutdown(0, false);
  matrix.setIntensity(0, 8);
  matrix.clearDisplay(0);
  Serial.println("MAX7219 Test — DIN=D22 CS=D24 CLK=D26");
  Serial.println("Running test patterns...");
}

void loop() {
  // Test 1: All ON
  Serial.println("All ON");
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, 0xFF);
  delay(1500);

  // Test 2: All OFF
  Serial.println("All OFF");
  matrix.clearDisplay(0);
  delay(500);

  // Test 3: Checkerboard
  Serial.println("Checkerboard");
  for (int r = 0; r < 8; r++)
    matrix.setRow(0, r, (r % 2) ? 0xAA : 0x55);
  delay(1500);

  // Test 4: Lock icon
  Serial.println("Lock icon");
  matrix.clearDisplay(0);
  byte lock[] = {0x3C, 0x42, 0x42, 0xFF, 0xBD, 0xBD, 0xFF, 0x00};
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, lock[r]);
  delay(1500);

  // Test 5: Checkmark
  Serial.println("Checkmark");
  matrix.clearDisplay(0);
  byte check[] = {0x00, 0x01, 0x03, 0x86, 0xCC, 0x78, 0x30, 0x00};
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, check[r]);
  delay(1500);

  // Test 6: X mark
  Serial.println("X mark");
  matrix.clearDisplay(0);
  byte xm[] = {0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81};
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, xm[r]);
  delay(1500);

  // Test 7: Radar sweep
  Serial.println("Radar sweep");
  for (int col = 0; col < 8; col++) {
    matrix.clearDisplay(0);
    for (int r = 0; r < 8; r++) matrix.setLed(0, r, col, true);
    delay(100);
  }
  for (int col = 6; col >= 1; col--) {
    matrix.clearDisplay(0);
    for (int r = 0; r < 8; r++) matrix.setLed(0, r, col, true);
    delay(100);
  }

  // Test 8: "D" letter
  Serial.println("Letter D");
  matrix.clearDisplay(0);
  byte d[] = {0xFC, 0xC6, 0xC3, 0xC3, 0xC3, 0xC3, 0xC6, 0xFC};
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, d[r]);
  delay(1500);

  matrix.clearDisplay(0);
  Serial.println("--- Cycle complete ---\n");
  delay(1000);
}
