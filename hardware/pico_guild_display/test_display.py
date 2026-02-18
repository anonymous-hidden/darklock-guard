#!/usr/bin/env python3
"""
Quick test script for Pico Guild Display
Sends test counts to verify display is working
"""

import serial
import time
import sys

PICO_PORT = "/dev/ttyACM0"
BAUD_RATE = 115200

def main():
    print("=" * 50)
    print("Pico Guild Display Test")
    print("=" * 50)
    print()
    
    try:
        print(f"Connecting to Pico at {PICO_PORT}...")
        ser = serial.Serial(PICO_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)  # Wait for Pico to boot
        print("✓ Connected!")
        print()
        
        # Test 1: Ping
        print("[Test 1] Sending PING...")
        ser.write(b"PING\n")
        ser.flush()
        time.sleep(0.5)
        while ser.in_waiting:
            response = ser.readline().decode('utf-8', errors='ignore').strip()
            print(f"  Response: {response}")
        print()
        
        # Test 2: Count sequence
        print("[Test 2] Testing count sequence...")
        counts = [0, 1, 42, 123, 999, 1234, 5678, 9999, 0]
        
        for count in counts:
            print(f"  Displaying: {count}")
            ser.write(f"COUNT:{count}\n".encode())
            ser.flush()
            time.sleep(2)
            
            # Read any responses
            while ser.in_waiting:
                response = ser.readline().decode('utf-8', errors='ignore').strip()
                if response:
                    print(f"    Pico: {response}")
        
        print()
        print("[Test 3] Rapid update test...")
        for i in range(10):
            ser.write(f"COUNT:{i * 100}\n".encode())
            ser.flush()
            time.sleep(0.5)
        
        print()
        print("=" * 50)
        print("Tests complete!")
        print()
        print("If all numbers displayed correctly, your setup is working!")
        print("If not, check:")
        print("  - All wiring connections")
        print("  - Resistor values (220Ω)")
        print("  - Segment pin assignments")
        print("=" * 50)
        
        ser.close()
        
    except serial.SerialException as e:
        print(f"✗ Error: {e}")
        print()
        print("Troubleshooting:")
        print(f"  - Is the Pico connected?")
        print(f"  - Try: ls /dev/ttyACM* /dev/ttyUSB*")
        print(f"  - Add user to dialout: sudo usermod -a -G dialout $USER")
        sys.exit(1)
    
    except KeyboardInterrupt:
        print("\nTest interrupted")
        if 'ser' in locals() and ser.is_open:
            ser.close()
        sys.exit(0)

if __name__ == "__main__":
    main()
