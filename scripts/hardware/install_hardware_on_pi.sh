#!/bin/bash
# Run this script ON THE RASPBERRY PI 5 to pull and install hardware controller

set -e

echo "=== Installing Hardware Controller on Pi5 ==="
echo ""

# Create project directory
echo "[1/5] Creating project directory..."
sudo mkdir -p /home/ubuntu/discord-bot/data
sudo chown -R ubuntu:ubuntu /home/ubuntu/discord-bot

# Download hardware controller from laptop
echo "[2/5] Downloading hardware controller..."
cat > /home/ubuntu/discord-bot/hardware_controller.py << 'EOFPYTHON'
#!/usr/bin/env python3
"""
Hardware Controller for Darklock (Raspberry Pi 5)
- RGB LED status (GPIO17/27/22)
- Clear LED heartbeat (GPIO23)
- Buttons for restart, maintenance toggle, LED test (GPIO5/6/12)
"""

import json
import os
import queue
import signal
import sqlite3
import subprocess
import threading
import time
from datetime import datetime

import RPi.GPIO as GPIO

# GPIO pin definitions (BCM)
RED_PIN = 17
GREEN_PIN = 27
BLUE_PIN = 22
CLEAR_LED_PIN = 23

BUTTON_RESTART_PIN = 5
BUTTON_MAINTENANCE_PIN = 6
BUTTON_TEST_PIN = 12

BOT_SERVICE_NAME = "discord-bot.service"

HEARTBEAT_ON_SECONDS = 1
HEARTBEAT_OFF_SECONDS = 1

STATUS_CHECK_INTERVAL = 1.0
BUTTON_DEBOUNCE_SECONDS = 0.5

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "darklock.db")


