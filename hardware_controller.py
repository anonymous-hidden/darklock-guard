#!/usr/bin/env python3
"""
Hardware Controller for Darklock (Raspberry Pi 5)
- RGB status LED (BCM 17/27/22) => physical pins 11/13/15
- Network activity LED (BCM 23) => physical pin 16
- Under-attack LED (BCM 6) => physical pin 31
- Buttons for restart, maintenance toggle, LED test (BCM 5/24/12)

Uses lgpio for Raspberry Pi 5 compatibility.
"""

import json
import os
import queue
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime

try:
    import lgpio
    GPIO_AVAILABLE = True
except ImportError as e:
    print(f"[Hardware] ERROR: lgpio not available: {e}")
    print("[Hardware] Install with: sudo apt-get install python3-lgpio")
    GPIO_AVAILABLE = False
    lgpio = None

# GPIO pin definitions (BCM)
RED_PIN = 17
GREEN_PIN = 27
BLUE_PIN = 22

NETWORK_LED_PIN = 23
ATTACK_LED_PIN = 6

BUTTON_RESTART_PIN = 5
BUTTON_MAINTENANCE_PIN = 24
BUTTON_TEST_PIN = 12

BOT_SERVICE_NAME = "discord-bot.service"

STATUS_CHECK_INTERVAL = 1.0
BUTTON_DEBOUNCE_SECONDS = 0.5

NETWORK_POLL_INTERVAL = 0.25
NETWORK_ACTIVITY_WINDOW_SECONDS = 1.0

ATTACK_CHECK_INTERVAL = 2.0
ATTACK_ACTIVE_WINDOW_SECONDS = 120

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "darklock.db")


