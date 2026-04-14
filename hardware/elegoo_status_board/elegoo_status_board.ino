/*
 * ═══════════════════════════════════════════════════════════════
 *  DARKLOCK STATUS BOARD — Elegoo Mega 2560
 *  7-Segment Guild Count + LCD Info + 3-Group Status LEDs
 * ═══════════════════════════════════════════════════════════════
 *
 * ─── PIN MAP ──────────────────────────────────────────────────
 *
 *   4-Digit 7-Segment Display (guild count):
 *     D52 = D1 (digit 1, leftmost)
 *     D51 = D2
 *     D49 = D3
 *     D43 = D4 (digit 4, rightmost)
 *     D45 = A   D53 = B   D48 = C   D44 = D
 *     D42 = E   D47 = F   D50 = G   D46 = DP
 *
 *   LCD 16×2 (4-bit mode):
 *     A7 = RS   A8 = E   A9 = DB4   A10 = DB5
 *     A11 = DB6   A12 = DB7
 *
 *   LED Group 1 — Darklock Server Status:
 *     D23 = Green   D25 = Blue   D27 = Yellow   D29 = Red
 *
 *   LED Group 2 — Jarvis Status:
 *     D22 = Green   D24 = Blue   D26 = Yellow   D28 = Red
 *
 *   LED Group 3 — Pi5 Status:
 *     D31 = Green   D33 = Blue   D35 = Yellow   D37 = Red
 *
 * ─── SERIAL PROTOCOL (115200 baud, newline-delimited) ─────────
 *
 *   Pi → Elegoo:
 *     COUNT:1234          Set 7-segment display (0-9999)
 *     LCD:line1|line2     Update LCD
 *     DARKLOCK:GREEN/BLUE/YELLOW/RED/OFF   LED group 1
 *     JARVIS:GREEN/BLUE/YELLOW/RED/OFF     LED group 2
 *     PI5:GREEN/BLUE/YELLOW/RED/OFF        LED group 3
 *     PING                Heartbeat
 *     CLEAR               Clear LCD
 *
 *   Elegoo → Pi:
 *     READY               Boot complete
 *     PONG                Heartbeat reply
 *     ACK:cmd             Command acknowledged
 */

// ─── 7-SEGMENT PINS ────────────────────────────────────────────
// Segments
#define SEG_A   45
#define SEG_B   53
#define SEG_C   48
#define SEG_D   44
#define SEG_E   42
#define SEG_F   47
#define SEG_G   50
#define SEG_DP  46

// Digits (common cathode: LOW = active)
#define DIG_1   52   // leftmost
#define DIG_2   51
#define DIG_3   49
#define DIG_4   43   // rightmost

const int segPins[] = {SEG_A, SEG_B, SEG_C, SEG_D, SEG_E, SEG_F, SEG_G};
const int digPins[] = {DIG_1, DIG_2, DIG_3, DIG_4};

// Segment patterns for digits 0-9 (A,B,C,D,E,F,G)
//                               A  B  C  D  E  F  G
const bool digits[10][7] = {
  {1, 1, 1, 1, 1, 1, 0},  // 0
  {0, 1, 1, 0, 0, 0, 0},  // 1
  {1, 1, 0, 1, 1, 0, 1},  // 2
  {1, 1, 1, 1, 0, 0, 1},  // 3
  {0, 1, 1, 0, 0, 1, 1},  // 4
  {1, 0, 1, 1, 0, 1, 1},  // 5
  {1, 0, 1, 1, 1, 1, 1},  // 6
  {1, 1, 1, 0, 0, 0, 0},  // 7
  {1, 1, 1, 1, 1, 1, 1},  // 8
  {1, 1, 1, 1, 0, 1, 1},  // 9
};

// ─── LED GROUP 1: DARKLOCK ─────────────────────────────────────
#define DL_GREEN   23
#define DL_BLUE    25
#define DL_YELLOW  27
#define DL_RED     29

// ─── LED GROUP 2: JARVIS ───────────────────────────────────────
#define JV_GREEN   22
#define JV_BLUE    24
#define JV_YELLOW  26
#define JV_RED     28

// ─── LED GROUP 3: PI5 ──────────────────────────────────────────
#define PI_GREEN   31
#define PI_BLUE    33
#define PI_YELLOW  35
#define PI_RED     37

