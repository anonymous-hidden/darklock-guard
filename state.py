import time

STATE_OK = "OK"
STATE_DEGRADED = "DEGRADED"
STATE_FAIL = "FAIL"


class WatchdogState:
    def __init__(self, fail_threshold=3, recover_threshold=2):
        self.state = STATE_OK
        self.fail_streak = 0
        self.ok_streak = 0
        self.last_change = time.time()
        self.fail_threshold = fail_threshold
        self.recover_threshold = recover_threshold

    def update(self, healthy, hard_fail=False):
        prev = self.state
        if healthy:
            self.fail_streak = 0
            if self.state != STATE_OK:
                self.ok_streak += 1
                if self.ok_streak >= self.recover_threshold:
                    self.state = STATE_OK
                    self.ok_streak = 0
                    self.last_change = time.time()
            else:
                self.ok_streak = 0
        else:
            self.ok_streak = 0
            self.fail_streak += 1
            if hard_fail or self.fail_streak >= self.fail_threshold:
                self.state = STATE_FAIL
            else:
                self.state = STATE_DEGRADED
            if self.state != prev:
                self.last_change = time.time()

        return self.state, self.state != prev

    def format_alert_message(self, state, result):
        reason = result.get("reason") or "unknown"
        latency = result.get("latency_ms")
        code = result.get("status_code")
        data = result.get("data")
        msg = f"Watchdog state: {state}. Reason: {reason}."
        if code is not None:
            msg += f" HTTP {code}."
        if latency is not None:
            msg += f" Latency {latency}ms."
        if data:
            msg += f" Data: {data}."
        return msg
