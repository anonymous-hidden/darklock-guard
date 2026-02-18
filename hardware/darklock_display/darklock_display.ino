/*
 * DARKLOCK Display Module — Elegoo Mega 2560
 * LCD + RGB LEDs display controller (simplified version)
 *
 * Pin Map:
 *   LCD 16×2:  RS=P7  EN=P8  D4=P9  D5=P10  D6=P11  D7=P12
 *   RGB-LED 1: R=D29  G=D31  B=D33
 *   RGB-LED 2: R=D23  G=D25  B=D27
 *   Tamper:    R=D32
 *   RFID LEDs: G=D28  R=D30
 *
 * Protocol: 115200 baud, newline-delimited
 *   LCD:line1|line2    LED1:r,g,b    LED2:r,g,b
 *   TAMPER:0/1         RFID:GREEN/RED/OFF    PING
 */

#include <LiquidCrystal.h>

#define LCD_RS   7
#define LCD_E    8
#define LCD_D4   9
#define LCD_D5  10
#define LCD_D6  11
#define LCD_D7  12

#define LED1_R  29
#define LED1_G  31
#define LED1_B  33

#define LED2_R  23
#define LED2_G  25
#define LED2_B  27

#define LED_TAMPER      32
#define LED_RFID_GREEN  28
#define LED_RFID_RED    30

LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);
String curL1 = "", curL2 = "";

void setup() {
  Serial.begin(115200);
  lcd.begin(16, 2);
  lcd.clear();
  lcd.print("DARKLOCK v2.0");
  lcd.setCursor(0, 1);
  lcd.print("Booting...");

  int pins[] = {LED1_R, LED1_G, LED1_B, LED2_R, LED2_G, LED2_B,
                LED_TAMPER, LED_RFID_GREEN, LED_RFID_RED};
  for (int i = 0; i < 9; i++) {
    pinMode(pins[i], OUTPUT);
    digitalWrite(pins[i], LOW);
  }

  // Self-test
  for (int i = 0; i < 9; i++) {
    digitalWrite(pins[i], HIGH); delay(100);
    digitalWrite(pins[i], LOW);
  }

  lcd.clear();
  lcd.print("DARKLOCK v2.0");
  lcd.setCursor(0, 1);
  lcd.print("Waiting for Pi..");
  Serial.println("READY");
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) processCmd(cmd);
  }
  delay(10);
}

void processCmd(String cmd) {
  if (cmd.startsWith("LCD:")) {
    String p = cmd.substring(4);
    int s = p.indexOf('|');
    lcd.clear();
    if (s >= 0) {
      lcd.setCursor(0, 0); lcd.print(p.substring(0, min(s, 16)));
      lcd.setCursor(0, 1); lcd.print(p.substring(s+1, min((int)p.length(), s+17)));
    } else {
      lcd.setCursor(0, 0); lcd.print(p.substring(0, 16));
    }
    Serial.println("ACK:LCD");
  }
  else if (cmd.startsWith("LED1:")) {
    parseLED(cmd.substring(5), LED1_R, LED1_G, LED1_B);
    Serial.println("ACK:LED1");
  }
  else if (cmd.startsWith("LED2:")) {
    parseLED(cmd.substring(5), LED2_R, LED2_G, LED2_B);
    Serial.println("ACK:LED2");
  }
  else if (cmd.startsWith("TAMPER:")) {
    digitalWrite(LED_TAMPER, cmd.substring(7).toInt() ? HIGH : LOW);
    Serial.println("ACK:TAMPER");
  }
  else if (cmd.startsWith("RFID:")) {
    String m = cmd.substring(5);
    if (m == "GREEN")     { digitalWrite(LED_RFID_GREEN, HIGH); digitalWrite(LED_RFID_RED, LOW); }
    else if (m == "RED")  { digitalWrite(LED_RFID_GREEN, LOW);  digitalWrite(LED_RFID_RED, HIGH); }
    else                  { digitalWrite(LED_RFID_GREEN, LOW);  digitalWrite(LED_RFID_RED, LOW); }
    Serial.println("ACK:RFID");
  }
  else if (cmd == "PING") Serial.println("PONG");
  else if (cmd == "CLEAR") { lcd.clear(); Serial.println("ACK:CLEAR"); }
}

void parseLED(String csv, int pR, int pG, int pB) {
  int c1 = csv.indexOf(','), c2 = csv.indexOf(',', c1+1);
  if (c1 < 0 || c2 < 0) return;
  digitalWrite(pR, csv.substring(0, c1).toInt() > 127 ? HIGH : LOW);
  digitalWrite(pG, csv.substring(c1+1, c2).toInt() > 127 ? HIGH : LOW);
  digitalWrite(pB, csv.substring(c2+1).toInt() > 127 ? HIGH : LOW);
}