// ─── CONSTANTS ──────────────────────────────────────────────────
#define SERIAL_BAUD     115200
#define NO_SIGNAL_MS    30000
#define HEARTBEAT_MS    10000
#define MUX_DELAY_US    2500   // 2.5ms per digit = ~100 Hz refresh

// ─── STATE ──────────────────────────────────────────────────────
int displayValue = 0;          // 0-9999 for 7-segment
bool displayOn = true;
unsigned long lastPiMsg = 0;
unsigned long lastHeart = 0;
bool noSignal = false;

// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(100);

  // 7-segment pins
  for (int i = 0; i < 7; i++) {
    pinMode(segPins[i], OUTPUT);
    digitalWrite(segPins[i], LOW);
  }
  pinMode(SEG_DP, OUTPUT);
  digitalWrite(SEG_DP, LOW);

  for (int i = 0; i < 4; i++) {
    pinMode(digPins[i], OUTPUT);
    digitalWrite(digPins[i], HIGH);  // OFF (common cathode: HIGH = off)
  }

  // LED Group 1 — Darklock
  pinMode(DL_GREEN, OUTPUT); pinMode(DL_BLUE, OUTPUT);
  pinMode(DL_YELLOW, OUTPUT); pinMode(DL_RED, OUTPUT);

  // LED Group 2 — Jarvis
  pinMode(JV_GREEN, OUTPUT); pinMode(JV_BLUE, OUTPUT);
  pinMode(JV_YELLOW, OUTPUT); pinMode(JV_RED, OUTPUT);

  // LED Group 3 — Pi5
  pinMode(PI_GREEN, OUTPUT); pinMode(PI_BLUE, OUTPUT);
  pinMode(PI_YELLOW, OUTPUT); pinMode(PI_RED, OUTPUT);

  // Self-test: flash all LEDs
  ledSelfTest();

  // Ready
  allLEDsOff();

  delay(500);
  Serial.println("READY");
  lastPiMsg = millis();
}

// ─── MAIN LOOP ──────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1) Process serial commands
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      processCommand(cmd);
      lastPiMsg = now;
      noSignal = false;
    }
  }

  // 2) No-signal watchdog
  if (!noSignal && (now - lastPiMsg > NO_SIGNAL_MS)) {
    setLEDGroup(DL_GREEN, DL_BLUE, DL_YELLOW, DL_RED, 'R');
    setLEDGroup(JV_GREEN, JV_BLUE, JV_YELLOW, JV_RED, 'R');
    setLEDGroup(PI_GREEN, PI_BLUE, PI_YELLOW, PI_RED, 'R');
    noSignal = true;
  }

  // 3) Heartbeat
  if (now - lastHeart > HEARTBEAT_MS) {
    lastHeart = now;
    Serial.println("PONG");
  }

  // 4) Multiplex 7-segment display
  if (displayOn) {
    refreshDisplay();
  }
}

// ─── COMMAND PROCESSOR ──────────────────────────────────────────
void processCommand(String cmd) {
  // 7-segment count
  if (cmd.startsWith("COUNT:")) {
    int val = cmd.substring(6).toInt();
    if (val >= 0 && val <= 9999) {
      displayValue = val;
      displayOn = true;
    }
    Serial.println("ACK:COUNT");
  }
  // LCD (disabled — hardware broken)
  else if (cmd.startsWith("LCD:")) {
    Serial.println("ACK:LCD");
  }
  // Darklock LED group
  else if (cmd.startsWith("DARKLOCK:")) {
    char color = parseColor(cmd.substring(9));
    setLEDGroup(DL_GREEN, DL_BLUE, DL_YELLOW, DL_RED, color);
    Serial.println("ACK:DARKLOCK");
  }
  // Jarvis LED group
  else if (cmd.startsWith("JARVIS:")) {
    char color = parseColor(cmd.substring(7));
    setLEDGroup(JV_GREEN, JV_BLUE, JV_YELLOW, JV_RED, color);
    Serial.println("ACK:JARVIS");
  }
  // Pi5 LED group
  else if (cmd.startsWith("PI5:")) {
    char color = parseColor(cmd.substring(4));
    setLEDGroup(PI_GREEN, PI_BLUE, PI_YELLOW, PI_RED, color);
    Serial.println("ACK:PI5");
  }
  // Heartbeat
  else if (cmd == "PING") {
    Serial.println("PONG");
  }
  // Clear LCD (disabled — hardware broken)
  else if (cmd == "CLEAR") {
    Serial.println("ACK:CLEAR");
  }
  // Display off
  else if (cmd == "DISPLAY:OFF") {
    displayOn = false;
    allDigitsOff();
    Serial.println("ACK:DISPLAY");
  }
  else if (cmd == "DISPLAY:ON") {
    displayOn = true;
    Serial.println("ACK:DISPLAY");
  }
  else {
    Serial.print("UNKNOWN:");
    Serial.println(cmd);
  }
}