class HardwareController:
    def __init__(self):
        self.running = True
        self.override_event = threading.Event()
        self.event_queue = queue.Queue()
        self.led_lock = threading.Lock()
        self.last_button_press = {}
        self.current_rgb = None
        self.last_net_total = None
        self.last_net_activity = 0.0
        self.attack_active = False
        self.gpio_handle = None
        self.gpio_initialized = False
        self.button_callbacks = {}

        if not GPIO_AVAILABLE:
            print("[Hardware] ERROR: lgpio not available. Hardware controller cannot start.")
            print("[Hardware] Please install lgpio: sudo apt-get install python3-lgpio")
            raise RuntimeError("lgpio not available")

        try:
            self._setup_gpio()
            self._setup_buttons()
            self.gpio_initialized = True

            # Solid ON during boot (RGB blue)
            self._set_rgb_color("blue")

            self._set_led(NETWORK_LED_PIN, False)
            self._set_led(ATTACK_LED_PIN, False)
            
            print("[Hardware] GPIO initialization complete")
        except Exception as e:
            print(f"[Hardware] ERROR during GPIO initialization: {e}")
            print("[Hardware] Make sure the script is run with proper permissions (sudo)")
            if self.gpio_handle is not None:
                try:
                    lgpio.gpiochip_close(self.gpio_handle)
                except:
                    pass
            raise

        self.network_thread = threading.Thread(target=self._network_loop, daemon=True)
        self.network_thread.start()

        self.attack_thread = threading.Thread(target=self._attack_loop, daemon=True)
        self.attack_thread.start()

        self.button_thread = threading.Thread(target=self._button_loop, daemon=True)
        self.button_thread.start()

    def _setup_gpio(self):
        try:
            # Open GPIO chip (usually /dev/gpiochip4 on Pi 5, but lgpio auto-detects)
            self.gpio_handle = lgpio.gpiochip_open(4)
            
            # Set up output pins for LEDs
            for pin in [RED_PIN, GREEN_PIN, BLUE_PIN, NETWORK_LED_PIN, ATTACK_LED_PIN]:
                lgpio.gpio_claim_output(self.gpio_handle, pin, 0)
            
            # Set up input pins for buttons with pull-up
            for pin in [BUTTON_RESTART_PIN, BUTTON_MAINTENANCE_PIN, BUTTON_TEST_PIN]:
                lgpio.gpio_claim_input(self.gpio_handle, pin, lgpio.SET_PULL_UP)
            
            print("[Hardware] GPIO pins configured successfully (lgpio)")
        except Exception as e:
            print(f"[Hardware] ERROR setting up GPIO: {e}")
            raise

    def _setup_buttons(self):
        try:
            # Set up button state tracking
            for pin in [BUTTON_RESTART_PIN, BUTTON_MAINTENANCE_PIN, BUTTON_TEST_PIN]:
                self.button_callbacks[pin] = {
                    'last_state': 1,  # Pull-up means default is HIGH
                    'last_trigger': 0
                }
            print("[Hardware] Button monitoring configured")
        except Exception as e:
            print(f"[Hardware] ERROR setting up button monitoring: {e}")
            raise

    def _button_loop(self):
        """Poll buttons for state changes (lgpio doesn't have callbacks like RPi.GPIO)"""
        while self.running:
            try:
                for pin in [BUTTON_RESTART_PIN, BUTTON_MAINTENANCE_PIN, BUTTON_TEST_PIN]:
                    if not self.gpio_initialized or self.gpio_handle is None:
                        break
                    
                    try:
                        current_state = lgpio.gpio_read(self.gpio_handle, pin)
                        last_state = self.button_callbacks[pin]['last_state']
                        
                        # Detect falling edge (button press)
                        if last_state == 1 and current_state == 0:
                            now = time.time()
                            if now - self.button_callbacks[pin]['last_trigger'] > BUTTON_DEBOUNCE_SECONDS:
                                self.button_callbacks[pin]['last_trigger'] = now
                                self._handle_button_press(pin)
                        
                        self.button_callbacks[pin]['last_state'] = current_state
                    except Exception as e:
                        print(f"[Hardware] ERROR reading button {pin}: {e}")
                
                time.sleep(0.05)  # Poll every 50ms
            except Exception as e:
                print(f"[Hardware] ERROR in button loop: {e}")
                time.sleep(1)

    def _handle_button_press(self, pin):
        """Handle button press events"""
        if pin == BUTTON_RESTART_PIN:
            self.event_queue.put("restart")
            print("[Hardware] Restart button pressed")
        elif pin == BUTTON_MAINTENANCE_PIN:
            self.event_queue.put("toggle_maintenance")
            print("[Hardware] Maintenance button pressed")
        elif pin == BUTTON_TEST_PIN:
            self.event_queue.put("test_cycle")
            print("[Hardware] Test button pressed")

    def _set_led(self, pin, on):
        """Set a single LED on or off"""
        if not self.gpio_initialized or self.gpio_handle is None:
            return
        try:
            with self.led_lock:
                lgpio.gpio_write(self.gpio_handle, pin, 1 if on else 0)
        except Exception as e:
            print(f"[Hardware] ERROR setting LED {pin}: {e}")

    def _set_network_led(self, on):
        self._set_led(NETWORK_LED_PIN, on)

    def _set_attack_led(self, on):
        self._set_led(ATTACK_LED_PIN, on)

    def _read_net_bytes(self):
        try:
            total = 0
            with open("/proc/net/dev", "r", encoding="utf-8") as handle:
                for line in handle:
                    if ":" not in line:
                        continue
                    iface, data = line.split(":", 1)
                    iface = iface.strip()
                    if iface == "lo":
                        continue
                    fields = data.split()
                    if len(fields) >= 16:
                        rx = int(fields[0])
                        tx = int(fields[8])
                        total += rx + tx
            return total
        except Exception:
            return None

    def _network_loop(self):
        while self.running:
            if self.override_event.is_set():
                time.sleep(0.1)
                continue

            total = self._read_net_bytes()
            now = time.time()
            if total is not None:
                if self.last_net_total is not None and total > self.last_net_total:
                    self.last_net_activity = now
                    self._set_network_led(True)
                self.last_net_total = total

            if now - self.last_net_activity > NETWORK_ACTIVITY_WINDOW_SECONDS:
                self._set_network_led(False)

            time.sleep(NETWORK_POLL_INTERVAL)

    def _is_under_attack(self):
        logs_dir = os.path.join(BASE_DIR, "file-protection", "logs")
        if not os.path.isdir(logs_dir):
            return False

        now = time.time()
        try:
            for name in os.listdir(logs_dir):
                if not name.startswith("tamper-") or not name.endswith(".json"):
                    continue
                path = os.path.join(logs_dir, name)
                try:
                    if now - os.path.getmtime(path) <= ATTACK_ACTIVE_WINDOW_SECONDS:
                        return True
                except FileNotFoundError:
                    continue
        except Exception:
            return False

        return False

    def _attack_loop(self):
        while self.running:
            if self.override_event.is_set():
                time.sleep(0.1)
                continue

            active = self._is_under_attack()
            if active != self.attack_active:
                self.attack_active = active
                self._set_attack_led(active)

            time.sleep(ATTACK_CHECK_INTERVAL)

    def _set_rgb(self, red_on, green_on, blue_on):
        if not self.gpio_initialized or self.gpio_handle is None:
            return
        try:
            with self.led_lock:
                lgpio.gpio_write(self.gpio_handle, RED_PIN, 1 if red_on else 0)
                lgpio.gpio_write(self.gpio_handle, GREEN_PIN, 1 if green_on else 0)
                lgpio.gpio_write(self.gpio_handle, BLUE_PIN, 1 if blue_on else 0)
        except Exception as e:
            print(f"[Hardware] ERROR setting RGB: {e}")

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
            self._set_led(NETWORK_LED_PIN, True)
            time.sleep(1)
            self._set_led(NETWORK_LED_PIN, False)
            self._set_led(ATTACK_LED_PIN, True)
            time.sleep(1)
            self._set_led(ATTACK_LED_PIN, False)
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
        self.override_event.clear()
        
        if self.gpio_initialized and self.gpio_handle is not None:
            try:
                # Turn off all LEDs
                for pin in [RED_PIN, GREEN_PIN, BLUE_PIN, NETWORK_LED_PIN, ATTACK_LED_PIN]:
                    try:
                        lgpio.gpio_write(self.gpio_handle, pin, 0)
                    except:
                        pass
            except Exception as e:
                print(f"[Hardware] ERROR during LED shutdown: {e}")
            finally:
                try:
                    lgpio.gpiochip_close(self.gpio_handle)
                    print("[Hardware] GPIO cleanup complete.")
                except Exception as e:
                    print(f"[Hardware] ERROR during GPIO cleanup: {e}")


def main():
    try:
        controller = HardwareController()
    except Exception as e:
        print(f"[Hardware] FATAL: Failed to initialize hardware controller: {e}")
        print("[Hardware] Ensure you are running with sudo and lgpio is installed")
        sys.exit(1)

    def handle_signal(signum, _frame):
        print(f"[Hardware] Received signal {signum}, shutting down...")
        controller.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        controller.run()
    except KeyboardInterrupt:
        print("[Hardware] Keyboard interrupt received")
        controller.shutdown()
    except Exception as e:
        print(f"[Hardware] ERROR in main loop: {e}")
        controller.shutdown()
        sys.exit(1)


if __name__ == "__main__":
    main()
