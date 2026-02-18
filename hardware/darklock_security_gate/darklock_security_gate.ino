/*
 * ═══════════════════════════════════════════════════════════════
 *  DARKLOCK SECURITY GATE — ELEGOO Mega 2560
 *  Display & Sensor Module (NO SECURITY DECISIONS)
 * ═══════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Dumb terminal. Shows status on LCD, drives two RGB LEDs,
 *   tamper LED, RFID indicator LEDs, MAX7219 dot matrix,
 *   relays everything to the Raspberry Pi 5 over USB serial.
 *   ALL security logic lives on the Pi.
 *
 * ─── PIN MAP (D = Digital, P = PWM) ───────────────────────────
 *
 *   RGB-LED 1 (Bot Status):
 *     Red   = D29     Green = D31     Blue  = D33
 *
 *   RGB-LED 2 (Secondary):
 *     Red   = D23     Green = D25     Blue  = D27
 *
 *   Tamper Detection Shutdown LED:
 *     Red   = D32
 *
 *   RFID Scanner LED:
 *     Green = D28     Red   = D30
 *
 *   LCD 16×2 (4-bit mode, pin # = LCD header left→right):
 *     1=GND  2=VCC  3=Contrast  4=RS(P7)  5=GND(R/W)  6=EN(P8)
 *     11=D4(P9)  12=D5(P10)  13=D6(P11)  14=D7(P12)
 *     15=VCC(backlight)  16=GND(backlight)
 *
 *   MAX7219 8×8 Dot Matrix:
 *     1=VCC  2=GND  DIN=D22  CS=D24  CLK=D26
 *
 * ─── SERIAL PROTOCOL (115200 baud, newline-delimited) ─────────
 *
 *   Pi → Arduino (commands):
 *     LCD:line1|line2         Update LCD display
 *     LED1:r,g,b             Set bot-status RGB LED 1 (0-255)
 *     LED2:r,g,b             Set secondary RGB LED 2 (0-255)
 *     TAMPER:0/1              Tamper LED off/on
 *     RFID:GREEN              RFID LED green on, red off
 *     RFID:RED                RFID LED red on, green off
 *     RFID:OFF                Both RFID LEDs off
 *     PING                    Heartbeat check
 *     MATRIX_SCAN             Matrix: scanning animation
 *     MATRIX_OK               Matrix: checkmark (granted)
 *     MATRIX_DENIED           Matrix: X mark (denied)
 *     MATRIX_ALERT            Matrix: flash (intrusion)
 *     MATRIX_IDLE             Matrix: return to idle
 *     MATRIX_LOCK             Matrix: show lock icon
 *     MATRIX_BOOT             Matrix: boot animation
 *
 *   Arduino → Pi (events):
 *     READY                   Boot complete
 *     PONG                    Heartbeat reply
 *     ACK:cmd                 Command acknowledged
 *
 * ─── LED MEANINGS ─────────────────────────────────────────────
 *   LED1 (Bot Status):
 *     Red       = Bot is DOWN / offline
 *     Blue      = Bot restarting / starting up
 *     Green     = Bot running normally
 *
 *   LED2 (Secondary Status):
 *     Red       = Error / critical
 *     Green     = All clear / healthy
 *     Blue      = Processing / waiting
 *     Purple    = System alert
 *
 *   Tamper LED:
 *     Red ON    = Tamper detected / system shutdown
 *
 *   RFID LEDs:
 *     Green     = Access granted / valid card
 *     Red       = Access denied / invalid card
 *     Both off  = Idle / no scan
 */

#include <LiquidCrystal.h>
#include <LedControl.h>

// ─── PIN DEFINITIONS ───────────────────────────────────────────

// LCD 16×2 (4-bit mode) — using PWM-capable pins as digital
#define LCD_RS   7   // P7
#define LCD_E    8   // P8
#define LCD_D4   9   // P9
#define LCD_D5  10   // P10
#define LCD_D6  11   // P11
#define LCD_D7  12   // P12

// RGB LED 1 — Bot Status (Digital on/off)
#define LED1_R  29   // D29
#define LED1_G  31   // D31
#define LED1_B  33   // D33

// RGB LED 2 — Secondary Status (Digital on/off)
#define LED2_R  23   // D23
#define LED2_G  25   // D25
#define LED2_B  27   // D27

// Tamper Detection Shutdown LED
#define LED_TAMPER  32  // D32 — Red LED

// RFID Scanner LEDs
#define LED_RFID_GREEN  28  // D28
#define LED_RFID_RED    30  // D30

