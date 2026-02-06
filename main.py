import time
import config
from state import WatchdogState
from network import NetworkManager


def set_pin(pin, value):
    if pin is None:
        return
    try:
        pin.value(1 if value else 0)
    except Exception:
        pass


def main():
    net = NetworkManager(config)
    state = WatchdogState(
        fail_threshold=config.FAIL_THRESHOLD,
        recover_threshold=config.RECOVER_THRESHOLD,
    )

    # Configure pins
    fail_pin = config.get_pin(config.GPIO_FAIL_PIN, default_value=0)
    ok_pin = config.get_pin(config.GPIO_OK_PIN, default_value=1)

    # Initial state
    set_pin(ok_pin, True)
    set_pin(fail_pin, False)

    last_alert_state = None

    # Ensure network is ready
    net.connect()

    while True:
        start = time.ticks_ms()
        result = net.check_health()

        new_state, changed = state.update(
            healthy=result["healthy"],
            hard_fail=result["hard_fail"],
        )

        # Drive GPIO based on state
        if new_state == "OK":
            set_pin(ok_pin, True)
            set_pin(fail_pin, False)
        elif new_state == "DEGRADED":
            # Blink OK pin to show degraded
            set_pin(fail_pin, False)
            set_pin(ok_pin, True)
            time.sleep_ms(150)
            set_pin(ok_pin, False)
        else:
            set_pin(ok_pin, False)
            set_pin(fail_pin, True)

        # Alerts on state change
        if changed:
            msg = state.format_alert_message(new_state, result)
            if config.WEBHOOK_URL:
                net.send_webhook(msg)
            if new_state == "FAIL" and config.SHUTDOWN_URL:
                net.send_shutdown_request(msg)

        last_alert_state = new_state

        # Sleep remainder of interval
        elapsed = time.ticks_diff(time.ticks_ms(), start)
        sleep_ms = max(0, int(config.INTERVAL_S * 1000) - elapsed)
        time.sleep_ms(sleep_ms)


if __name__ == "__main__":
    main()
