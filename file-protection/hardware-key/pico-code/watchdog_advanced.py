# Advanced Hardware Watchdog with Session Management
# Features: Handshake, Session IDs, State Machine, Crash Detection

from machine import Pin, Timer
import time
import sys
import random
import select

# ============================================================================
# CONFIGURATION
# ============================================================================
HEARTBEAT_TIMEOUT = 15      # Seconds without heartbeat = crash
HANDSHAKE_TIMEOUT = 10      # Seconds to complete handshake
SESSION_CHECK_INTERVAL = 2  # Check session health every N seconds
MAX_MISSED_HEARTBEATS = 3   # Missed heartbeats before restart
AUTO_RESTART_DELAY = 3      # Seconds before auto-restart
LED_PIN = 25
BOOTSEL_PIN = 22

# ============================================================================
# STATE MACHINE
# ============================================================================
class State:
    IDLE = "IDLE"                    # Waiting for connection
    HANDSHAKE_INIT = "HANDSHAKE"     # Handshake in progress
    CONNECTED = "CONNECTED"           # Active session
    MONITORING = "MONITORING"         # Bot running, monitoring health
    CRASH_DETECTED = "CRASH"          # Crash detected, preparing restart
    RESTARTING = "RESTARTING"         # Restart in progress
    SHUTDOWN = "SHUTDOWN"             # Graceful shutdown (no restart)

# ============================================================================
# PROTOCOL MESSAGES
# ============================================================================
class Protocol:
    # Handshake
    SYN = "WD:SYN"                    # Watchdog initiates
    SYN_ACK = "SRV:SYN_ACK"           # Server acknowledges
    ACK = "WD:ACK"                    # Watchdog confirms
    
    # Session
    SESSION_START = "SRV:SESSION"     # Server sends session ID
    SESSION_ACK = "WD:SESSION_ACK"    # Watchdog confirms session
    
    # Heartbeat
    HEARTBEAT = "SRV:HB"              # Server heartbeat (with seq number)
    HEARTBEAT_ACK = "WD:HB_ACK"       # Watchdog acknowledges
    
    # Status
    STATUS_REQ = "WD:STATUS?"         # Watchdog requests status
    STATUS_OK = "SRV:STATUS_OK"       # Server is healthy
    STATUS_WARN = "SRV:STATUS_WARN"   # Server has warnings
    STATUS_CRIT = "SRV:STATUS_CRIT"   # Server critical
    
    # Control
    RESTART_REQ = "WD:RESTART"        # Watchdog requests restart
    RESTART_ACK = "SRV:RESTART_ACK"   # Server acknowledges restart
    SHUTDOWN = "SRV:SHUTDOWN"         # Server graceful shutdown
    SHUTDOWN_ACK = "WD:SHUTDOWN_ACK"  # Watchdog acknowledges
    LAUNCH = "WD:LAUNCH"              # Launch bot command
    LAUNCH_ACK = "SRV:LAUNCH_ACK"     # Server starting
    
    # Ping
    PING = "WD:PING"
    PONG = "SRV:PONG"

