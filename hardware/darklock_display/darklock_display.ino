/*
 * DARKLOCK Hardware Display Module
 * ELEGOO Mega 2560 - LCD + LEDs controlled via serial from Pi 5
 * 
 * Hardware:
 *   16x2 LCD (4-bit): RS=A0, E=A1, D4=A2, D5=A3, D6=A4, D7=D30
 *   RGB LED 1 (Bot Status): R=D23, G=D25, B=D27  (PWM pins)
 *   Red LED (RFID Denied):  D32  (digital only)
 *   Green LED (RFID OK):    D34  (digital only)
 * 
 * Serial Protocol (115200 baud):
 *   LCD:line1|line2   - Update LCD (16 chars max per line)
 *   LED1:r,g,b        - Set RGB LED 1 (0-255 each)
 *   LED2:r,g,b        - Set RFID LEDs (r>0 = red ON, g>0 = green ON)
 *   CLEAR              - Clear LCD
 *   PING               - Health check (responds PONG)
 */

#include <LiquidCrystal.h>

// -- Pin Definitions --
// LCD (4-bit mode)
#define LCD_RS  A0
#define LCD_E   A1
#define LCD_D4  A2
#define LCD_D5  A3
#define LCD_D6  A4
#define LCD_D7  30

// RGB LED 1 - Bot/System Status (PWM capable pins)
#define LED1_R  23
#define LED1_G  25
#define LED1_B  27

// Single-color RFID status LEDs (digital only - ON/OFF)
#define RFID_RED    32
#define RFID_GREEN  34

// -- Objects --
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);

// -- Setup --
void setup() {
  Serial.begin(115200);
  
  lcd.begin(16, 2);
  lcd.clear();
  lcd.print("DARKLOCK v2.0");
  lcd.setCursor(0, 1);
  lcd.print("Booting...");
  
  // RGB LED 1 - PWM outputs
  pinMode(LED1_R, OUTPUT);
  pinMode(LED1_G, OUTPUT);
  pinMode(LED1_B, OUTPUT);
  
  // RFID LEDs - digital outputs
  pinMode(RFID_RED, OUTPUT);
  pinMode(RFID_GREEN, OUTPUT);
  
  // Initial state: red = waiting for gateway
  setLED1(255, 0, 0);
  setRFID(0, 0);
  
  delay(500);
  Serial.println("READY");
}

// -- Main Loop --
void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      processCommand(cmd);
    }
  }
}

// -- Command Processor --
void processCommand(String cmd) {
  
  if (cmd.startsWith("LCD:")) {
    String payload = cmd.substring(4);
    int sep = payload.indexOf('|');
    lcd.clear();
    if (sep >= 0) {
      lcd.setCursor(0, 0);
      lcd.print(payload.substring(0, min(sep, 16)));
      lcd.setCursor(0, 1);
      lcd.print(payload.substring(sep + 1, min((int)payload.length(), sep + 17)));
    } else {
      lcd.setCursor(0, 0);
      lcd.print(payload.substring(0, min((int)payload.length(), 16)));
    }
    Serial.println("ACK:LCD");
  }
  
  else if (cmd.startsWith("LED1:")) {
    String rgb = cmd.substring(5);
    int c1 = rgb.indexOf(',');
    int c2 = rgb.indexOf(',', c1 + 1);
    if (c1 > 0 && c2 > 0) {
      int r = constrain(rgb.substring(0, c1).toInt(), 0, 255);
      int g = constrain(rgb.substring(c1 + 1, c2).toInt(), 0, 255);
      int b = constrain(rgb.substring(c2 + 1).toInt(), 0, 255);
      setLED1(r, g, b);
      Serial.println("ACK:LED1");
    }
  }
  
  else if (cmd.startsWith("LED2:")) {
    String rgb = cmd.substring(5);
    int c1 = rgb.indexOf(',');
    int c2 = rgb.indexOf(',', c1 + 1);
    if (c1 > 0 && c2 > 0) {
      int r = rgb.substring(0, c1).toInt();
      int g = rgb.substring(c1 + 1, c2).toInt();
      setRFID(r, g);
      Serial.println("ACK:LED2");
    }
  }
  
  else if (cmd == "CLEAR") {
    lcd.clear();
    Serial.println("ACK:CLEAR");
  }
  
  else if (cmd == "PING") {
    Serial.println("PONG");
  }
}

// RGB LED 1 - full PWM color control
void setLED1(int r, int g, int b) {
  analogWrite(LED1_R, r);
  analogWrite(LED1_G, g);
  analogWrite(LED1_B, b);
}

// RFID status LEDs - digital ON/OFF
void setRFID(int r, int g) {
  digitalWrite(RFID_RED,   r > 0 ? HIGH : LOW);
  digitalWrite(RFID_GREEN, g > 0 ? HIGH : LOW);
}