// MAX7219 8×8 LED Dot Matrix (Software SPI)
#define MATRIX_DIN  22  // D22
#define MATRIX_CS   24  // D24
#define MATRIX_CLK  26  // D26

// ─── CONSTANTS ──────────────────────────────────────────────────
#define SERIAL_BAUD      115200
#define LCD_COLS         16
#define LCD_ROWS         2
#define NO_SIGNAL_MS     30000   // "No Signal" after 30s silence
#define HEARTBEAT_MS     10000   // Heartbeat every 10s
#define MATRIX_BRIGHTNESS 8      // Matrix brightness (0-15)

// ─── SYSTEM STATES ─────────────────────────────────────────────
enum SystemState {
  STATE_IDLE,
  STATE_SCANNING,
  STATE_AUTHORIZED,
  STATE_DENIED,
  STATE_ALERT,
  STATE_LOCK,
  STATE_BOOT
};

// ─── OBJECTS ────────────────────────────────────────────────────
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);
LedControl matrix = LedControl(MATRIX_DIN, MATRIX_CLK, MATRIX_CS, 1);

// ─── STATE ──────────────────────────────────────────────────────
unsigned long lastPiMessage   = 0;
unsigned long lastHeartbeat   = 0;
bool          noSignalShown   = false;
String        currentLine1    = "";
String        currentLine2    = "";

SystemState currentState = STATE_BOOT;
unsigned long stateStartTime = 0;
int animPos = 0;
bool animDirection = true;

// ─── SETUP ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(100);

  // LCD init
  lcd.begin(LCD_COLS, LCD_ROWS);
  lcd.clear();
  showLCD("DARKLOCK v2.0", "Booting...");

  // RGB LED 1 pins (Digital)
  pinMode(LED1_R, OUTPUT);
  pinMode(LED1_G, OUTPUT);
  pinMode(LED1_B, OUTPUT);

  // RGB LED 2 pins (Digital)
  pinMode(LED2_R, OUTPUT);
  pinMode(LED2_G, OUTPUT);
  pinMode(LED2_B, OUTPUT);

  // Tamper LED
  pinMode(LED_TAMPER, OUTPUT);
  digitalWrite(LED_TAMPER, LOW);

  // RFID LEDs
  pinMode(LED_RFID_GREEN, OUTPUT);
  pinMode(LED_RFID_RED, OUTPUT);
  digitalWrite(LED_RFID_GREEN, LOW);
  digitalWrite(LED_RFID_RED, LOW);

  // MAX7219 init
  matrix.shutdown(0, false);
  matrix.setIntensity(0, MATRIX_BRIGHTNESS);
  matrix.clearDisplay(0);

  // Boot animation on matrix
  setState(STATE_BOOT);

  // LED self-test: R → G → B on both RGB LEDs, flash tamper & RFID
  ledSelfTest();

  // Ready state
  showLCD("DARKLOCK v2.0", "Waiting for Pi..");
  setLED1(0, 0, 0);
  setLED2(0, 0, 0);
  setState(STATE_IDLE);

  delay(500);
  Serial.println("READY");
  lastPiMessage = millis();
}

// ─── MAIN LOOP ──────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1) Serial commands from Pi
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      processCommand(cmd);
      lastPiMessage = now;
      noSignalShown = false;
    }
  }

  // 2) No-signal watchdog
  if (!noSignalShown && (now - lastPiMessage > NO_SIGNAL_MS)) {
    showLCD("  NO SIGNAL", " Pi disconnected");
    setLED1(1, 0, 0);  // Red
    setLED2(1, 0, 1);  // Purple
    noSignalShown = true;
  }

  // 3) Periodic heartbeat
  if (now - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = now;
    Serial.println("PONG");
  }

  // 4) Matrix animations
  updateStateAnimation(now);

  delay(10);
}

