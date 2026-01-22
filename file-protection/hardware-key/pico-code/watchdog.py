# Raspberry Pi Pico Hardware Watchdog
# Monitors server heartbeats and triggers restart if server crashes
# Uses built-in BOOTSEL button for controls

from machine import Pin, UART
import time
import sys

# Configuration
HEARTBEAT_TIMEOUT = 30  # Seconds without heartbeat before triggering restart
LED_PIN = 25
BOOTSEL_PIN = 22  # Built-in BOOTSEL button on Pico
UART_ID = 0
BAUD_RATE = 115200

# Button press thresholds
DOUBLE_PRESS_WINDOW = 0.8  # Time window to detect double press

# Initialize
led = Pin(LED_PIN, Pin.OUT)
bootsel = Pin(BOOTSEL_PIN, Pin.IN)  # BOOTSEL button (active high when pressed)
uart = UART(UART_ID, baudrate=BAUD_RATE)

# Watchdog state
last_heartbeat = time.time()
server_alive = True
restart_triggered = False
bot_running = False  # Track if bot is currently running

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

def send_command(command):
    """Send command to server"""
    uart.write(f"{command}\n".encode('utf-8'))

def handle_button():
    """Handle BOOTSEL button press/release - Single press to launch, double press to restart"""
    global last_press_time, press_count, button_was_pressed, bot_running
    
    button_pressed_now = bootsel.value() == 1  # BOOTSEL is active high
    current_time = time.time()
    
    # Detect button press (rising edge)
    if button_pressed_now and not button_was_pressed:
        button_was_pressed = True
        
        # Check if within double-press window
        if current_time - last_press_time < DOUBLE_PRESS_WINDOW:
            press_count = 2
        else:
            press_count = 1
        
        last_press_time = current_time
        led.on()  # Visual feedback
    
    # Detect button release
    elif not button_pressed_now and button_was_pressed:
        button_was_pressed = False
        led.off()
    
    # Execute action after window expires
    if press_count > 0 and current_time - last_press_time > DOUBLE_PRESS_WINDOW:
        if press_count == 1:
            # Single press - LAUNCH bot
            if not bot_running:
                print("🚀 LAUNCH command - Starting bot")
                send_command("LAUNCH")
                blink_led(3, 0.1)
            else:
                print("ℹ️  Bot already running")
                blink_led(2, 0.1)
                
        elif press_count >= 2:
            # Double press - MANUAL RESTART
            print("🔄 MANUAL RESTART command")
            send_command("MANUAL_RESTART")
            blink_led(5, 0.1)
        
        press_count = 0

def process_message(msg):
    """Process incoming messages from server"""
    global last_heartbeat, server_alive, restart_triggered, bot_running
    
    msg = msg.strip()
    
    if msg == "HEARTBEAT":
        last_heartbeat = time.time()
        bot_running = True  # Bot is running if sending heartbeats
        if not server_alive:
            print("✅ Server recovered!")
            server_alive = True
            restart_triggered = False
        # Single quick blink on heartbeat
        led.on()
        time.sleep(0.05)
        led.off()
        
    elif msg == "BOT_STARTED":
        print("✅ Bot confirmed running")
        bot_running = True
        server_alive = True
        blink_led(2, 0.2)
        
    elif msg == "BOT_STOPPED":
        print("⚠️  Bot stopped")
        bot_running = False
        
    elif msg == "RESTART_ACK":
        print("✅ Server acknowledged restart")
        restart_triggered = False
        
    elif msg == "PING":
        send_command("PONG")

print("=" * 50)
print("🔒 Hardware Watchdog + Launcher Active")
print(f"⏱️  Timeout: {HEARTBEAT_TIMEOUT} seconds")
print(f"📡 UART: {BAUD_RATE} baud")
print(f"🔘 Button: BOOTSEL (built-in)")
print("")
print("Button Controls:")
print("  Single press:  Launch bot")
print("  Double press:  Restart bot")
print("")
print("Automatic:")
print("  Monitors heartbeat and auto-restarts on crash")
print("=" * 50)

# Startup blink pattern (3 quick blinks)
blink_led(3, 0.1)

# Main watchdog loop
while True:
    try:
        # Handle button input
        handle_button()
        
        # Check for incoming messages
        if uart.any():
            data = uart.read()
            if data:
                try:
                    message = data.decode('utf-8')
                    for line in message.split('\n'):
                        if line.strip():
                            process_message(line)
                except:
                    pass
        
        # Check heartbeat timeout (only if bot should be running)
        if bot_running:
            current_time = time.time()
            time_since_heartbeat = current_time - last_heartbeat
            
            if time_since_heartbeat > HEARTBEAT_TIMEOUT:
                if server_alive:
                    # Server has stopped responding
                    print(f"⚠️  NO HEARTBEAT for {time_since_heartbeat:.1f}s")
                    print("🚨 SERVER CRASH DETECTED!")
                    server_alive = False
                    
                    # SOS blink pattern (... --- ...)
                    for _ in range(3):
                        led.on()
                        time.sleep(0.1)
                        led.off()
                        time.sleep(0.1)
                    for _ in range(3):
                        led.on()
                        time.sleep(0.3)
                        led.off()
                        time.sleep(0.1)
                    for _ in range(3):
                        led.on()
                        time.sleep(0.1)
                        led.off()
                        time.sleep(0.1)
                
                if not restart_triggered:
                    # Trigger automatic restart
                    print("🔄 TRIGGERING AUTOMATIC RESTART")
                    send_command("AUTO_RESTART")
                    restart_triggered = True
                    
                    # Long blink to indicate restart triggered
                    led.on()
                    time.sleep(1)
                    led.off()
            
            elif not server_alive and time_since_heartbeat <= HEARTBEAT_TIMEOUT:
                # Heartbeat resumed
                print("✅ Server responding again")
                server_alive = True
                restart_triggered = False
                blink_led(2, 0.2)
            
            # Normal heartbeat blink when alive (don't interfere with button feedback)
            if server_alive and not button_was_pressed:
                if int(current_time) % 2 == 0:
                    led.on()
                else:
                    led.off()
        else:
            # Bot not running - slow blink to show waiting
            if int(time.time() * 0.5) % 2 == 0:
                led.on()
            else:
                led.off()
        
        time.sleep(0.1)
        
    except KeyboardInterrupt:
        print("\n👋 Watchdog stopped")
        led.off()
        sys.exit()
    except Exception as e:
        print(f"❌ Error: {e}")
        time.sleep(1)
