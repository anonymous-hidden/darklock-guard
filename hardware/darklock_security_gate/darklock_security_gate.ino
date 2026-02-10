/*
 * ═══════════════════════════════════════════════════════════════
 *  DARKLOCK SECURITY GATE — ELEGOO Mega 2560
 *  Display & Sensor Module (NO SECURITY DECISIONS)
 * ═══════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Dumb terminal. Shows status on LCD, drives two RGB LEDs,
 *   reads IR remote & PIR sensor, relays everything to the
 *   Raspberry Pi 5 over USB serial.
 *   ALL security logic lives on the Pi.
 *
 * HARDWARE MAP:
 *   LCD 16×2 (4-bit):  RS=A0  E=A1  D4=A2  D5=A3  D6=A4  D7=D30
 *   RGB LED 1 (Bot):   R=D22  G=D24  B=D26
 *   RGB LED 2 (RFID):  R=D23  G=D25  B=D27
 *   IR Receiver:       D31
 *   PIR Motion:        D35
 *
 * SERIAL PROTOCOL (115200 baud, newline-delimited):
 *   Pi → Arduino (commands):
 *     LCD:line1|line2         Update LCD display
 *     LED1:r,g,b             Set bot-status LED (0-255)
 *     LED2:r,g,b             Set RFID-status LED (0-255)
 *     PING                   Heartbeat check
 *
 *   Arduino → Pi (events):
 *     READY                  Boot complete
 *     IR:HEXCODE             IR button pressed
 *     PIR:1 / PIR:0          Motion detected / cleared
 *     PONG                   Heartbeat reply
 *     ACK:cmd                Command acknowledged
 *
 * LED MEANINGS:
 *   LED1 (Bot Status):
 *     Red       = Bot is DOWN / offline
 *     Blue      = Bot restarting / starting up
 *     Green     = Bot running normally
 *     Off       = Unknown / no data from Pi
 *
 *   LED2 (RFID / Security):
 *     Red       = Access denied / card invalid
 *     Green     = Access granted / card valid
 *     Blue      = Waiting for card scan
 *     Purple    = System error
 *     Off       = Idle / no scan in progress
 */

#include <LiquidCrystal.h>
#include <IRremote.h>
#include <SPI.h>
#include <MFRC522.h>

// ─── PIN DEFINITIONS ───────────────────────────────────────────
// LCD (4-bit mode)
#define LCD_RS  A0
#define LCD_E   A1
#define LCD_D4  A2
#define LCD_D5  A3
#define LCD_D6  A4
#define LCD_D7  30

// RGB LED 1 — Bot Status
#define LED1_R  22
#define LED1_G  24
#define LED1_B  26

// RGB LED 2 — RFID / Security
#define LED2_R  23
#define LED2_G  25
#define LED2_B  27

// IR Receiver
#define IR_PIN  31

// PIR Motion Sensor
#define PIR_PIN 35

// RC522 RFID
#define RFID_SS  53
#define RFID_RST 34

// ─── CONSTANTS ──────────────────────────────────────────────────
#define SERIAL_BAUD     115200
#define LCD_COLS        16
#define LCD_ROWS        2
#define PIR_COOLDOWN_MS 2000   // Min time between PIR events
#define NO_SIGNAL_MS    30000  // "No Signal" after 30s silence
#define HEARTBEAT_MS    10000  // Heartbeat every 10s
#define RFID_SCAN_TIMEOUT 15000 // RFID scan timeout

// ─── OBJECTS ────────────────────────────────────────────────────
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);
MFRC522 rfid(RFID_SS, RFID_RST);

// ─── STATE ──────────────────────────────────────────────────────
unsigned long lastPiMessage   = 0;
unsigned long lastPIRTrigger  = 0;
unsigned long lastHeartbeat   = 0;
bool          pirLastState    = false;
bool          noSignalShown   = false;
String        currentLine1    = "";
String        currentLine2    = "";

