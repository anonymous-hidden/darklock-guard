#!/usr/bin/env python3
"""
RGB LED Server Status Monitor
Controls RGB LED on GPIO pins 17 (Red), 27 (Green), 22 (Blue)
Shows server status: Green=Live, Blue=Restarting, Red=Down
"""

import RPi.GPIO as GPIO
import time
import requests
import subprocess
from enum import Enum

# GPIO pin definitions
RED_PIN = 17
GREEN_PIN = 27
BLUE_PIN = 22

# Server status enum
class ServerStatus(Enum):
    LIVE = "live"          # Green
    RESTARTING = "restarting"  # Blue
    DOWN = "down"          # Red

class RGBLEDStatusMonitor:
    def __init__(self, red_pin=RED_PIN, green_pin=GREEN_PIN, blue_pin=BLUE_PIN):
        self.red_pin = red_pin
        self.green_pin = green_pin
        self.blue_pin = blue_pin
        
        # Setup GPIO
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup([self.red_pin, self.green_pin, self.blue_pin], GPIO.OUT)
        
        # Setup PWM for brightness control (optional)
        self.red_pwm = GPIO.PWM(self.red_pin, 1000)
        self.green_pwm = GPIO.PWM(self.green_pin, 1000)
        self.blue_pwm = GPIO.PWM(self.blue_pin, 1000)
        
        self.red_pwm.start(0)
        self.green_pwm.start(0)
        self.blue_pwm.start(0)
        
        self.current_status = None
    
    def set_color(self, red, green, blue):
        """Set LED color using PWM (0-100 for brightness)"""
        self.red_pwm.ChangeDutyCycle(red)
        self.green_pwm.ChangeDutyCycle(green)
        self.blue_pwm.ChangeDutyCycle(blue)
    
    def green(self):
        """Set LED to green (server live)"""
        self.set_color(0, 100, 0)
        self.current_status = ServerStatus.LIVE
    
    def blue(self):
        """Set LED to blue (server restarting)"""
        self.set_color(0, 0, 100)
        self.current_status = ServerStatus.RESTARTING
    
    def red(self):
        """Set LED to red (server down)"""
        self.set_color(100, 0, 0)
        self.current_status = ServerStatus.DOWN
    
    def off(self):
        """Turn off LED"""
        self.set_color(0, 0, 0)
    
    def blink(self, color_func, times=3, duration=0.5):
        """Blink LED with specified color"""
        for _ in range(times):
            color_func()
            time.sleep(duration)
            self.off()
            time.sleep(duration)
        color_func()
    
    def check_server_http(self, url, timeout=5):
        """Check if server is responding via HTTP"""
        try:
            response = requests.get(url, timeout=timeout)
            return response.status_code < 500
        except Exception as e:
            print(f"Error checking server: {e}")
            return False
    
    def check_discord_bot(self, bot_process_name="bot"):
        """Check if Discord bot process is running"""
        try:
            result = subprocess.run(
                ["pgrep", "-f", bot_process_name],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception as e:
            print(f"Error checking bot process: {e}")
            return False
    
    def monitor(self, check_function, interval=10):
        """
        Continuously monitor server status
        
        Args:
            check_function: Function that returns True if server is up, False if down
            interval: Check interval in seconds
        """
        print("Starting RGB LED status monitor...")
        try:
            while True:
                try:
                    if check_function():
                        if self.current_status != ServerStatus.LIVE:
                            print("Status: LIVE (Green)")
                            self.green()
                    else:
                        if self.current_status != ServerStatus.DOWN:
                            print("Status: DOWN (Red)")
                            self.red()
                except Exception as e:
                    print(f"Error during check: {e}")
                    self.red()
                
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\nShutting down...")
            self.off()
            GPIO.cleanup()

def main():
    # Initialize monitor
    monitor = RGBLEDStatusMonitor()
    
    # Option 1: Monitor Discord bot process
    print("Monitoring Discord bot process...")
    monitor.monitor(
        check_function=lambda: monitor.check_discord_bot("node"),
        interval=10
    )
    
    # Option 2: Monitor HTTP server
    # monitor.monitor(
    #     check_function=lambda: monitor.check_server_http("http://localhost:3000"),
    #     interval=10
    # )

if __name__ == "__main__":
    main()
