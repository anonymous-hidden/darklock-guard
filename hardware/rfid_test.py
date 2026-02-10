#!/usr/bin/env python3
from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO

reader = SimpleMFRC522()

try:
    print("Waiting for card...")
    id, text = reader.read()
    print(f"UID: {id}")
finally:
    GPIO.cleanup()
