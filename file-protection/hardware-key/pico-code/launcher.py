# Raspberry Pi Pico Hardware Launcher
# Single press: Launch bot in terminal
# Double press: Restart bot

import time
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS
from adafruit_hid.keycode import Keycode
from machine import Pin

# Configuration
LED_PIN = 25
BOOTSEL_PIN = 22
DOUBLE_PRESS_WINDOW = 0.8  # Seconds to detect double-press

# Initialize
led = Pin(LED_PIN, Pin.OUT)
bootsel = Pin(BOOTSEL_PIN, Pin.IN)
kbd = Keyboard(usb_hid.devices)
layout = KeyboardLayoutUS(kbd)

# Button state
last_press_time = 0
press_count = 0
button_was_pressed = False

def blink_led(times, delay=0.1):
    """Blink LED pattern"""
    for _ in range(times):
        led.on()
        time.sleep(delay)
        led.off()
        time.sleep(delay)

def open_terminal_and_run():
    """Open PowerShell and run bot"""
    print("🚀 Opening terminal and launching bot...")
    
    # Open PowerShell (Win+X, then I)
    kbd.press(Keycode.GUI, Keycode.X)
    time.sleep(0.1)
    kbd.release_all()
    time.sleep(0.3)
    kbd.press(Keycode.I)
    kbd.release_all()
    time.sleep(1)  # Wait for terminal to open
    
    # Type commands
    layout.write('cd "e:\\discord bot"\n')
    time.sleep(0.3)
    layout.write('npm start\n')
    
    blink_led(3, 0.1)
    print("✅ Bot launch command sent")

def restart_bot():
    """Restart bot (Ctrl+C then restart)"""
    print("🔄 Restarting bot...")
    
    # Stop current process
    kbd.press(Keycode.CONTROL, Keycode.C)
    time.sleep(0.1)
    kbd.release_all()
    time.sleep(0.5)
    
    # Clear line and restart
    layout.write('npm start\n')
    
    blink_led(5, 0.1)
    print("✅ Bot restart command sent")

def check_button():
    """Check for button presses and handle single/double press"""
    global last_press_time, press_count, button_was_pressed
    
    button_pressed = bootsel.value() == 1
    current_time = time.time()
    
    # Detect button press (rising edge)
    if button_pressed and not button_was_pressed:
        button_was_pressed = True
        
        # Check if within double-press window
        if current_time - last_press_time < DOUBLE_PRESS_WINDOW:
            press_count = 2
        else:
            press_count = 1
        
        last_press_time = current_time
        led.on()
    
    # Detect button release
    elif not button_pressed and button_was_pressed:
        button_was_pressed = False
        led.off()
    
    # Execute action after window expires
    if press_count > 0 and current_time - last_press_time > DOUBLE_PRESS_WINDOW:
        if press_count == 1:
            open_terminal_and_run()
        elif press_count >= 2:
            restart_bot()
        
        press_count = 0

print("=" * 50)
print("🎮 Hardware Launcher Active")
print("🔘 Button: BOOTSEL (built-in)")
print("")
print("Button Controls:")
print("  Single press:  Launch bot")
print("  Double press:  Restart bot")
print("=" * 50)

# Startup blink
blink_led(3, 0.1)

# Main loop
while True:
    try:
        check_button()
        
        # Heartbeat blink (slow)
        if int(time.time() * 0.5) % 2 == 0:
            led.on()
        else:
            led.off()
        
        time.sleep(0.05)
        
    except KeyboardInterrupt:
        print("\n👋 Launcher stopped")
        led.off()
        break
    except Exception as e:
        print(f"❌ Error: {e}")
        time.sleep(1)
