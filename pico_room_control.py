"""
DarkLock — Pico Room Control Firmware (MicroPython)
====================================================
Flash as main.py onto the Pico (Pico 2 W in this rig).

This firmware is for the room control panel exposed via the hidden
darklock.net page. It handles:
  - 1x active buzzer (loud "annoying" sound, capped duration)
  - 2x passive buzzers (play melodies via PWM)
  - 4x indicator LEDs (network / activity / state)

Pin map (matches the layout requested for this rig):
    GP21 -> white LED     "networking"   (heartbeat from host bridge)
    GP22 -> green LED     reserved / future use
    GP24 -> blue  LED     active buzzer is sounding
    GP25 -> red   LED     passive buzzer is playing
    GP15 -> active buzzer (digital on/off, max 3000 ms enforced)
    GP14 -> passive buzzer A (PWM tone)
    GP13 -> passive buzzer B (PWM tone)
    GP20 -> DHT11 sensor  (temperature + humidity, 3-pin, data pin)

NOTE: This firmware REPLACES pico_portable_status.py if flashed as main.py.
      The two firmwares share GP13/GP14 and cannot run at the same time.
      On a standard Pico, GP24 and GP25 are NOT broken out to the header.
      If you don't see the indicator LEDs you'll need to remap LED_BLUE
      and LED_RED below to header pins (GP14/GP15 are good free options).

Serial commands (newline-terminated, ASCII, 115200 baud):
    PING                       -> PONG
    BEEP:<ms>                  -> active buzzer for <ms> (clamped 50..3000)
    BEEP_STOP                  -> stop active buzzer immediately
    SONG:<name>                -> play named song on passive buzzers
    SONG_STOP                  -> stop song
    LED:<which>:<on|off>       -> override indicator LED (which = NET|GREEN|BLUE|RED)
    NET:OK                     -> host bridge heartbeat (pulses white LED)
    RESET                      -> all outputs off

Songs are non-blocking: each call to the main loop advances the current
song one tone. Sending SONG: while a song is playing replaces it.
"""

import sys
import select
import utime
import micropython
import dht
from machine import Pin, PWM

# Disable keyboard interrupt (Ctrl+C / USB-CDC DTR) so the bridge opening
# the serial port cannot kill the running firmware.
micropython.kbd_intr(-1)

# ---- Pin assignments --------------------------------------------------------
PIN_LED_NET    = 21   # white  - networking heartbeat
PIN_LED_GREEN  = 22   # green  - reserved
PIN_LED_BLUE   = 24   # blue   - active buzzer running
PIN_LED_RED    = 25   # red    - passive song playing

PIN_ACTIVE_BUZZER = 15
PIN_PASSIVE_A     = 14
PIN_PASSIVE_B     = 13
PIN_DHT11         = 20

# ---- Limits -----------------------------------------------------------------
ACTIVE_MAX_MS = 3000   # absolute max for active buzzer
ACTIVE_MIN_MS = 50

# ---- Hardware setup ---------------------------------------------------------
led_net   = Pin(PIN_LED_NET,   Pin.OUT)
led_green = Pin(PIN_LED_GREEN, Pin.OUT)
led_blue  = Pin(PIN_LED_BLUE,  Pin.OUT)
led_red   = Pin(PIN_LED_RED,   Pin.OUT)

active_buzzer = Pin(PIN_ACTIVE_BUZZER, Pin.OUT)
active_buzzer.off()

dht_sensor = dht.DHT11(Pin(PIN_DHT11))

# PWM for passive buzzers - duty 32768 = 50% on RP2040
pwm_a = PWM(Pin(PIN_PASSIVE_A))
pwm_b = PWM(Pin(PIN_PASSIVE_B))
pwm_a.duty_u16(0)
pwm_b.duty_u16(0)