// ─── COMMAND PROCESSOR ──────────────────────────────────────────
void processCommand(String cmd) {
  // LCD update
  if (cmd.startsWith("LCD:")) {
    String payload = cmd.substring(4);
    int sep = payload.indexOf('|');
    if (sep >= 0) {
      showLCD(payload.substring(0, sep), payload.substring(sep + 1));
    } else {
      showLCD(payload, "");
    }
    Serial.println("ACK:LCD");
  }
  // RGB LED 1
  else if (cmd.startsWith("LED1:")) {
    parseLED(cmd.substring(5), LED1_R, LED1_G, LED1_B);
    Serial.println("ACK:LED1");
  }
  // RGB LED 2
  else if (cmd.startsWith("LED2:")) {
    parseLED(cmd.substring(5), LED2_R, LED2_G, LED2_B);
    Serial.println("ACK:LED2");
  }
  // Tamper LED
  else if (cmd.startsWith("TAMPER:")) {
    int val = cmd.substring(7).toInt();
    digitalWrite(LED_TAMPER, val ? HIGH : LOW);
    Serial.println("ACK:TAMPER");
  }
  // RFID LEDs
  else if (cmd.startsWith("RFID:")) {
    String mode = cmd.substring(5);
    if (mode == "GREEN") {
      digitalWrite(LED_RFID_GREEN, HIGH);
      digitalWrite(LED_RFID_RED, LOW);
    } else if (mode == "RED") {
      digitalWrite(LED_RFID_GREEN, LOW);
      digitalWrite(LED_RFID_RED, HIGH);
    } else if (mode == "OFF") {
      digitalWrite(LED_RFID_GREEN, LOW);
      digitalWrite(LED_RFID_RED, LOW);
    }
    Serial.println("ACK:RFID");
  }
  // Heartbeat
  else if (cmd == "PING") {
    Serial.println("PONG");
  }
  // Matrix commands
  else if (cmd == "MATRIX_SCAN") {
    setState(STATE_SCANNING);
    Serial.println("ACK:MATRIX_SCAN");
  }
  else if (cmd == "MATRIX_OK") {
    setState(STATE_AUTHORIZED);
    Serial.println("ACK:MATRIX_OK");
  }
  else if (cmd == "MATRIX_DENIED") {
    setState(STATE_DENIED);
    Serial.println("ACK:MATRIX_DENIED");
  }
  else if (cmd == "MATRIX_ALERT") {
    setState(STATE_ALERT);
    Serial.println("ACK:MATRIX_ALERT");
  }
  else if (cmd == "MATRIX_IDLE") {
    setState(STATE_IDLE);
    Serial.println("ACK:MATRIX_IDLE");
  }
  else if (cmd == "MATRIX_LOCK") {
    setState(STATE_LOCK);
    Serial.println("ACK:MATRIX_LOCK");
  }
  else if (cmd == "MATRIX_BOOT") {
    setState(STATE_BOOT);
    Serial.println("ACK:MATRIX_BOOT");
  }
  // Clear LCD
  else if (cmd == "CLEAR") {
    lcd.clear();
    currentLine1 = "";
    currentLine2 = "";
    Serial.println("ACK:CLEAR");
  }
}

// ─── LCD HELPERS ────────────────────────────────────────────────
void showLCD(String line1, String line2) {
  if (line1 == currentLine1 && line2 == currentLine2) return;
  currentLine1 = line1;
  currentLine2 = line2;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(pad(line1));
  lcd.setCursor(0, 1);
  lcd.print(pad(line2));
}

String pad(String s) {
  if ((unsigned int)s.length() > LCD_COLS) return s.substring(0, LCD_COLS);
  while ((unsigned int)s.length() < LCD_COLS) s += ' ';
  return s;
}