// ─── 7-SEGMENT HELPERS ─────────────────────────────────────────
void refreshDisplay() {
  int val = displayValue;
  int d[4];
  d[3] = val % 10; val /= 10;
  d[2] = val % 10; val /= 10;
  d[1] = val % 10; val /= 10;
  d[0] = val % 10;

  // Determine leading zeros suppression
  bool leadingZero = true;

  for (int i = 0; i < 4; i++) {
    // Suppress leading zeros (except last digit)
    if (leadingZero && d[i] == 0 && i < 3) {
      // Turn off this digit entirely
      digitalWrite(digPins[i], HIGH);
      continue;
    }
    leadingZero = false;

    // Set segments for this digit
    for (int s = 0; s < 7; s++) {
      digitalWrite(segPins[s], digits[d[i]][s] ? HIGH : LOW);
    }
    digitalWrite(SEG_DP, LOW);  // DP off

    // Activate this digit (common cathode: LOW = on)
    digitalWrite(digPins[i], LOW);
    delayMicroseconds(MUX_DELAY_US);
    digitalWrite(digPins[i], HIGH);
  }
}

void allDigitsOff() {
  for (int i = 0; i < 4; i++) {
    digitalWrite(digPins[i], HIGH);
  }
  for (int i = 0; i < 7; i++) {
    digitalWrite(segPins[i], LOW);
  }
  digitalWrite(SEG_DP, LOW);
}

// ─── LED HELPERS ────────────────────────────────────────────────
char parseColor(String color) {
  color.trim();
  color.toUpperCase();
  if (color == "GREEN")  return 'G';
  if (color == "BLUE")   return 'B';
  if (color == "YELLOW") return 'Y';
  if (color == "RED")    return 'R';
  if (color == "OFF")    return 'O';
  return 'O';
}

void setLEDGroup(int pinG, int pinB, int pinY, int pinR, char color) {
  digitalWrite(pinG, color == 'G' ? HIGH : LOW);
  digitalWrite(pinB, color == 'B' ? HIGH : LOW);
  digitalWrite(pinY, color == 'Y' ? HIGH : LOW);
  digitalWrite(pinR, color == 'R' ? HIGH : LOW);
}

void allLEDsOff() {
  setLEDGroup(DL_GREEN, DL_BLUE, DL_YELLOW, DL_RED, 'O');
  setLEDGroup(JV_GREEN, JV_BLUE, JV_YELLOW, JV_RED, 'O');
  setLEDGroup(PI_GREEN, PI_BLUE, PI_YELLOW, PI_RED, 'O');
}

void ledSelfTest() {
  int allPins[] = {
    DL_GREEN, DL_BLUE, DL_YELLOW, DL_RED,
    JV_GREEN, JV_BLUE, JV_YELLOW, JV_RED,
    PI_GREEN, PI_BLUE, PI_YELLOW, PI_RED
  };

  // Flash each LED briefly
  for (int i = 0; i < 12; i++) {
    digitalWrite(allPins[i], HIGH);
    delay(80);
    digitalWrite(allPins[i], LOW);
  }

  // Flash all on then off
  for (int i = 0; i < 12; i++) digitalWrite(allPins[i], HIGH);
  delay(300);
  for (int i = 0; i < 12; i++) digitalWrite(allPins[i], LOW);

  // 7-segment test: show 8888
  for (int s = 0; s < 7; s++) digitalWrite(segPins[s], HIGH);
  for (int d = 0; d < 4; d++) {
    digitalWrite(digPins[d], LOW);
    delay(200);
    digitalWrite(digPins[d], HIGH);
  }
  for (int s = 0; s < 7; s++) digitalWrite(segPins[s], LOW);
}