class HardwareController:
    def __init__(self):
        self.running = True
        self.heartbeat_enabled = False
        self.override_event = threading.Event()
        self.event_queue = queue.Queue()
        self.led_lock = threading.Lock()
        self.last_button_press = {}
        self.current_rgb = None

        self._setup_gpio()
        self._setup_buttons()

        # Solid ON during boot
        GPIO.output(CLEAR_LED_PIN, GPIO.HIGH)
        self._set_rgb_color("blue")

        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()

    def _setup_gpio(self):
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)

        GPIO.setup([RED_PIN, GREEN_PIN, BLUE_PIN, CLEAR_LED_PIN], GPIO.OUT, initial=GPIO.LOW)
        GPIO.setup(BUTTON_RESTART_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        GPIO.setup(BUTTON_MAINTENANCE_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        GPIO.setup(BUTTON_TEST_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

    def _setup_buttons(self):
        GPIO.add_event_detect(BUTTON_RESTART_PIN, GPIO.FALLING, callback=self._button_callback, bouncetime=200)
        GPIO.add_event_detect(BUTTON_MAINTENANCE_PIN, GPIO.FALLING, callback=self._button_callback, bouncetime=200)
        GPIO.add_event_detect(BUTTON_TEST_PIN, GPIO.FALLING, callback=self._button_callback, bouncetime=200)

    def _button_callback(self, channel):
        now = time.time()
        last = self.last_button_press.get(channel, 0)
        if now - last < BUTTON_DEBOUNCE_SECONDS:
            return
        self.last_button_press[channel] = now

        if channel == BUTTON_RESTART_PIN:
            self.event_queue.put("restart")
        elif channel == BUTTON_MAINTENANCE_PIN:
            self.event_queue.put("toggle_maintenance")
        elif channel == BUTTON_TEST_PIN:
            self.event_queue.put("test_cycle")

    def _heartbeat_loop(self):
        while self.running:
            if self.override_event.is_set() or not self.heartbeat_enabled:
                time.sleep(0.1)
                continue

            GPIO.output(CLEAR_LED_PIN, GPIO.HIGH)
            time.sleep(HEARTBEAT_ON_SECONDS)
            GPIO.output(CLEAR_LED_PIN, GPIO.LOW)
            time.sleep(HEARTBEAT_OFF_SECONDS)

    def _set_rgb(self, red_on, green_on, blue_on):
        with self.led_lock:
            GPIO.output(RED_PIN, GPIO.HIGH if red_on else GPIO.LOW)
            GPIO.output(GREEN_PIN, GPIO.HIGH if green_on else GPIO.LOW)
            GPIO.output(BLUE_PIN, GPIO.HIGH if blue_on else GPIO.LOW)

    def _set_rgb_color(self, color):
        if self.override_event.is_set():
            return

        if color == self.current_rgb:
            return

        if color == "red":
            self._set_rgb(True, False, False)
        elif color == "green":
            self._set_rgb(False, True, False)
        elif color == "blue":
            self._set_rgb(False, False, True)
        else:
            self._set_rgb(False, False, False)

        self.current_rgb = color

    def _get_bot_service_state(self):
        try:
            result = subprocess.run(
                ["systemctl", "show", "-p", "ActiveState", "-p", "SubState", BOT_SERVICE_NAME],
                capture_output=True,
                text=True,
                timeout=3
            )
            if result.returncode != 0:
                return "red"

            active_state = ""
            sub_state = ""
            for line in result.stdout.splitlines():
                if line.startswith("ActiveState="):
                    active_state = line.split("=", 1)[1].strip()
                elif line.startswith("SubState="):
                    sub_state = line.split("=", 1)[1].strip()

            if active_state == "active" and sub_state == "running":
                return "green"

            if active_state in ("activating", "reloading") or sub_state in (
                "auto-restart",
                "start-pre",
                "start-post",
                "stop-pre",
                "stop-post",
                "exited",
                "running"
            ):
                return "blue"

            if active_state in ("failed", "inactive", "deactivating"):
                return "red"

            return "red"
        except Exception as exc:
            print(f"[Hardware] Failed to read service state: {exc}")
            return "red"

    def _restart_bot_service(self):
        print("[Hardware] Restarting Discord bot service...")
        subprocess.run(["systemctl", "restart", BOT_SERVICE_NAME], check=False)

    def _toggle_maintenance(self):
        try:
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("SELECT value FROM platform_settings WHERE key = 'bot_maintenance'")
            row = cur.fetchone()

            current = {"enabled": False}
            if row and row[0]:
                try:
                    current = json.loads(row[0])
                except json.JSONDecodeError:
                    current = {"enabled": False}

            new_enabled = not bool(current.get("enabled"))
            new_value = {
                "enabled": new_enabled,
                "reason": (current.get("reason") or "Bot is under maintenance") if new_enabled else "",
                "endTime": current.get("endTime") if new_enabled else None,
                "notifyOwners": bool(current.get("notifyOwners")) if new_enabled else False
            }

            now = datetime.utcnow().isoformat()
            if row:
                cur.execute(
                    "UPDATE platform_settings SET value = ?, value_type = 'json', description = 'Bot maintenance settings', updated_by = ?, updated_at = ? WHERE key = 'bot_maintenance'",
                    (json.dumps(new_value), "hardware_controller", now)
                )
            else:
                cur.execute(
                    "INSERT INTO platform_settings (key, value, value_type, description, updated_by, updated_at) VALUES (?, ?, 'json', 'Bot maintenance settings', ?, ?)",
                    ("bot_maintenance", json.dumps(new_value), "hardware_controller", now)
                )

            conn.commit()
            conn.close()

            print(f"[Hardware] Bot maintenance mode {'ENABLED' if new_enabled else 'DISABLED'}")
        except Exception as exc:
            print(f"[Hardware] Failed to toggle maintenance: {exc}")

    def _test_cycle(self):
        print("[Hardware] Running LED test cycle...")
        self.override_event.set()
        try:
            self._set_rgb(True, False, False)
            time.sleep(1)
            self._set_rgb(False, True, False)
            time.sleep(1)
            self._set_rgb(False, False, True)
            time.sleep(1)
            self._set_rgb(False, False, False)
            GPIO.output(CLEAR_LED_PIN, GPIO.HIGH)
            time.sleep(1)
            GPIO.output(CLEAR_LED_PIN, GPIO.LOW)
        finally:
            self.override_event.clear()
            self.current_rgb = None

    def _process_event(self, event):
        if event == "restart":
            self._restart_bot_service()
        elif event == "toggle_maintenance":
            self._toggle_maintenance()
        elif event == "test_cycle":
            self._test_cycle()

    def run(self):
        print("[Hardware] Hardware controller starting...")
        time.sleep(2)
        self.heartbeat_enabled = True

        last_status_check = 0

        try:
            while self.running:
                try:
                    event = self.event_queue.get(timeout=0.1)
                    self._process_event(event)
                except queue.Empty:
                    pass

                now = time.time()
                if now - last_status_check >= STATUS_CHECK_INTERVAL:
                    status_color = self._get_bot_service_state()
                    self._set_rgb_color(status_color)
                    last_status_check = now
        finally:
            self.shutdown()

    def shutdown(self):
        if not self.running:
            return
        self.running = False
        self.heartbeat_enabled = False
        self.override_event.clear()
        try:
            GPIO.output(CLEAR_LED_PIN, GPIO.LOW)
            self._set_rgb(False, False, False)
        finally:
            GPIO.cleanup()
            print("[Hardware] GPIO cleanup complete.")


def main():
    controller = HardwareController()

    def handle_signal(signum, _frame):
        print(f"[Hardware] Received signal {signum}, shutting down...")
        controller.shutdown()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    controller.run()


if __name__ == "__main__":
    main()
EOFPYTHON

chmod +x /home/ubuntu/discord-bot/hardware_controller.py
chown ubuntu:ubuntu /home/ubuntu/discord-bot/hardware_controller.py

# Create systemd service
echo "[3/5] Creating systemd service..."
sudo tee /etc/systemd/system/hardware-controller.service > /dev/null << 'EOFSERVICE'
[Unit]
Description=Darklock Hardware Controller (GPIO)
After=network.target discord-bot.service

[Service]
Type=simple
User=root
WorkingDirectory=/home/ubuntu/discord-bot
ExecStart=/usr/bin/python3 /home/ubuntu/discord-bot/hardware_controller.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hardware-controller

[Install]
WantedBy=multi-user.target
EOFSERVICE

# Stop old services
echo "[4/5] Stopping old rgb-led-status service..."
sudo systemctl stop rgb-led-status.service 2>/dev/null || true
sudo systemctl disable rgb-led-status.service 2>/dev/null || true

# Enable and start hardware controller
echo "[5/5] Enabling hardware controller..."
sudo systemctl daemon-reload
sudo systemctl enable hardware-controller.service
sudo systemctl start hardware-controller.service

echo ""
echo "=== Installation Complete! ==="
echo ""
echo "Service Status:"
sudo systemctl status hardware-controller.service --no-pager -l
echo ""
echo "View logs with: sudo journalctl -u hardware-controller.service -f"
echo "Test LED: Press button on GPIO12"
