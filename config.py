import machine

# Network mode
# If running on Pico W, set WIFI_SSID/WIFI_PASSWORD.
# If running on Pico (non-W), set USE_ESP8266 = True and wire ESP8266 to UART.
USE_ESP8266 = True

WIFI_SSID = ""
WIFI_PASSWORD = ""

# ESP8266 AT UART settings (Pico UART0 is GP0 TX, GP1 RX by default)
ESP_UART_ID = 0
ESP_UART_BAUD = 115200
ESP_UART_TX = 0
ESP_UART_RX = 1
ESP_UART_TIMEOUT_MS = 2000

# Health endpoint configuration
HEALTH_URL = "http://127.0.0.1:3000/health"
EXPECTED_STATUS = "ok"
EXPECTED_INTEGRITY = "pass"

# Timing and retries
INTERVAL_S = 10
TIMEOUT_MS = 3000
RETRIES = 3
FAIL_THRESHOLD = 3
RECOVER_THRESHOLD = 2
HARD_FAIL_ON_INVALID = True

# GPIO pins
GPIO_FAIL_PIN = 15
GPIO_OK_PIN = 14

# Alerting and recovery endpoints
WEBHOOK_URL = ""
SHUTDOWN_URL = ""

# Optional headers for HTTP requests
HTTP_HEADERS = {
    "User-Agent": "pico-watchdog/1.0",
    "Accept": "application/json"
}


def get_pin(pin_number, default_value=0):
    if pin_number is None:
        return None
    pin = machine.Pin(pin_number, machine.Pin.OUT)
    pin.value(default_value)
    return pin
