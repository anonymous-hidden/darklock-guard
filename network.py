import time
import ujson


def _ticks_ms():
    return time.ticks_ms()


def _ticks_diff(a, b):
    return time.ticks_diff(a, b)


def _parse_url(url):
    if not url.startswith("http://") and not url.startswith("https://"):
        raise ValueError("Only http/https URLs supported")
    scheme, rest = url.split("://", 1)
    if "/" in rest:
        host_port, path = rest.split("/", 1)
        path = "/" + path
    else:
        host_port = rest
        path = "/"
    if ":" in host_port:
        host, port = host_port.split(":", 1)
        port = int(port)
    else:
        host = host_port
        port = 443 if scheme == "https" else 80
    return scheme, host, port, path


class NetworkManager:
    def __init__(self, config):
        self.cfg = config
        self.wlan = None
        self.uart = None
        self.using_wifi = False
        self.using_esp = False
        self._setup_network()

    def _setup_network(self):
        try:
            import network
            if hasattr(network, "WLAN"):
                self.wlan = network.WLAN(network.STA_IF)
                self.using_wifi = True
                self.using_esp = False
                return
        except Exception:
            pass

        # Fallback to ESP8266 AT
        if self.cfg.USE_ESP8266:
            import machine
            self.uart = machine.UART(
                self.cfg.ESP_UART_ID,
                baudrate=self.cfg.ESP_UART_BAUD,
                tx=self.cfg.ESP_UART_TX,
                rx=self.cfg.ESP_UART_RX,
                timeout=self.cfg.ESP_UART_TIMEOUT_MS
            )
            self.using_esp = True
            self.using_wifi = False

    def connect(self):
        if self.using_wifi:
            if not self.cfg.WIFI_SSID:
                raise RuntimeError("WIFI_SSID is empty in config.py")
            if not self.wlan.active():
                self.wlan.active(True)
            if not self.wlan.isconnected():
                self.wlan.connect(self.cfg.WIFI_SSID, self.cfg.WIFI_PASSWORD)
                start = _ticks_ms()
                while not self.wlan.isconnected():
                    if _ticks_diff(_ticks_ms(), start) > 15000:
                        raise RuntimeError("Wi-Fi connect timeout")
                    time.sleep_ms(200)
        elif self.using_esp:
            if not self.cfg.WIFI_SSID:
                raise RuntimeError("WIFI_SSID is empty in config.py")
            self._esp_init()
        else:
            raise RuntimeError("No network interface available")

    def _esp_cmd(self, cmd, expect="OK", timeout_ms=2000):
        self.uart.write(cmd + "\r\n")
        start = _ticks_ms()
        buf = b""
        while _ticks_diff(_ticks_ms(), start) < timeout_ms:
            if self.uart.any():
                buf += self.uart.read()
                if expect.encode() in buf:
                    return buf
        return buf

    def _esp_init(self):
        self._esp_cmd("AT")
        self._esp_cmd("ATE0")
        self._esp_cmd("AT+CWMODE=1")
        self._esp_cmd(f'AT+CWJAP="{self.cfg.WIFI_SSID}","{self.cfg.WIFI_PASSWORD}"', expect="WIFI CONNECTED", timeout_ms=15000)
        self._esp_cmd("AT+CIPMUX=0")

    def http_get(self, url, timeout_ms=None):
        if timeout_ms is None:
            timeout_ms = self.cfg.TIMEOUT_MS
        if self.using_wifi:
            return self._wifi_http("GET", url, None, timeout_ms)
        return self._esp_http("GET", url, None, timeout_ms)

    def http_post(self, url, json_body, timeout_ms=None):
        if timeout_ms is None:
            timeout_ms = self.cfg.TIMEOUT_MS
        body = ujson.dumps(json_body)
        if self.using_wifi:
            return self._wifi_http("POST", url, body, timeout_ms)
        return self._esp_http("POST", url, body, timeout_ms)

    def _wifi_http(self, method, url, body, timeout_ms):
        try:
            import urequests
            headers = self.cfg.HTTP_HEADERS.copy() if hasattr(self.cfg, "HTTP_HEADERS") else {}
            if method == "POST":
                headers["Content-Type"] = "application/json"
                res = urequests.post(url, data=body, headers=headers)
            else:
                res = urequests.get(url, headers=headers)
            text = res.text
            status = res.status_code
            res.close()
            return status, text
        except Exception as e:
            return None, str(e)

    def _esp_http(self, method, url, body, timeout_ms):
        scheme, host, port, path = _parse_url(url)
        if scheme != "http":
            return None, "ESP8266 AT supports http only"
        self._esp_cmd("AT+CIPCLOSE", expect="OK", timeout_ms=500)
        self._esp_cmd(f'AT+CIPSTART="TCP","{host}",{port}', expect="CONNECT", timeout_ms=5000)

        headers = self.cfg.HTTP_HEADERS.copy() if hasattr(self.cfg, "HTTP_HEADERS") else {}
        headers["Host"] = host
        if method == "POST":
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        req = f"{method} {path} HTTP/1.1\r\n" + "\r\n".join([f"{k}: {v}" for k, v in headers.items()]) + "\r\n\r\n"
        if method == "POST":
            req += body

        self._esp_cmd(f"AT+CIPSEND={len(req)}", expect=">", timeout_ms=2000)
        self.uart.write(req)

        start = _ticks_ms()
        buf = b""
        while _ticks_diff(_ticks_ms(), start) < timeout_ms:
            if self.uart.any():
                buf += self.uart.read()
                if b"\r\n\r\n" in buf:
                    break
        text = buf.decode(errors="ignore")
        status = None
        if "HTTP/1.1" in text:
            try:
                status = int(text.split("HTTP/1.1", 1)[1].strip().split(" ", 1)[0])
            except Exception:
                status = None
        self._esp_cmd("AT+CIPCLOSE", expect="OK", timeout_ms=500)
        return status, text

    def check_health(self):
        start = _ticks_ms()
        last_reason = None
        for attempt in range(self.cfg.RETRIES):
            status, body = self.http_get(self.cfg.HEALTH_URL, timeout_ms=self.cfg.TIMEOUT_MS)
            if status is None:
                last_reason = "timeout_or_network"
            else:
                ok, hard_fail, reason, data = self._parse_health(body, status)
                latency = _ticks_diff(_ticks_ms(), start)
                if ok:
                    return {
                        "healthy": True,
                        "hard_fail": False,
                        "reason": "ok",
                        "status_code": status,
                        "latency_ms": latency,
                        "data": data
                    }
                last_reason = reason
                if hard_fail:
                    return {
                        "healthy": False,
                        "hard_fail": True,
                        "reason": reason,
                        "status_code": status,
                        "latency_ms": latency,
                        "data": data
                    }
            time.sleep_ms(200)

        latency = _ticks_diff(_ticks_ms(), start)
        return {
            "healthy": False,
            "hard_fail": False,
            "reason": last_reason or "unhealthy",
            "status_code": None,
            "latency_ms": latency,
            "data": None
        }

    def _parse_health(self, body, status_code):
        if status_code != 200:
            return False, self.cfg.HARD_FAIL_ON_INVALID, "bad_status", None
        try:
            data = ujson.loads(body)
        except Exception:
            return False, self.cfg.HARD_FAIL_ON_INVALID, "invalid_json", None

        status = str(data.get("status", "")).lower()
        integrity = str(data.get("integrity", "")).lower()

        if status != self.cfg.EXPECTED_STATUS:
            return False, False, "status_not_ok", data
        if integrity != self.cfg.EXPECTED_INTEGRITY:
            return False, True, "integrity_fail", data

        return True, False, "ok", data

    def send_webhook(self, message):
        payload = {"content": message}
        self.http_post(self.cfg.WEBHOOK_URL, payload, timeout_ms=self.cfg.TIMEOUT_MS)

    def send_shutdown_request(self, message):
        payload = {"reason": message}
        self.http_post(self.cfg.SHUTDOWN_URL, payload, timeout_ms=self.cfg.TIMEOUT_MS)
