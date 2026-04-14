"""
Nova — Weather Integration
=============================
Current weather + forecast via OpenWeather API, with automatic IP-based
geolocation so Nova always knows the weather for wherever Cayden currently is.

API docs: https://openweathermap.org/api
Geolocation: ip-api.com (free, no key needed)

Setup:
  1. Sign up at https://openweathermap.org/api
  2. Get a free API key (Current Weather is free)
  3. Add to jarvis/.env: OPENWEATHER_API_KEY=your-key-here
"""

import asyncio
import logging
import threading
import time
import httpx
from dataclasses import dataclass

logger = logging.getLogger(__name__)


async def get_location_from_ip() -> dict | None:
    """
    Detect current location via IP geolocation (ip-api.com — free, no key).
    Returns a dict with: city, region, country, lat, lon, timezone.
    Falls back to None if the request fails.
    """
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get("http://ip-api.com/json/", params={"fields": "status,city,regionName,country,lat,lon,timezone"})
            r.raise_for_status()
        data = r.json()
        if data.get("status") == "success":
            return {
                "city": data.get("city", "Unknown"),
                "region": data.get("regionName", ""),
                "country": data.get("country", ""),
                "lat": data.get("lat"),
                "lon": data.get("lon"),
                "timezone": data.get("timezone", ""),
            }
    except Exception as e:
        logger.warning(f"[Weather] IP geolocation failed: {e}")
    return None

API_BASE = "https://api.openweathermap.org/data/2.5"


@dataclass
class WeatherInfo:
    """Clean weather data."""
    temp_f: float
    feels_like_f: float
    temp_c: float
    humidity: int
    description: str
    icon: str
    wind_mph: float
    city: str
    country: str
    high_f: float
    low_f: float

    def summary(self) -> str:
        """One-line human-readable summary."""
        return (
            f"{self.temp_f:.0f}°F (feels like {self.feels_like_f:.0f}°F), "
            f"{self.description}. "
            f"High {self.high_f:.0f}°F, Low {self.low_f:.0f}°F. "
            f"Humidity {self.humidity}%, wind {self.wind_mph:.0f} mph."
        )

    def brief(self) -> str:
        """Short summary for voice."""
        return f"{self.temp_f:.0f}°F and {self.description}"


@dataclass
class ForecastDay:
    """Single day forecast."""
    date: str
    high_f: float
    low_f: float
    description: str
    icon: str


class WeatherClient:
    """OpenWeather API client."""

    def __init__(self, api_key: str, default_city: str = "Dallas", default_country: str = "US"):
        self._api_key = api_key
        self._default_city = default_city
        self._default_country = default_country

    def _parse_weather_response(self, data: dict, fallback_city: str) -> "WeatherInfo":
        main = data.get("main", {})
        weather = data.get("weather", [{}])[0]
        wind = data.get("wind", {})
        sys = data.get("sys", {})
        return WeatherInfo(
            temp_f=main.get("temp", 0),
            feels_like_f=main.get("feels_like", 0),
            temp_c=(main.get("temp", 0) - 32) * 5 / 9,
            humidity=main.get("humidity", 0),
            description=weather.get("description", "unknown"),
            icon=weather.get("icon", ""),
            wind_mph=wind.get("speed", 0),
            city=data.get("name", fallback_city),
            country=sys.get("country", ""),
            high_f=main.get("temp_max", 0),
            low_f=main.get("temp_min", 0),
        )

    async def get_current_by_coords(self, lat: float, lon: float) -> "WeatherInfo":
        """Get current weather by GPS coordinates (more accurate than city name)."""
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API_BASE}/weather", params={
                "lat": lat,
                "lon": lon,
                "appid": self._api_key,
                "units": "imperial",
            })
            r.raise_for_status()
        return self._parse_weather_response(r.json(), f"{lat},{lon}")

    async def get_current(self, city: str | None = None) -> "WeatherInfo":
        """Get current weather for a city (defaults to configured city)."""
        city = city or self._default_city
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API_BASE}/weather", params={
                "q": city,
                "appid": self._api_key,
                "units": "imperial",
            })
            r.raise_for_status()
        return self._parse_weather_response(r.json(), city)

    async def get_forecast(self, city: str | None = None, days: int = 3) -> list[ForecastDay]:
        """Get multi-day forecast (free tier: 5-day / 3-hour forecast)."""
        city = city or self._default_city
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API_BASE}/forecast", params={
                "q": city,
                "appid": self._api_key,
                "units": "imperial",
                "cnt": days * 8,  # 8 entries per day (3-hour intervals)
            })
            r.raise_for_status()
        data = r.json()

        # Group by date, get high/low/description per day
        daily: dict[str, dict] = {}
        for item in data.get("list", []):
            dt_txt = item.get("dt_txt", "")
            date = dt_txt.split(" ")[0] if dt_txt else ""
            if not date:
                continue
            main = item.get("main", {})
            weather = item.get("weather", [{}])[0]
            temp = main.get("temp", 0)

            if date not in daily:
                daily[date] = {
                    "high": temp, "low": temp,
                    "desc": weather.get("description", ""),
                    "icon": weather.get("icon", ""),
                }
            else:
                daily[date]["high"] = max(daily[date]["high"], temp)
                daily[date]["low"] = min(daily[date]["low"], temp)
                # Use midday description
                if "12:00:00" in dt_txt:
                    daily[date]["desc"] = weather.get("description", daily[date]["desc"])
                    daily[date]["icon"] = weather.get("icon", daily[date]["icon"])

        result = []
        for date, info in sorted(daily.items())[:days]:
            result.append(ForecastDay(
                date=date,
                high_f=info["high"],
                low_f=info["low"],
                description=info["desc"],
                icon=info["icon"],
            ))
        return result

    def format_forecast(self, forecast: list[ForecastDay]) -> str:
        """Format forecast as readable text."""
        lines = []
        for day in forecast:
            lines.append(
                f"• {day.date}: High {day.high_f:.0f}°F, Low {day.low_f:.0f}°F — {day.description}"
            )
        return "\n".join(lines)


