#!/usr/bin/env python3
"""
DARKLOCK RFID Security Gateway v2
Hardware: RC522 RFID on Pi 5 SPI + ELEGOO Mega via USB serial

LED meaning:
  LED1 (RGB):  Green=ready, Red=error, Blue=processing
  LED2 (R+G):  Red=denied, Green=granted, both off=idle
"""
import os, sys, json, socket, hashlib, threading, time, signal, glob
from datetime import datetime

# -- GPIO init MUST happen before mfrc522 import --
import RPi.GPIO as GPIO
GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

from mfrc522 import MFRC522, SimpleMFRC522
import serial

# Custom RFID reader using free GPIO pin for RST
# Pi5 Ubuntu 24 has GPIO 22/25 busy (SPI subsystem), GPIO 13 is free
RFID_RST_PIN = 13

# ── Configuration ─────────────────────────────────────────────────
CONFIG = {
    "allowlist_path": "/home/ubuntu/darklock/rfid_allowlist.json",
    "socket_path": "/tmp/darklock_rfid.sock",
    "tcp_host": "0.0.0.0",
    "tcp_port": 9999,
    "scan_timeout": 15,
    "auth_timeout": 60,
    "arduino_baud": 115200,
}

def log(msg):
    print(f"{datetime.now().strftime('%H:%M:%S')} | {msg}", flush=True)

def find_arduino():
    """Auto-detect Arduino serial port"""
    for pattern in ["/dev/ttyACM*", "/dev/ttyUSB*"]:
        ports = sorted(glob.glob(pattern))
        if ports:
            return ports[0]
    return None

