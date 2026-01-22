# Hardware Key Visual Indicator
# Upload this to your Raspberry Pi Pico using Thonny IDE
# The LED will blink to show this is your hardware key

from machine import Pin
import time

# Onboard LED on GPIO 25
led = Pin(25, Pin.OUT)

print("Hardware Key Active - Blinking LED")

while True:
    led.on()      # LED on
    time.sleep(0.5)  # Wait 500ms
    led.off()     # LED off
    time.sleep(0.5)  # Wait 500ms
