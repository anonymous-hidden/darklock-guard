"""Weather connector — OpenWeather current + forecast."""
from __future__ import annotations
import os
import httpx
from .base import BaseConnector, ConnectorAction


class WeatherConnector(BaseConnector):
    name = "weather"
    description = "Current conditions and short-term forecast via OpenWeather."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.key = os.environ.get(self.cfg.get("api_key_env", "OPENWEATHER_API_KEY"), "")
        self.default_city = self.cfg.get("default_city", "New York")

    def is_configured(self) -> bool:
        return bool(self.key)

    def _register_actions(self) -> None:
        self.register(ConnectorAction("current", "Current weather", "read",
                                      handler=self._current))
        self.register(ConnectorAction("forecast", "5-day / 3h forecast", "read",
                                      handler=self._forecast))

    def _current(self, *, city: str | None = None) -> dict:
        c = city or self.default_city
        try:
            r = httpx.get("https://api.openweathermap.org/data/2.5/weather",
                          params={"q": c, "appid": self.key, "units": "metric"},
                          timeout=10)
            r.raise_for_status()
            d = r.json()
            return {"ok": True, "city": c,
                    "temp_c": d.get("main", {}).get("temp"),
                    "conditions": (d.get("weather") or [{}])[0].get("description", ""),
                    "humidity": d.get("main", {}).get("humidity"),
                    "wind_mps": d.get("wind", {}).get("speed")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _forecast(self, *, city: str | None = None, hours: int = 24) -> dict:
        c = city or self.default_city
        try:
            r = httpx.get("https://api.openweathermap.org/data/2.5/forecast",
                          params={"q": c, "appid": self.key, "units": "metric"},
                          timeout=10)
            r.raise_for_status()
            rows = r.json().get("list", [])[: max(1, hours // 3)]
            return {"ok": True, "city": c,
                    "entries": [{"time": x.get("dt_txt"),
                                 "temp_c": x.get("main", {}).get("temp"),
                                 "conditions": (x.get("weather") or [{}])[0].get("description", "")}
                                for x in rows]}
        except Exception as e:
            return {"ok": False, "error": str(e)}