# ── Gateway Class ─────────────────────────────────────────────────
class RFIDGateway:
    def __init__(self):
        # Create RFID reader with custom RST pin (GPIO 13 is free on Pi5)
        self.reader = SimpleMFRC522.__new__(SimpleMFRC522)
        self.reader.READER = MFRC522(pin_rst=RFID_RST_PIN)
        self.allowlist = {}
        self.running = False
        self.active_sessions = {}
        self.lock = threading.Lock()
        self.stats = {"boot": datetime.now().isoformat(), "scans": 0, "valid": 0, "denied": 0}
        
        # Connect to Arduino display
        self.arduino = None
        port = find_arduino()
        if port:
            try:
                self.arduino = serial.Serial(port, CONFIG["arduino_baud"], timeout=1)
                time.sleep(2)  # Wait for Arduino reboot
                # Drain buffer and wait for READY
                start = time.time()
                while time.time() - start < 5:
                    if self.arduino.in_waiting:
                        line = self.arduino.readline().decode('ascii', errors='ignore').strip()
                        if line == "READY":
                            log(f"  Arduino on {port}")
                            break
                    time.sleep(0.1)
                self.display_lcd("DARKLOCK v2.0", "Initializing...")
                self.set_led1(255, 165, 0)  # Orange = starting
                self.set_rfid(0, 0)
            except Exception as e:
                log(f"  Arduino error: {e}")
                self.arduino = None
        else:
            log("  No Arduino found")

    # ── Arduino Serial Commands ───────────────────────────────────
    def display_lcd(self, line1, line2=""):
        if self.arduino:
            try:
                self.arduino.write(f"LCD:{line1[:16]}|{line2[:16]}\n".encode('ascii'))
                self.arduino.flush()
            except: pass

    def set_led1(self, r, g, b):
        if self.arduino:
            try:
                self.arduino.write(f"LED1:{r},{g},{b}\n".encode('ascii'))
                self.arduino.flush()
            except: pass

    def set_rfid(self, red, green):
        """Set RFID LEDs: red=denied, green=granted"""
        if self.arduino:
            try:
                self.arduino.write(f"LED2:{red},{green},0\n".encode('ascii'))
                self.arduino.flush()
            except: pass

    # ── Card Management ───────────────────────────────────────────
    def load_allowlist(self):
        if os.path.exists(CONFIG["allowlist_path"]):
            with open(CONFIG["allowlist_path"]) as f:
                data = json.load(f)
                self.allowlist = data.get("cards", {})
        log(f"  {len(self.allowlist)} authorized card(s)")
        self.display_lcd("DARKLOCK v2.0", f"{len(self.allowlist)} cards loaded")

    def scan_card(self, purpose="unknown"):
        """Scan RFID card with timeout. Returns uid_hash or None."""
        log(f"Scan requested: {purpose}")
        
        # Set display for scan mode
        if purpose == "admin login":
            self.display_lcd("ADMIN LOGIN", "Scan card now...")
        elif purpose == "shutdown/restart":
            self.display_lcd("SHUTDOWN AUTH", "Scan card now...")
        else:
            self.display_lcd("RFID SCAN", "Present card...")
        
        # Both LEDs off during scan wait
        self.set_rfid(0, 0)
        self.set_led1(0, 0, 255)  # Blue = scanning
        
        # Scan in thread with timeout
        result = [None]
        error = [None]
        
        def read_card():
            try:
                uid, _ = self.reader.read()
                result[0] = uid
            except Exception as e:
                error[0] = e
        
        t = threading.Thread(target=read_card, daemon=True)
        t.start()
        t.join(timeout=CONFIG["scan_timeout"])
        
        # Timeout
        if t.is_alive():
            log("  Scan timeout")
            self.display_lcd("SCAN TIMEOUT", "Try again")
            self.set_rfid(255, 0)  # Red
            self.set_led1(0, 255, 0)  # Back to green
            time.sleep(2)
            self.display_lcd("DARKLOCK v2.0", "Ready")
            self.set_rfid(0, 0)
            return None
        
        # Error
        if error[0]:
            log(f"  Scan error: {error[0]}")
            self.display_lcd("SCAN ERROR", "Hardware fault")
            self.set_rfid(255, 0)  # Red
            self.set_led1(255, 0, 0)  # Red system
            time.sleep(2)
            self.display_lcd("DARKLOCK v2.0", "Ready")
            self.set_rfid(0, 0)
            self.set_led1(0, 255, 0)
            return None
        
        # Card detected
        if result[0]:
            uid = result[0]
            self.stats["scans"] += 1
            uid_hash = hashlib.sha256(str(uid).encode()).hexdigest()
            
            if uid_hash in self.allowlist:
                self.stats["valid"] += 1
                user = self.allowlist[uid_hash]
                log(f"  GRANTED: {user}")
                self.display_lcd("ACCESS GRANTED", user[:16])
                self.set_rfid(0, 255)  # Green
                self.set_led1(0, 255, 0)  # Green system
                time.sleep(2)
                self.display_lcd("DARKLOCK v2.0", "Ready")
                self.set_rfid(0, 0)
                return uid_hash
            else:
                self.stats["denied"] += 1
                log(f"  DENIED: unknown card {uid}")
                self.display_lcd("ACCESS DENIED", "Unknown card")
                self.set_rfid(255, 0)  # Red
                self.set_led1(0, 255, 0)
                time.sleep(2)
                self.display_lcd("DARKLOCK v2.0", "Ready")
                self.set_rfid(0, 0)
                return None
        
        return None

    # ── Auth Actions ──────────────────────────────────────────────
    def authorize_admin(self):
        uid_hash = self.scan_card("admin login")
        if uid_hash:
            expires = time.time() + CONFIG["auth_timeout"]
            with self.lock:
                self.active_sessions["admin"] = (expires, uid_hash)
            return {"authorized": True, "expires": expires, "user": self.allowlist[uid_hash]}
        return {"authorized": False}

    def authorize_shutdown(self):
        uid_hash = self.scan_card("shutdown/restart")
        if uid_hash:
            expires = time.time() + CONFIG["auth_timeout"]
            with self.lock:
                self.active_sessions["shutdown"] = (expires, uid_hash)
            return {"authorized": True, "expires": expires, "user": self.allowlist[uid_hash]}
        return {"authorized": False}

    def get_status(self):
        with self.lock:
            active = {}
            now = time.time()
            for key, (expires, uid) in list(self.active_sessions.items()):
                if expires > now:
                    active[key] = {"user": self.allowlist.get(uid, "unknown"), "remaining": int(expires - now)}
                else:
                    del self.active_sessions[key]
        return {"online": True, "cards": len(self.allowlist), "stats": self.stats, "active_sessions": active}

    # ── Network Server ────────────────────────────────────────────
    def handle_client(self, conn):
        try:
            data = conn.recv(4096).decode().strip()
            if not data:
                return
            cmd = json.loads(data)
            action = cmd.get("action")
            
            if action == "scan_admin":
                result = self.authorize_admin()
            elif action == "scan_shutdown":
                result = self.authorize_shutdown()
            elif action == "status":
                result = self.get_status()
            else:
                result = {"error": "unknown action"}
            
            conn.sendall((json.dumps(result) + "\n").encode())
        except Exception as e:
            log(f"Client error: {e}")
            try:
                conn.sendall(json.dumps({"error": str(e)}).encode())
            except: pass
        finally:
            conn.close()

    def start_server(self):
        # Unix socket
        if os.path.exists(CONFIG["socket_path"]):
            os.unlink(CONFIG["socket_path"])
        unix_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        unix_sock.bind(CONFIG["socket_path"])
        os.chmod(CONFIG["socket_path"], 0o666)
        unix_sock.listen(5)
        
        # TCP socket
        tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tcp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        tcp_sock.bind((CONFIG["tcp_host"], CONFIG["tcp_port"]))
        tcp_sock.listen(5)
        
        log(f"  IPC: {CONFIG['socket_path']}")
        log(f"  TCP: {CONFIG['tcp_host']}:{CONFIG['tcp_port']}")
        self.running = True
        
        import select
        sockets = [unix_sock, tcp_sock]
        
        while self.running:
            try:
                readable, _, _ = select.select(sockets, [], [], 1.0)
                for sock in readable:
                    conn, _ = sock.accept()
                    threading.Thread(target=self.handle_client, args=(conn,), daemon=True).start()
            except Exception as e:
                if self.running:
                    log(f"Server error: {e}")
        
        unix_sock.close()
        tcp_sock.close()

    def shutdown(self):
        log("Shutting down...")
        self.running = False
        self.display_lcd("GATEWAY", "Offline")
        self.set_led1(0, 0, 0)
        self.set_rfid(0, 0)
        if self.arduino:
            try: self.arduino.close()
            except: pass
        GPIO.cleanup()
        if os.path.exists(CONFIG["socket_path"]):
            os.unlink(CONFIG["socket_path"])

# ── Main ──────────────────────────────────────────────────────────
def main():
    gateway = RFIDGateway()
    
    def sig_handler(signum, frame):
        gateway.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)
    
    log("=" * 50)
    log("DARKLOCK RFID Security Gateway v2")
    log("=" * 50)
    
    gateway.load_allowlist()
    gateway.display_lcd("DARKLOCK v2.0", "Ready")
    gateway.set_led1(0, 255, 0)  # Green = system ready
    gateway.set_rfid(0, 0)       # LEDs off = idle
    
    try:
        gateway.start_server()
    except Exception as e:
        log(f"Fatal: {e}")
        gateway.shutdown()
        sys.exit(1)

if __name__ == "__main__":
    main()
