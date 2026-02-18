/*
 * DARKLOCK Combined Display Controller — Elegoo Mega 2560
 * LCD + RGB LEDs + Tamper LED + RFID LEDs + MAX7219 Dot Matrix
 *
 * NOTE: 7-segment guild count display is handled by the Raspberry Pi Pico.
 *       This sketch controls the LCD, LEDs, and dot matrix only.
 *
 * ─── PIN MAP (D = Digital, P = PWM) ───────────────────────────
 *
 *   RGB-LED 1 (Bot Status):    R=D29  G=D31  B=D33
 *   RGB-LED 2 (Secondary):     R=D23  G=D25  B=D27
 *   Tamper Shutdown LED:       R=D32
 *   RFID Scanner LED:          G=D28  R=D30
 *
 *   LCD 16×2 (4-bit, left→right pin header):
 *     1=GND  2=VCC  3=Contrast  4=RS(P7)  5=GND(R/W)  6=EN(P8)
 *     11=D4(P9)  12=D5(P10)  13=D6(P11)  14=D7(P12)
 *     15=VCC(backlight)  16=GND(backlight)
 *
 *   MAX7219 8×8 Dot Matrix:
 *     1=VCC  2=GND  DIN=D22  CS=D24  CLK=D26
 *
 * ─── SERIAL PROTOCOL (115200 baud) ────────────────────────────
 *   LCD:line1|line2     Update LCD
 *   LED1:r,g,b          RGB LED 1 (0-255, threshold 128)
 *   LED2:r,g,b          RGB LED 2
 *   TAMPER:0/1           Tamper LED
 *   RFID:GREEN/RED/OFF   RFID indicator LEDs
 *   CLEAR                Clear LCD
 *   PING                 Heartbeat → responds PONG
 *   MATRIX_SCAN/OK/DENIED/ALERT/IDLE/LOCK  Matrix animations
 */

#include <LiquidCrystal.h>
#include <LedControl.h>

// ─── LCD (PWM pins used as digital) ────────────────────────────
#define LCD_RS   7
#define LCD_E    8
#define LCD_D4   9
#define LCD_D5  10
#define LCD_D6  11
#define LCD_D7  12

// ─── RGB LED 1 — Bot Status ────────────────────────────────────
#define LED1_R  29
#define LED1_G  31
#define LED1_B  33

// ─── RGB LED 2 — Secondary ─────────────────────────────────────
#define LED2_R  23
#define LED2_G  25
#define LED2_B  27

// ─── Tamper Shutdown LED ────────────────────────────────────────
#define LED_TAMPER  32

// ─── RFID Scanner LEDs ─────────────────────────────────────────
#define LED_RFID_GREEN  28
#define LED_RFID_RED    30

// ─── MAX7219 Dot Matrix ────────────────────────────────────────
#define MATRIX_DIN  22
#define MATRIX_CS   24
#define MATRIX_CLK  26

// ─── Constants ──────────────────────────────────────────────────
#define SERIAL_BAUD      115200
#define LCD_COLS         16
#define LCD_ROWS         2
#define NO_SIGNAL_MS     30000
#define HEARTBEAT_MS     10000
#define MATRIX_BRIGHTNESS 8

// ─── Matrix States ─────────────────────────────────────────────
enum MatrixState { M_IDLE, M_SCANNING, M_OK, M_DENIED, M_ALERT, M_LOCK };

// ─── Objects ────────────────────────────────────────────────────
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);
LedControl matrix = LedControl(MATRIX_DIN, MATRIX_CLK, MATRIX_CS, 1);

// ─── State ──────────────────────────────────────────────────────
unsigned long lastPiMsg    = 0;
unsigned long lastHeart    = 0;
bool          noSignal     = false;
String        curLine1     = "";
String        curLine2     = "";
MatrixState   mxState      = M_IDLE;
unsigned long mxStateStart = 0;
int           mxPos        = 0;
bool          mxDir        = true;