# ---- Song definitions -------------------------------------------------------
# Notes are tuples (freq_a_hz, freq_b_hz, duration_ms).
# Use 0 for silence on a channel. Channel B usually plays a harmony / bass.
NOTE = {
    "C3": 131, "D3": 147, "E3": 165, "F3": 175, "G3": 196, "A3": 220, "B3": 247,
    "C4": 262, "D4": 294, "E4": 330, "F4": 349, "G4": 392, "A4": 440, "B4": 494,
    "C5": 523, "D5": 587, "E5": 659, "F5": 698, "G5": 784, "A5": 880, "B5": 988,
    "C6": 1047, "D6": 1175, "E6": 1319, "REST": 0,
}
N = NOTE  # short alias

def _seq(pairs, beat=180):
    """Build a song from [(noteA, noteB, beats)] using beat ms per beat."""
    out = []
    for a, b, beats in pairs:
        out.append((N[a], N[b], int(beat * beats)))
    return out

SONGS = {
    # 1. quick alert chirp
    "alert": _seq([
        ("C5","C4",1),("REST","REST",1),("C5","C4",1),("REST","REST",1),
        ("E5","E4",2),
    ], beat=120),

    # 2. doorbell ding-dong
    "doorbell": _seq([
        ("E5","C4",3),("C5","G3" if False else "C4",4),
    ], beat=200),

    # 3. mario-ish jingle (parody)
    "jingle": _seq([
        ("E5","C4",1),("E5","C4",1),("REST","REST",1),("E5","C4",1),
        ("REST","REST",1),("C5","C4",1),("E5","E4",2),
        ("G5","G4",3),("REST","REST",3),("G4","C4",2),
    ], beat=140),

    # 4. ascending arpeggio
    "rise": _seq([
        ("C5","C4",1),("E5","E4",1),("G5","G4",1),("C6","C5",2),
    ], beat=130),

    # 5. descending arpeggio
    "fall": _seq([
        ("C6","C5",1),("G5","G4",1),("E5","E4",1),("C5","C4",2),
    ], beat=130),

    # 6. happy birthday (8-bar)
    "birthday": _seq([
        ("C5","C4",1),("C5","C4",1),("D5","D4",2),("C5","C4",2),("F5","F4",2),("E5","E4",4),
        ("C5","C4",1),("C5","C4",1),("D5","D4",2),("C5","C4",2),("G5","G4",2),("F5","F4",4),
    ], beat=180),

    # 7. star wars imperial march (parody, short)
    "march": _seq([
        ("A4","A3",2),("A4","A3",2),("A4","A3",2),("F4","F3",1),("C5","C4",1),
        ("A4","A3",2),("F4","F3",1),("C5","C4",1),("A4","A3",4),
    ], beat=160),

    # 8. tetris theme (parody, opening)
    "tetris": _seq([
        ("E5","E4",2),("B4","B3",1),("C5","C4",1),("D5","D4",2),("C5","C4",1),("B4","B3",1),
        ("A4","A3",2),("A4","A3",1),("C5","C4",1),("E5","E4",2),("D5","D4",1),("C5","C4",1),
        ("B4","B3",3),("C5","C4",1),("D5","D4",2),("E5","E4",2),
    ], beat=130),

    # 9. siren sweep
    "siren": _seq([
        ("C5","REST",1),("D5","REST",1),("E5","REST",1),("F5","REST",1),("G5","REST",1),
        ("F5","REST",1),("E5","REST",1),("D5","REST",1),("C5","REST",1),
    ], beat=110),

    # 10. shave-and-a-haircut
    "shave": _seq([
        ("G4","C4",2),("E4","C4",1),("E4","C4",1),("F4","C4",2),("E4","C4",2),("REST","REST",2),
        ("D4","G3",2),("G4","C4",2),
    ], beat=180),
}

# ---- Runtime state ----------------------------------------------------------
song_queue        = []         # remaining notes
song_note_started = 0          # ticks_ms when current note started
current_note_dur  = 0          # ms

active_until_ms   = 0          # ticks_ms deadline for active buzzer
net_pulse_until   = 0          # ticks_ms deadline for white LED pulse
green_override    = None       # None = follow logic, "ON"/"OFF" forced