class WeatherContextProvider:
    """
    Maintains a live, cached snapshot of current weather based on Cayden's
    real-time location (detected via IP geolocation).  Refreshes every 15
    minutes in a background daemon thread so chat responses are never delayed.

    Usage:
        provider = WeatherContextProvider(api_key="...")
        provider.start()               # kick off background refresh
        context = provider.get_prompt_context()  # call from prompt_builder
    """

    REFRESH_INTERVAL = 15 * 60  # seconds

    def __init__(self, api_key: str, fallback_city: str = "Dallas"):
        self._api_key = api_key
        self._fallback_city = fallback_city
        self._location: dict | None = None        # {city, region, country, lat, lon}
        self._weather: WeatherInfo | None = None  # latest weather snapshot
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    # ── Public interface ──────────────────────────────────────────────────────

    def start(self):
        """Fetch weather immediately, then refresh every 15 minutes."""
        # Run the first refresh synchronously (in a new event loop) so the
        # prompt builder has data before the first user message.
        self._thread = threading.Thread(target=self._loop, daemon=True, name="WeatherRefresh")
        self._thread.start()

    def get_prompt_context(self) -> str:
        """Return a one-paragraph weather string for the system prompt, or ''."""
        with self._lock:
            loc = self._location
            w = self._weather
        if not w:
            return ""
        loc_str = w.city
        if loc and loc.get("region"):
            loc_str = f"{w.city}, {loc['region']}"
        return (
            f"## Current Weather (live, auto-detected location)\n"
            f"Location: {loc_str} — {w.summary()}\n"
            f"Use this data whenever Cayden asks about weather, clothing, or outdoor conditions. "
            f"This updates automatically based on his current IP address, so it always reflects "
            f"where he is right now."
        )

    # ── Background refresh ────────────────────────────────────────────────────

    def _loop(self):
        while True:
            try:
                asyncio.run(self._refresh())
            except Exception as e:
                logger.warning(f"[Weather] Refresh error: {e}")
            time.sleep(self.REFRESH_INTERVAL)

    async def _refresh(self):
        client = WeatherClient(self._api_key, default_city=self._fallback_city)
        # 1. Detect location from IP
        loc = await get_location_from_ip()
        # 2. Fetch weather (prefer coords for accuracy, fall back to city name)
        try:
            if loc and loc.get("lat") is not None:
                weather = await client.get_current_by_coords(loc["lat"], loc["lon"])
            else:
                weather = await client.get_current()
        except Exception as e:
            logger.warning(f"[Weather] Weather fetch failed: {e}")
            return
        with self._lock:
            self._location = loc
            self._weather = weather
        city_label = (loc or {}).get("city", weather.city)
        logger.info(f"[Weather] Updated: {weather.summary()} @ {city_label}")

