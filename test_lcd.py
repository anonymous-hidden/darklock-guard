#!/usr/bin/env python3
"""
LCD Screen Test - Monitor Arduino diagnostic output
"""

import serial
import time
import sys

def test_lcd():
    try:
        print("Connecting to Arduino on /dev/ttyACM0...")
        ser = serial.Serial('/dev/ttyACM0', 115200, timeout=2)
        time.sleep(2)  # Wait for Arduino to reset
        
        print("\n" + "="*50)
        print("LCD TEST - Reading Arduino diagnostic output")
        print("="*50 + "\n")
        
        print("Looking for LCD test messages...\n")
        
        start_time = time.time()
        lcd_found = False
        
        while time.time() - start_time < 10:  # Monitor for 10 seconds
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    print(line)
                    if "LCD" in line or "lcd" in line:
                        lcd_found = True
        
        print("\n" + "="*50)
        if lcd_found:
            print("✓ LCD test messages detected!")
            print("\nCheck your LCD display. It should show:")
            print("  Line 1: DARKLOCK v1.0")
            print("  Line 2: Ready / Scan card...")
        else:
            print("⚠ No LCD messages detected in output")
            print("The Arduino might need to be reprogrammed.")
        print("="*50 + "\n")
        
        ser.close()
        
    except serial.SerialException as e:
        print(f"Error: Could not connect to Arduino: {e}")
        print("\nTroubleshooting:")
        print("  1. Check USB connection")
        print("  2. Verify permissions: sudo chmod 666 /dev/ttyACM0")
        print("  3. Ensure no other program is using the port")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        ser.close()
        sys.exit(0)

if __name__ == "__main__":
    test_lcd()