# ============================================================================
# WATCHDOG CLASS
# ============================================================================
class AdvancedWatchdog:
    def __init__(self):
        # Hardware
        self.led = Pin(LED_PIN, Pin.OUT)
        self.bootsel = Pin(BOOTSEL_PIN, Pin.IN)
        
        # USB CDC is used automatically for serial over USB
        # No UART setup needed - we'll use sys.stdin/stdout
        
        # State
        self.state = State.IDLE
        self.previous_state = None
        
        # Session
        self.session_id = None
        self.session_start_time = None
        
        # Heartbeat tracking
        self.last_heartbeat = 0
        self.heartbeat_seq = 0
        self.expected_seq = 1
        self.missed_heartbeats = 0
        
        # Timing
        self.state_enter_time = time.time()
        self.last_status_check = 0
        
        # Statistics
        self.total_heartbeats = 0
        self.total_restarts = 0
        self.uptime_start = time.time()
        
        # Button
        self.button_pressed = False
        self.button_press_start = 0
        self.double_press_window = 0.8
        self.last_press_time = 0
        self.press_count = 0
        
        # Server status
        self.server_status = "unknown"
        self.server_health = 100
        
        # Debug mode - set to False to prevent UART corruption
        self.debug_mode = False
        
    def log(self, msg, level="INFO"):
        """Log message - only prints if debug_mode enabled"""
        if self.debug_mode:
            timestamp = time.time() - self.uptime_start
            print(f"[{timestamp:8.2f}] [{level:5}] {msg}")
        
    def send(self, message):
        """Send message to server via USB CDC"""
        print(message)  # print() goes to USB CDC automatically
        
    def change_state(self, new_state):
        """Change state machine state"""
        if new_state != self.state:
            self.previous_state = self.state
            self.state = new_state
            self.state_enter_time = time.time()
            # No log - corrupts UART
            self.update_led_pattern()
            
    def update_led_pattern(self):
        """Update LED based on current state"""
        # LED patterns are handled in main loop based on state
        pass
        
    def blink(self, times, on_time=0.1, off_time=0.1):
        """Blink LED pattern"""
        for _ in range(times):
            self.led.on()
            time.sleep(on_time)
            self.led.off()
            time.sleep(off_time)
            
    def generate_session_id(self):
        """Generate unique session ID"""
        return f"WD{random.randint(1000, 9999)}{int(time.time()) % 10000}"
        
    # ========================================================================
    # HANDSHAKE PROTOCOL
    # ========================================================================
    def initiate_handshake(self):
        """Start handshake with server"""
        # No log - corrupts UART
        self.change_state(State.HANDSHAKE_INIT)
        self.send(Protocol.SYN)
        
        # Handshake initiation: 2 quick blinks
        self.blink(2, 0.1, 0.1)
        
    def complete_handshake(self, session_id):
        """Complete handshake and establish session"""
        self.session_id = session_id
        self.session_start_time = time.time()
        self.heartbeat_seq = 0
        self.expected_seq = 1
        self.missed_heartbeats = 0
        self.last_heartbeat = time.time()
        
        self.send(f"{Protocol.SESSION_ACK}:{session_id}")
        self.change_state(State.MONITORING)
        # No log - corrupts UART
        
        # Session established pattern: short-long-short
        self.show_status_pattern('session_start')
        
    # ========================================================================
    # MESSAGE PROCESSING
    # ========================================================================
    def process_message(self, msg):
        """Process incoming message from server"""
        msg = msg.strip()
        if not msg:
            return
            
        # No log here - would corrupt protocol
        
        # Parse message
        parts = msg.split(":")
        cmd = parts[0] if parts else ""
        full_cmd = ":".join(parts[:2]) if len(parts) >= 2 else msg
        data = parts[2] if len(parts) > 2 else ""
        
        # Handle based on current state
        if self.state == State.IDLE:
            self.handle_idle_message(full_cmd, data, msg)
        elif self.state == State.HANDSHAKE_INIT:
            self.handle_handshake_message(full_cmd, data, msg)
        elif self.state in [State.CONNECTED, State.MONITORING]:
            self.handle_connected_message(full_cmd, data, msg)
        elif self.state == State.CRASH_DETECTED:
            self.handle_crash_message(full_cmd, data, msg)
        elif self.state == State.RESTARTING:
            self.handle_restart_message(full_cmd, data, msg)
            
    def handle_idle_message(self, cmd, data, raw):
        """Handle messages in IDLE state"""
        if cmd == Protocol.SYN_ACK or "SYN_ACK" in raw:
            # Server responded to our SYN
            self.change_state(State.HANDSHAKE_INIT)
            self.send(Protocol.ACK)
        elif "SESSION" in raw:
            # Server sending session info
            session_id = raw.split(":")[-1] if ":" in raw else self.generate_session_id()
            self.complete_handshake(session_id)
            
    def handle_handshake_message(self, cmd, data, raw):
        """Handle messages during handshake"""
        if "SESSION" in raw:
            session_id = raw.split(":")[-1] if ":" in raw else self.generate_session_id()
            self.complete_handshake(session_id)
        elif cmd == Protocol.SYN_ACK:
            self.send(Protocol.ACK)
            
    def handle_connected_message(self, cmd, data, raw):
        """Handle messages while connected"""
        # Heartbeat
        if "HB" in raw and "ACK" not in raw:
            self.handle_heartbeat(raw)
            
        # Status responses
        elif cmd == Protocol.STATUS_OK:
            self.server_status = "healthy"
            self.server_health = 100
        elif cmd == Protocol.STATUS_WARN:
            self.server_status = "warning"
            self.server_health = 50
        elif cmd == Protocol.STATUS_CRIT:
            self.server_status = "critical"
            self.server_health = 20
            
        # Shutdown
        elif cmd == Protocol.SHUTDOWN or "SHUTDOWN" in raw:
            self.handle_graceful_shutdown()
            
        # Restart ACK
        elif cmd == Protocol.RESTART_ACK:
            self.log("Server acknowledged restart")
            self.change_state(State.RESTARTING)
            
        # Pong
        elif cmd == Protocol.PONG or "PONG" in raw:
            self.log("Pong received")
            self.last_heartbeat = time.time()  # Pong counts as alive
            
        # Launch ACK
        elif "LAUNCH_ACK" in raw:
            self.log("Server launch acknowledged")
            
    def handle_crash_message(self, cmd, data, raw):
        """Handle messages during crash state"""
        # If we receive anything, server might be recovering
        if "HB" in raw or "PONG" in raw or "SESSION" in raw:
            self.log("Server responding during crash state - recovery?")
            self.missed_heartbeats = 0
            self.last_heartbeat = time.time()
            self.change_state(State.MONITORING)
            
    def handle_restart_message(self, cmd, data, raw):
        """Handle messages during restart"""
        if "SESSION" in raw or "SYN_ACK" in raw:
            session_id = raw.split(":")[-1] if ":" in raw else self.generate_session_id()
            self.complete_handshake(session_id)
            self.log("Server restarted successfully!")
            self.total_restarts += 1
            
    # ========================================================================
    # HEARTBEAT HANDLING
    # ========================================================================
    def handle_heartbeat(self, msg):
        """Process heartbeat message"""
        # Parse sequence number if present (format: SRV:HB:123)
        parts = msg.split(":")
        seq = 0
        if len(parts) >= 3:
            try:
                seq = int(parts[2])
            except:
                pass
                
        self.last_heartbeat = time.time()
        self.total_heartbeats += 1
        self.missed_heartbeats = 0
        self.heartbeat_seq = seq
        
        # Send ACK with sequence
        self.send(f"{Protocol.HEARTBEAT_ACK}:{seq}")
        
        # Quick LED flash for heartbeat
        self.led_heartbeat_flash()
        
    def check_heartbeat_timeout(self):
        """Check if heartbeat has timed out"""
        if self.state != State.MONITORING:
            return
            
        time_since_hb = time.time() - self.last_heartbeat
        
        if time_since_hb > HEARTBEAT_TIMEOUT / MAX_MISSED_HEARTBEATS:
            self.missed_heartbeats += 1
            # Don't log - corrupts UART
            
            if self.missed_heartbeats >= MAX_MISSED_HEARTBEATS:
                self.detect_crash()
                
    # ========================================================================
    # CRASH DETECTION & RECOVERY
    # ========================================================================
    def detect_crash(self):
        """Detect server crash"""
        # Don't log - corrupts UART
        self.change_state(State.CRASH_DETECTED)
        
        # SOS blink pattern
        self.sos_blink()
        
        # Auto-restart after delay
        time.sleep(AUTO_RESTART_DELAY)
        self.trigger_restart()
        
    def trigger_restart(self):
        """Trigger server restart"""
        # Don't log - corrupts UART
        self.change_state(State.RESTARTING)
        self.session_id = None
        self.send(Protocol.RESTART_REQ)
        
        # Restart pattern: 5 quick blinks
        for _ in range(5):
            self.led.on()
            time.sleep(0.1)
            self.led.off()
            time.sleep(0.1)
        
    def handle_graceful_shutdown(self):
        """Handle graceful server shutdown"""
        # No log - corrupts UART
        self.send(Protocol.SHUTDOWN_ACK)
        self.change_state(State.SHUTDOWN)
        self.session_id = None
        
        # Graceful shutdown: 2 slow blinks
        self.blink(2, 0.3, 0.3)
        
        # After graceful shutdown, return to IDLE (no auto-restart)
        time.sleep(1)
        self.change_state(State.IDLE)
        
    def sos_blink(self):
        """SOS LED pattern"""
        # ... (short)
        for _ in range(3):
            self.led.on()
            time.sleep(0.1)
            self.led.off()
            time.sleep(0.1)
        time.sleep(0.2)
        # --- (long)
        for _ in range(3):
            self.led.on()
            time.sleep(0.3)
            self.led.off()
            time.sleep(0.1)
        time.sleep(0.2)
        # ... (short)
        for _ in range(3):
            self.led.on()
            time.sleep(0.1)
            self.led.off()
            time.sleep(0.1)
            
    # ========================================================================
    # BUTTON HANDLING
    # ========================================================================
    def handle_button(self):
        """Handle BOOTSEL button"""
        button_now = self.bootsel.value() == 1
        current_time = time.time()
        
        # Button press detected
        if button_now and not self.button_pressed:
            self.button_pressed = True
            
            if current_time - self.last_press_time < self.double_press_window:
                self.press_count = 2
            else:
                self.press_count = 1
                
            self.last_press_time = current_time
            self.led.on()
            
        # Button released
        elif not button_now and self.button_pressed:
            self.button_pressed = False
            self.led.off()
            
        # Execute action after window
        if self.press_count > 0 and current_time - self.last_press_time > self.double_press_window:
            if self.press_count == 1:
                self.button_single_press()
            else:
                self.button_double_press()
            self.press_count = 0
            
    def button_single_press(self):
        """Single press - Launch bot"""
        # No log - corrupts UART
        self.send(Protocol.LAUNCH)
        self.show_status_pattern('success')
        
        if self.state == State.IDLE:
            self.initiate_handshake()
            
    def button_double_press(self):
        """Double press - Restart bot"""
        # No log - corrupts UART
        self.show_status_pattern('button_double')
        time.sleep(0.2)
        self.trigger_restart()
        
    # ========================================================================
    # STATUS & MONITORING
    # ========================================================================
    def periodic_status_check(self):
        """Periodically check server status"""
        if self.state != State.MONITORING:
            return
            
        if time.time() - self.last_status_check > SESSION_CHECK_INTERVAL:
            self.send(Protocol.STATUS_REQ)
            self.last_status_check = time.time()
            
    def get_session_info(self):
        """Get current session info"""
        if not self.session_id:
            return "No active session"
            
        duration = time.time() - self.session_start_time
        return f"Session: {self.session_id}, Duration: {duration:.0f}s, HB: {self.total_heartbeats}"
        
    # ========================================================================
    # LED PATTERNS & STATUS INDICATORS
    # ========================================================================
    def update_led(self):
        """Update LED based on state - LED is ALWAYS doing something visible
        LED off = no power (or graceful shutdown which quickly returns to IDLE)
        """
        t = time.time()
        # Use fractional time for smooth patterns
        frac = t - int(t)
        
        if self.state == State.IDLE:
            # Breathing/pulsing pattern - slow fade simulation with blinks
            # Always visibly ON with periodic quick off-blink
            # Pattern: ●●●●●_●●●●●_●●●●●_ (mostly on, brief off every 1.5s)
            cycle = t % 1.5
            if cycle > 1.4:
                self.led.off()
            else:
                self.led.on()
            
        elif self.state == State.HANDSHAKE_INIT:
            # Fast double-blink pattern - clearly connecting
            # Pattern: ●●_●●___●●_●●___ (double blink every 0.8s)
            cycle = t % 0.8
            if cycle < 0.1 or (cycle > 0.2 and cycle < 0.3):
                self.led.on()
            else:
                self.led.off()
            # But mostly on to be visible
            if cycle > 0.4:
                self.led.on()
            
        elif self.state == State.CONNECTED:
            # Triple quick blink pattern - connected, waiting for monitoring
            # Pattern: ●●●___ repeating
            cycle = t % 1.0
            if cycle < 0.15 or (cycle > 0.2 and cycle < 0.35) or (cycle > 0.4 and cycle < 0.55):
                self.led.on()
            elif cycle > 0.7:
                self.led.on()  # Stay on between patterns
            else:
                self.led.off()
            
        elif self.state == State.MONITORING:
            # Health-based patterns - always clearly visible
            if self.server_health >= 80:
                # Healthy: Steady ON with periodic heartbeat flash (brief off)
                # This shows "alive and well" - mostly solid with tiny off-blips
                cycle = t % 2.0
                if cycle > 1.9:
                    self.led.off()  # Brief off-flash every 2s
                else:
                    self.led.on()
                    
            elif self.server_health >= 50:
                # Warning: Noticeable blink (on longer than off)
                # Pattern: ●●●●●_●●●●●_ (0.8s on, 0.2s off)
                cycle = t % 1.0
                if cycle > 0.8:
                    self.led.off()
                else:
                    self.led.on()
                    
            else:
                # Critical: Fast blink, equal on/off
                # Pattern: ●●__●●__●●__ (0.25s each)
                cycle = t % 0.5
                if cycle > 0.25:
                    self.led.off()
                else:
                    self.led.on()
                
            # Missed heartbeats: add extra off-blinks
            if self.missed_heartbeats > 0:
                # Add stutter based on missed count
                stutter = t % (0.3 / self.missed_heartbeats)
                if stutter < 0.05:
                    self.led.off()
                    
        elif self.state == State.CRASH_DETECTED:
            # Rapid strobe - clearly something is wrong
            # Pattern: ●_●_●_●_●_ (very fast 8Hz)
            cycle = t % 0.125
            if cycle > 0.0625:
                self.led.off()
            else:
                self.led.on()
            
        elif self.state == State.RESTARTING:
            # Double-blink then pause - restart in progress
            # Pattern: ●_●___●_●___ (two blinks, pause, repeat)
            cycle = t % 1.2
            if cycle < 0.1 or (cycle > 0.2 and cycle < 0.3):
                self.led.on()
            elif cycle > 0.6:
                self.led.on()  # Stay visible between patterns
            else:
                self.led.off()
            
        elif self.state == State.SHUTDOWN:
            # Graceful shutdown: slow fade out simulation
            # Quick transition to IDLE, so this is brief
            # Pattern: ●___●___●___ (slow blink getting slower)
            cycle = t % 2.0
            if cycle < 0.3:
                self.led.on()
            else:
                self.led.off()
            
    def show_status_pattern(self, pattern_name):
        """Show specific status pattern"""
        patterns = {
            'success': [(0.1, 3)],  # 3 quick blinks
            'warning': [(0.2, 2)],  # 2 medium blinks
            'error': [(0.05, 10)],  # 10 rapid blinks
            'info': [(0.1, 1)],     # 1 quick blink
            'sos': None,            # Handled by sos_blink()
            'heartbeat_ok': [(0.02, 1)],  # Very quick flash
            'session_start': [(0.1, 3), (0.3, 1), (0.1, 3)],  # Short-Long-Short
            'button_press': [(0.1, 1)],
            'button_double': [(0.1, 2)]
        }
        
        pattern = patterns.get(pattern_name, [(0.1, 1)])
        if pattern:
            for duration, count in pattern:
                self.blink(count, duration, duration)
                
    def led_heartbeat_flash(self):
        """Ultra-quick LED flash for heartbeat acknowledgment"""
        self.led.on()
        time.sleep(0.02)
        self.led.off()
        
    def led_startup_sequence(self):
        """Startup LED sequence"""
        # Quick test (no logging - would corrupt UART)
        self.led.on()
        time.sleep(0.5)
        self.led.off()
        time.sleep(0.2)
        
        # Three quick blinks
        self.blink(3, 0.1, 0.1)
        time.sleep(0.3)
        
        # Ready signal - two slow blinks
        self.blink(2, 0.3, 0.3)
            
    # ========================================================================
    # MAIN LOOP
    # ========================================================================
    def run(self):
        """Main watchdog loop"""
        # Don't print to UART - it corrupts protocol!
        # All debug output disabled in production mode
        
        # Enhanced startup LED sequence
        self.led_startup_sequence()
        
        # Wait for UART to be fully ready and serial connection
        time.sleep(2)  # Give serial port time to stabilize
        
        # Auto-initiate handshake on startup
        self.initiate_handshake()
        
        last_hb_check = time.time()
        
        while True:
            try:
                # Handle button
                self.handle_button()
                
                # Read from USB CDC (stdin)
                if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                    line = sys.stdin.readline().strip()
                    if line:
                        self.process_message(line)
                            
                # Check heartbeat timeout (every second)
                if time.time() - last_hb_check >= 1:
                    self.check_heartbeat_timeout()
                    last_hb_check = time.time()
                    
                # Periodic status check
                self.periodic_status_check()
                
                # Handle handshake timeout
                if self.state == State.HANDSHAKE_INIT:
                    if time.time() - self.state_enter_time > HANDSHAKE_TIMEOUT:
                        # No log - corrupts UART
                        self.initiate_handshake()
                        
                # Handle restart timeout
                if self.state == State.RESTARTING:
                    if time.time() - self.state_enter_time > 30:
                        # No log - corrupts UART
                        self.change_state(State.IDLE)
                        
                # Update LED
                self.update_led()
                
                time.sleep(0.05)
                
            except KeyboardInterrupt:
                # Silent shutdown
                self.led.off()
                sys.exit()
            except Exception as e:
                # Silent error handling - blink LED rapidly
                for _ in range(10):
                    self.led.toggle()
                    time.sleep(0.05)
                time.sleep(1)


# ============================================================================
# ENTRY POINT
# ============================================================================
if __name__ == "__main__":
    watchdog = AdvancedWatchdog()
    watchdog.run()