// ─── LED HELPERS ────────────────────────────────────────────────
// Digital pins: threshold at 128 → HIGH or LOW
void parseLED(String csv, int pinR, int pinG, int pinB) {
  int c1 = csv.indexOf(',');
  int c2 = csv.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return;
  int r = csv.substring(0, c1).toInt();
  int g = csv.substring(c1 + 1, c2).toInt();
  int b = csv.substring(c2 + 1).toInt();
  digitalWrite(pinR, r > 127 ? HIGH : LOW);
  digitalWrite(pinG, g > 127 ? HIGH : LOW);
  digitalWrite(pinB, b > 127 ? HIGH : LOW);
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

// ─── LED SELF-TEST ──────────────────────────────────────────────
void ledSelfTest() {
  // RGB LED 1: R → G → B
  setLED1(1, 0, 0); delay(200);
  setLED1(0, 1, 0); delay(200);
  setLED1(0, 0, 1); delay(200);
  setLED1(0, 0, 0); delay(100);

  // RGB LED 2: R → G → B
  setLED2(1, 0, 0); delay(200);
  setLED2(0, 1, 0); delay(200);
  setLED2(0, 0, 1); delay(200);
  setLED2(0, 0, 0); delay(100);

  // Tamper LED flash
  digitalWrite(LED_TAMPER, HIGH); delay(200);
  digitalWrite(LED_TAMPER, LOW);  delay(100);

  // RFID LEDs flash
  digitalWrite(LED_RFID_GREEN, HIGH); delay(200);
  digitalWrite(LED_RFID_GREEN, LOW);
  digitalWrite(LED_RFID_RED, HIGH);   delay(200);
  digitalWrite(LED_RFID_RED, LOW);    delay(100);
}

// ═══════════════════════════════════════════════════════════════
//  MAX7219 DOT MATRIX ANIMATION ENGINE
// ═══════════════════════════════════════════════════════════════

void setState(SystemState newState) {
  currentState = newState;
  stateStartTime = millis();
  animPos = 0;
  animDirection = true;
  matrix.clearDisplay(0);
}

void updateStateAnimation(unsigned long now) {
  unsigned long elapsed = now - stateStartTime;

  switch (currentState) {
    case STATE_BOOT:
      animBoot(elapsed);
      if (elapsed >= 3000) setState(STATE_IDLE);
      break;

    case STATE_IDLE:
      animRadarSweep();
      break;

    case STATE_SCANNING:
      animScanning();
      break;

    case STATE_AUTHORIZED:
      showCheckmark();
      if (elapsed >= 2000) setState(STATE_IDLE);
      break;

    case STATE_DENIED:
      showDenied();
      if (elapsed >= 2000) setState(STATE_IDLE);
      break;

    case STATE_ALERT:
      animAlert();
      if (elapsed >= 4000) setState(STATE_IDLE);
      break;

    case STATE_LOCK:
      showLockIcon();
      break;
  }
}

// ─── BOOT: Letter "D" slides in then morphs to lock ─────────
void animBoot(unsigned long elapsed) {
  if (elapsed < 1500) {
    // Show "D" letter
    byte letterD[8] = {
      B11111100,
      B11000110,
      B11000011,
      B11000011,
      B11000011,
      B11000011,
      B11000110,
      B11111100
    };
    for (int r = 0; r < 8; r++) matrix.setRow(0, r, letterD[r]);
  } else {
    // Morph to lock icon
    showLockIcon();
  }
}

// ─── IDLE: Vertical line sweeps back and forth ──────────────
void animRadarSweep() {
  static unsigned long lastUpdate = 0;
  unsigned long now = millis();
  if (now - lastUpdate < 80) return;
  lastUpdate = now;

  matrix.clearDisplay(0);
  // Draw vertical line at current position
  for (int row = 0; row < 8; row++) {
    matrix.setLed(0, row, animPos, true);
  }
  // Bounce
  if (animDirection) {
    animPos++;
    if (animPos >= 7) animDirection = false;
  } else {
    animPos--;
    if (animPos <= 0) animDirection = true;
  }
}

// ─── SCANNING: Horizontal line sweeps top to bottom ─────────
void animScanning() {
  static unsigned long lastUpdate = 0;
  static int scanRow = 0;
  unsigned long now = millis();
  if (now - lastUpdate < 100) return;
  lastUpdate = now;

  matrix.clearDisplay(0);
  matrix.setRow(0, scanRow, B11111111);
  scanRow = (scanRow + 1) % 8;
}

// ─── AUTHORIZED: Checkmark ──────────────────────────────────
void showCheckmark() {
  byte icon[8] = {
    B00000000,
    B00000001,
    B00000011,
    B10000110,
    B11001100,
    B01111000,
    B00110000,
    B00000000
  };
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, icon[r]);
}

// ─── DENIED: X mark ────────────────────────────────────────
void showDenied() {
  byte icon[8] = {
    B10000001,
    B01000010,
    B00100100,
    B00011000,
    B00011000,
    B00100100,
    B01000010,
    B10000001
  };
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, icon[r]);
}

// ─── ALERT: Flash all LEDs ──────────────────────────────────
void animAlert() {
  static unsigned long lastFlash = 0;
  static bool flashState = false;
  unsigned long now = millis();
  if (now - lastFlash < 200) return;
  lastFlash = now;
  flashState = !flashState;

  if (flashState) {
    for (int r = 0; r < 8; r++) matrix.setRow(0, r, B11111111);
  } else {
    matrix.clearDisplay(0);
  }
}

// ─── LOCK: Padlock icon ─────────────────────────────────────
void showLockIcon() {
  byte icon[8] = {
    B00111100,
    B01000010,
    B01000010,
    B11111111,
    B10111101,
    B10111101,
    B11111111,
    B00000000
  };
  for (int r = 0; r < 8; r++) matrix.setRow(0, r, icon[r]);
}