// ═════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(100);

  lcd.begin(LCD_COLS, LCD_ROWS);
  lcd.clear();
  showLCD("DARKLOCK v2.0", "Booting...");

  // RGB LED 1
  pinMode(LED1_R, OUTPUT); pinMode(LED1_G, OUTPUT); pinMode(LED1_B, OUTPUT);
  // RGB LED 2
  pinMode(LED2_R, OUTPUT); pinMode(LED2_G, OUTPUT); pinMode(LED2_B, OUTPUT);
  // Tamper
  pinMode(LED_TAMPER, OUTPUT); digitalWrite(LED_TAMPER, LOW);
  // RFID
  pinMode(LED_RFID_GREEN, OUTPUT); pinMode(LED_RFID_RED, OUTPUT);
  digitalWrite(LED_RFID_GREEN, LOW); digitalWrite(LED_RFID_RED, LOW);

  // MAX7219
  matrix.shutdown(0, false);
  matrix.setIntensity(0, MATRIX_BRIGHTNESS);
  matrix.clearDisplay(0);

  // Self-test
  ledSelfTest();

  showLCD("DARKLOCK v2.0", "Waiting for Pi..");
  setLED1(0, 0, 0);
  setLED2(0, 0, 0);
  setMxState(M_IDLE);

  delay(500);
  Serial.println("READY");
  Serial.println("[Elegoo] Combined Controller Ready");
  lastPiMsg = millis();
}

void loop() {
  unsigned long now = millis();

  // Serial
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      processCommand(cmd);
      lastPiMsg = now;
      noSignal = false;
    }
  }

  // No-signal watchdog
  if (!noSignal && (now - lastPiMsg > NO_SIGNAL_MS)) {
    showLCD("  NO SIGNAL", " Pi disconnected");
    setLED1(1, 0, 0);
    noSignal = true;
  }

  // Heartbeat
  if (now - lastHeart > HEARTBEAT_MS) {
    lastHeart = now;
    Serial.println("PONG");
  }

  // Matrix animation
  updateMatrix(now);
  delay(10);
}

// ─── COMMAND PROCESSOR ──────────────────────────────────────────
void processCommand(String cmd) {
  if (cmd.startsWith("LCD:")) {
    String p = cmd.substring(4);
    int sep = p.indexOf('|');
    if (sep >= 0) showLCD(p.substring(0, sep), p.substring(sep + 1));
    else showLCD(p, "");
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
    String mode = cmd.substring(5);
    if (mode == "GREEN")     { digitalWrite(LED_RFID_GREEN, HIGH); digitalWrite(LED_RFID_RED, LOW); }
    else if (mode == "RED")  { digitalWrite(LED_RFID_GREEN, LOW);  digitalWrite(LED_RFID_RED, HIGH); }
    else                     { digitalWrite(LED_RFID_GREEN, LOW);  digitalWrite(LED_RFID_RED, LOW); }
    Serial.println("ACK:RFID");
  }
  else if (cmd == "PING")           Serial.println("PONG");
  else if (cmd == "CLEAR")        { lcd.clear(); curLine1=""; curLine2=""; Serial.println("ACK:CLEAR"); }
  else if (cmd == "MATRIX_SCAN")  { setMxState(M_SCANNING); Serial.println("ACK:MATRIX_SCAN"); }
  else if (cmd == "MATRIX_OK")    { setMxState(M_OK);       Serial.println("ACK:MATRIX_OK"); }
  else if (cmd == "MATRIX_DENIED"){ setMxState(M_DENIED);   Serial.println("ACK:MATRIX_DENIED"); }
  else if (cmd == "MATRIX_ALERT") { setMxState(M_ALERT);    Serial.println("ACK:MATRIX_ALERT"); }
  else if (cmd == "MATRIX_IDLE")  { setMxState(M_IDLE);     Serial.println("ACK:MATRIX_IDLE"); }
  else if (cmd == "MATRIX_LOCK")  { setMxState(M_LOCK);     Serial.println("ACK:MATRIX_LOCK"); }
  else { Serial.print("[Elegoo] Unknown: "); Serial.println(cmd); }
}

// ─── LCD ────────────────────────────────────────────────────────
void showLCD(String l1, String l2) {
  if (l1 == curLine1 && l2 == curLine2) return;
  curLine1 = l1; curLine2 = l2;
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(pad(l1));
  lcd.setCursor(0, 1); lcd.print(pad(l2));
}
String pad(String s) {
  if ((unsigned)s.length() > LCD_COLS) return s.substring(0, LCD_COLS);
  while ((unsigned)s.length() < LCD_COLS) s += ' ';
  return s;
}