stdin_buf = ""

# ---- Helpers ----------------------------------------------------------------
def set_tone(pwm, freq_hz):
    if freq_hz <= 0:
        pwm.duty_u16(0)
    else:
        try:
            pwm.freq(int(freq_hz))
            pwm.duty_u16(20000)   # ~30% duty - audible without being too harsh
        except ValueError:
            pwm.duty_u16(0)

def stop_song():
    global song_queue, current_note_dur
    song_queue = []
    current_note_dur = 0
    set_tone(pwm_a, 0)
    set_tone(pwm_b, 0)
    led_red.off()

def stop_active():
    global active_until_ms
    active_until_ms = 0
    active_buzzer.off()
    led_blue.off()

def all_off():
    stop_song()
    stop_active()
    led_net.off()
    led_green.off()
    led_blue.off()
    led_red.off()

def start_song(name):
    if name not in SONGS:
        sys.stdout.write("ERR:UNKNOWN_SONG:" + name + "\n")
        return
    global song_queue, song_note_started, current_note_dur
    stop_song()
    song_queue = list(SONGS[name])
    if not song_queue:
        return
    fa, fb, dur = song_queue.pop(0)
    set_tone(pwm_a, fa)
    set_tone(pwm_b, fb)
    song_note_started = utime.ticks_ms()
    current_note_dur = dur
    led_red.on()
    sys.stdout.write("ACK:SONG:" + name + "\n")

def advance_song():
    global song_queue, song_note_started, current_note_dur
    if current_note_dur <= 0:
        return
    if utime.ticks_diff(utime.ticks_ms(), song_note_started) < current_note_dur:
        return
    if not song_queue:
        stop_song()
        sys.stdout.write("DONE:SONG\n")
        return
    fa, fb, dur = song_queue.pop(0)
    set_tone(pwm_a, fa)
    set_tone(pwm_b, fb)
    song_note_started = utime.ticks_ms()
    current_note_dur = dur

def start_active(ms):
    global active_until_ms
    ms = max(ACTIVE_MIN_MS, min(ACTIVE_MAX_MS, int(ms)))
    active_buzzer.on()
    led_blue.on()
    active_until_ms = utime.ticks_add(utime.ticks_ms(), ms)
    sys.stdout.write("ACK:BEEP:" + str(ms) + "\n")

def update_active():
    if active_until_ms == 0:
        return
    if utime.ticks_diff(utime.ticks_ms(), active_until_ms) >= 0:
        stop_active()
        sys.stdout.write("DONE:BEEP\n")

def pulse_net(ms=200):
    global net_pulse_until
    led_net.on()
    net_pulse_until = utime.ticks_add(utime.ticks_ms(), ms)

def update_net_pulse():
    global net_pulse_until
    if net_pulse_until == 0:
        return
    if utime.ticks_diff(utime.ticks_ms(), net_pulse_until) >= 0:
        led_net.off()
        net_pulse_until = 0