// ─── SETUP ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(100);

  // LCD init
  lcd.begin(LCD_COLS, LCD_ROWS);
  lcd.clear();
  showLCD("DARKLOCK v2.0", "Booting...");

  // RGB LED pins
  pinMode(LED1_R, OUTPUT);
  pinMode(LED1_G, OUTPUT);
  pinMode(LED1_B, OUTPUT);
  pinMode(LED2_R, OUTPUT);
  pinMode(LED2_G, OUTPUT);
  pinMode(LED2_B, OUTPUT);

  // PIR
  pinMode(PIR_PIN, INPUT);

  // IR Receiver
  IrReceiver.begin(IR_PIN, DISABLE_LED_FEEDBACK);

  // RFID init
  SPI.begin();
  rfid.PCD_Init();
  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  if (version == 0x00 || version == 0xFF) {
    showLCD("RFID ERROR", "Check wiring");
    setLED2(128, 0, 128); // Purple = error
    delay(2000);
  }

  // LED self-test: R → G → B on both LEDs
  ledSelfTest();

  // Boot idle state
  showLCD("DARKLOCK v2.0", "Waiting for Pi..");
  setLED1(0, 0, 0);
  setLED2(0, 0, 0);

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

  // 2) IR Remote
  if (IrReceiver.decode()) {
    uint32_t code = IrReceiver.decodedIRData.decodedRawData;
    if (code != 0) {
      Serial.print("IR:");
      Serial.println(code, HEX);
    }
    IrReceiver.resume();
  }

  // 3) PIR Motion
  bool pirNow = digitalRead(PIR_PIN);
  if (pirNow != pirLastState && (now - lastPIRTrigger > PIR_COOLDOWN_MS)) {
    pirLastState = pirNow;
    lastPIRTrigger = now;
    Serial.print("PIR:");
    Serial.println(pirNow ? "1" : "0");
  }

  // 4) No-signal watchdog
  if (!noSignalShown && (now - lastPiMessage > NO_SIGNAL_MS)) {
    showLCD("NO SIGNAL", "Pi disconnected");
    setLED1(255, 0, 0);
    setLED2(255, 0, 255);
    noSignalShown = true;
  }

  // 5) Periodic heartbeat
  if (now - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = now;
    Serial.println("PONG");
  }

  delay(10);
}

// ─── COMMAND PROCESSOR ──────────────────────────────────────────
void processCommand(String cmd) {
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
  else if (cmd.startsWith("LED1:")) {
    parseLED(cmd.substring(5), LED1_R, LED1_G, LED1_B);
    Serial.println("ACK:LED1");
  }
  else if (cmd.startsWith("LED2:")) {
    parseLED(cmd.substring(5), LED2_R, LED2_G, LED2_B);
    Serial.println("ACK:LED2");
  }
  else if (cmd == "PING") {
    Serial.println("PONG");
  }
  else if (cmd == "SCAN_RFID") {
    scanRFID();
  }
}

// ─── RFID SCAN ──────────────────────────────────────────────────
void scanRFID() {
  setLED2(0, 0, 255); // Blue = scanning
  showLCD("RFID SCAN", "Present card...");
  
  unsigned long start = millis();
  while (millis() - start < RFID_SCAN_TIMEOUT) {
    // Check for card presence
    if (!rfid.PICC_IsNewCardPresent()) {
      delay(100);
      continue;
    }
    
    // Try to read card
    if (!rfid.PICC_ReadCardSerial()) {
      delay(100);
      continue;
    }
    
    // Card read successfully - build UID as decimal
    unsigned long uid = 0;
    for (byte i = 0; i < rfid.uid.size && i < 4; i++) {
      uid = (uid << 8) | rfid.uid.uidByte[i];
    }
    
    // Send to Pi
    Serial.print("RFID:");
    Serial.println(uid);
    
    // Visual feedback
    setLED2(0, 255, 0); // Green flash
    showLCD("CARD SCANNED", String(uid));
    delay(500);
    
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }
  
  // Timeout - no card found
  Serial.println("RFID:TIMEOUT");
  setLED2(255, 0, 0); // Red = timeout
  showLCD("RFID TIMEOUT", "No card found");
  delay(1000);
  setLED2(0, 0, 0);
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
void parseLED(String csv, int pinR, int pinG, int pinB) {
  int c1 = csv.indexOf(',');
  int c2 = csv.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return;

  int r = constrain(csv.substring(0, c1).toInt(),   0, 255);
  int g = constrain(csv.substring(c1+1, c2).toInt(), 0, 255);
  int b = constrain(csv.substring(c2+1).toInt(),     0, 255);

  // Digital-only pins: threshold at 128
  digitalWrite(pinR, r > 127 ? HIGH : LOW);
  digitalWrite(pinG, g > 127 ? HIGH : LOW);
  digitalWrite(pinB, b > 127 ? HIGH : LOW);
}

void setLED1(int r, int g, int b) {
  digitalWrite(LED1_R, r > 127 ? HIGH : LOW);
  digitalWrite(LED1_G, g > 127 ? HIGH : LOW);
  digitalWrite(LED1_B, b > 127 ? HIGH : LOW);
}

void setLED2(int r, int g, int b) {
  digitalWrite(LED2_R, r > 127 ? HIGH : LOW);
  digitalWrite(LED2_G, g > 127 ? HIGH : LOW);
  digitalWrite(LED2_B, b > 127 ? HIGH : LOW);
}

// ─── LED SELF-TEST ──────────────────────────────────────────────
void ledSelfTest() {
  setLED1(255, 0, 0); setLED2(255, 0, 0); delay(250);
  setLED1(0, 255, 0); setLED2(0, 255, 0); delay(250);
  setLED1(0, 0, 255); setLED2(0, 0, 255); delay(250);
  setLED1(0, 0, 0);   setLED2(0, 0, 0);   delay(200);
}