// ─── LED Helpers ────────────────────────────────────────────────
void parseLED(String csv, int pR, int pG, int pB) {
  int c1 = csv.indexOf(','), c2 = csv.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return;
  digitalWrite(pR, csv.substring(0, c1).toInt() > 127 ? HIGH : LOW);
  digitalWrite(pG, csv.substring(c1+1, c2).toInt() > 127 ? HIGH : LOW);
  digitalWrite(pB, csv.substring(c2+1).toInt()     > 127 ? HIGH : LOW);
}
void setLED1(int r, int g, int b) {
  digitalWrite(LED1_R, r ? HIGH : LOW);
  digitalWrite(LED1_G, g ? HIGH : LOW);
  digitalWrite(LED1_B, b ? HIGH : LOW);
}
void setLED2(int r, int g, int b) {
  digitalWrite(LED2_R, r ? HIGH : LOW);
  digitalWrite(LED2_G, g ? HIGH : LOW);
  digitalWrite(LED2_B, b ? HIGH : LOW);
}

void ledSelfTest() {
  setLED1(1,0,0); delay(150); setLED1(0,1,0); delay(150);
  setLED1(0,0,1); delay(150); setLED1(0,0,0); delay(100);
  setLED2(1,0,0); delay(150); setLED2(0,1,0); delay(150);
  setLED2(0,0,1); delay(150); setLED2(0,0,0); delay(100);
  digitalWrite(LED_TAMPER, HIGH); delay(150); digitalWrite(LED_TAMPER, LOW);
  digitalWrite(LED_RFID_GREEN, HIGH); delay(150); digitalWrite(LED_RFID_GREEN, LOW);
  digitalWrite(LED_RFID_RED, HIGH);   delay(150); digitalWrite(LED_RFID_RED, LOW);
}

// ─── Matrix Animation ──────────────────────────────────────────
void setMxState(MatrixState s) {
  mxState = s; mxStateStart = millis();
  mxPos = 0; mxDir = true;
  matrix.clearDisplay(0);
}

void updateMatrix(unsigned long now) {
  unsigned long el = now - mxStateStart;
  switch (mxState) {
    case M_IDLE:     mxRadar(); break;
    case M_SCANNING: mxScan();  break;
    case M_OK:       mxCheck(); if (el >= 2000) setMxState(M_IDLE); break;
    case M_DENIED:   mxX();     if (el >= 2000) setMxState(M_IDLE); break;
    case M_ALERT:    mxFlash(); if (el >= 4000) setMxState(M_IDLE); break;
    case M_LOCK:     mxLock();  break;
  }
}

void mxRadar() {
  static unsigned long t = 0;
  if (millis() - t < 80) return; t = millis();
  matrix.clearDisplay(0);
  for (int r = 0; r < 8; r++) matrix.setLed(0, r, mxPos, true);
  if (mxDir) { if (++mxPos >= 7) mxDir = false; }
  else       { if (--mxPos <= 0) mxDir = true; }
}
void mxScan() {
  static unsigned long t = 0; static int row = 0;
  if (millis() - t < 100) return; t = millis();
  matrix.clearDisplay(0);
  matrix.setRow(0, row, B11111111);
  row = (row + 1) % 8;
}
void mxCheck() {
  byte ic[] = {0x00,0x01,0x03,0x86,0xCC,0x78,0x30,0x00};
  for (int r=0;r<8;r++) matrix.setRow(0,r,ic[r]);
}
void mxX() {
  byte ic[] = {0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81};
  for (int r=0;r<8;r++) matrix.setRow(0,r,ic[r]);
}
void mxFlash() {
  static unsigned long t = 0; static bool on = false;
  if (millis()-t < 200) return; t=millis(); on=!on;
  for (int r=0;r<8;r++) matrix.setRow(0,r, on ? 0xFF : 0x00);
}
void mxLock() {
  byte ic[] = {0x3C,0x42,0x42,0xFF,0xBD,0xBD,0xFF,0x00};
  for (int r=0;r<8;r++) matrix.setRow(0,r,ic[r]);
}