# ---- Command handler --------------------------------------------------------
def handle_line(line):
    line = line.strip()
    if not line:
        return
    upper = line.upper()

    if upper == "PING":
        sys.stdout.write("PONG\n")
        sys.stdout.write("READY:ROOMCTRL\n")  # re-announce so bridge can set ready flag
        return
    if upper == "REBOOT_TO_REPL":
        # Turn everything off, re-enable Ctrl+C, then raise SystemExit to
        # drop back to the MicroPython REPL without a hard reset.
        # mpremote can then connect and use Ctrl+A (raw REPL) normally.
        all_off()
        sys.stdout.write("ACK:REBOOT_TO_REPL\n")
        micropython.kbd_intr(3)   # re-enable Ctrl+C for mpremote
        utime.sleep_ms(50)        # let ACK flush out the UART
        raise SystemExit(0)       # escapes all try/except Exception wrappers
    if upper == "RESET":
        all_off()
        sys.stdout.write("ACK:RESET\n")
        return
    if upper == "NET:OK":
        pulse_net()
        sys.stdout.write("ACK:NET\n")
        return
    if upper == "BEEP_STOP":
        stop_active()
        sys.stdout.write("ACK:BEEP_STOP\n")
        return
    if upper == "SONG_STOP":
        stop_song()
        sys.stdout.write("ACK:SONG_STOP\n")
        return

    if upper.startswith("BEEP:"):
        try:
            ms = int(line.split(":", 1)[1])
            start_active(ms)
        except (ValueError, IndexError):
            sys.stdout.write("ERR:BAD_BEEP\n")
        return

    if upper.startswith("SONG:"):
        name = line.split(":", 1)[1].strip().lower()
        start_song(name)
        return

    if upper.startswith("LED:"):
        parts = line.split(":")
        if len(parts) != 3:
            sys.stdout.write("ERR:BAD_LED\n")
            return
        which = parts[1].upper()
        state = parts[2].upper()
        target = {
            "NET":   led_net,
            "GREEN": led_green,
            "BLUE":  led_blue,
            "RED":   led_red,
        }.get(which)
        if target is None:
            sys.stdout.write("ERR:BAD_LED_NAME\n")
            return
        if state == "ON":
            target.on()
        elif state == "OFF":
            target.off()
        else:
            sys.stdout.write("ERR:BAD_LED_STATE\n")
            return
        sys.stdout.write("ACK:LED:" + which + ":" + state + "\n")
        return

    if upper == "READ_SENSOR":
        try:
            dht_sensor.measure()
            temp = dht_sensor.temperature()
            humidity = dht_sensor.humidity()
            sys.stdout.write("SENSOR:" + str(temp) + ":" + str(humidity) + "\n")
        except Exception as e:
            sys.stdout.write("ERR:SENSOR:" + str(e) + "\n")
        return

    sys.stdout.write("ERR:UNKNOWN:" + line + "\n")

# ---- Boot self-test ---------------------------------------------------------
def boot_blink():
    for led in (led_net, led_green, led_blue, led_red):
        led.on()
        utime.sleep_ms(80)
        led.off()
    # quick chirp on active buzzer
    active_buzzer.on()
    utime.sleep_ms(60)
    active_buzzer.off()
    # short tone on each passive
    set_tone(pwm_a, NOTE["C5"]); utime.sleep_ms(120); set_tone(pwm_a, 0)
    set_tone(pwm_b, NOTE["E4"]); utime.sleep_ms(120); set_tone(pwm_b, 0)

# ---- Main loop --------------------------------------------------------------
def main():
    sys.stdout.write("READY:ROOMCTRL\n")
    boot_blink()
    global stdin_buf
    while True:
        # Drain serial input
        while True:
            r, _, _ = select.select([sys.stdin], [], [], 0)
            if not r:
                break
            ch = sys.stdin.read(1)
            if ch in ("\n", "\r"):
                if stdin_buf:
                    handle_line(stdin_buf)
                    stdin_buf = ""
            else:
                stdin_buf += ch
                if len(stdin_buf) > 256:
                    stdin_buf = ""   # protect against runaway input

        # Update timers
        update_active()
        update_net_pulse()
        advance_song()

        utime.sleep_ms(10)


# If a REBOOT_TO_REPL flag file was set on the previous run, stay in REPL
# mode so mpremote can connect and upload new firmware.
try:
    import os as _os
    if 'repl_mode' in _os.listdir('/'):
        _os.remove('/repl_mode')
        micropython.kbd_intr(3)   # re-enable Ctrl+C for mpremote
        sys.stdout.write('REPL_READY\n')
        # Fall through — MicroPython will start its REPL prompt
    else:
        # Normal run: restart-on-interrupt loop
        while True:
            try:
                main()
            except KeyboardInterrupt:
                all_off()
            except Exception:
                all_off()
                utime.sleep_ms(500)
except Exception:
    while True:
        try:
            main()
        except KeyboardInterrupt:
            all_off()
        except Exception:
            all_off()
            utime.sleep_ms(500)
