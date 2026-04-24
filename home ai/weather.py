"""
Home AI - National Weather Service Integration
================================================
Uses the free NWS API (api.weather.gov) — no API key required.
A User-Agent header is mandatory per NWS policy; set NWS_USER_AGENT in .env.

NWS API flow:
  1. GET /points/{lat},{lon}     → resolves location, returns forecast URLs
  2. GET <forecastUrl>           → 7-day period forecast
  3. GET <forecastHourlyUrl>     → hourly forecast
  4. GET /alerts/active?area={state_code} → active alerts

All requests are GET-only, read-only, and unauthenticated.
"""

import os
from typing import Any

import httpx


class NWSWeatherError(Exception):
    """Raised when the NWS API returns an unexpected response."""


class NWSClient:
    """
    Thin async wrapper around the National Weather Service public API.

    Usage:
        async with NWSClient() as client:
            result = await client.get_forecast(lat=38.9, lon=-77.0)
    """

    BASE_URL = "https://api.weather.gov"
    TIMEOUT = 10  # seconds

    def __init__(self):
        user_agent = os.environ.get("NWS_USER_AGENT", "(HomeAI, unknown)")
        self._headers = {
            "User-Agent": user_agent,
            "Accept": "application/geo+json",
        }
        # NWS is rolling out optional API-Key support on some endpoints.
        # Include it when set — the API works fine without it.
        api_key = os.environ.get("NWS_API_KEY", "").strip()
        if api_key:
            self._headers["API-Key"] = api_key
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "NWSClient":
        self._client = httpx.AsyncClient(
            headers=self._headers,
            timeout=self.TIMEOUT,
            follow_redirects=True,
        )
        return self

    async def __aexit__(self, *_) -> None:
        if self._client:
            await self._client.aclose()

    async def _get(self, url: str, params: dict | None = None) -> dict:
        """Make a GET request and return parsed JSON. Raises NWSWeatherError on failure."""
        if self._client is None:
            raise RuntimeError("NWSClient must be used as an async context manager")
        resp = await self._client.get(url, params=params)
        if resp.status_code == 404:
            raise NWSWeatherError(f"NWS returned 404 for {url} — coordinates may be outside the US")
        if resp.status_code != 200:
            raise NWSWeatherError(f"NWS API error {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def _resolve_point(self, lat: float, lon: float) -> dict:
        """Call /points/{lat},{lon} to get metadata and forecast URLs for a location."""
        # NWS requires exactly 4 decimal places
        url = f"{self.BASE_URL}/points/{lat:.4f},{lon:.4f}"
        data = await self._get(url)
        props = data.get("properties", {})
        return {
            "forecast_url": props.get("forecast"),
            "forecast_hourly_url": props.get("forecastHourly"),
            "city": props.get("relativeLocation", {}).get("properties", {}).get("city", "Unknown"),
            "state": props.get("relativeLocation", {}).get("properties", {}).get("state", ""),
            "grid_id": props.get("gridId"),
            "cwa": props.get("cwa"),
        }

    async def get_forecast(self, lat: float, lon: float) -> dict[str, Any]:
        """
        Get the 7-day forecast for a lat/lon coordinate.

        Returns:
            {
                "location": {"city": str, "state": str},
                "periods": [
                    {
                        "name": str,           # e.g. "Tonight", "Wednesday"
                        "temperature": int,
                        "temperature_unit": str,
                        "wind_speed": str,
                        "wind_direction": str,
                        "short_forecast": str,
                        "detailed_forecast": str,
                        "is_daytime": bool,
                    },
                    ...
                ]
            }
        """
        point = await self._resolve_point(lat, lon)
        forecast_url = point.get("forecast_url")
        if not forecast_url:
            raise NWSWeatherError("NWS did not return a forecast URL for this location")

        data = await self._get(forecast_url)
        raw_periods = data.get("properties", {}).get("periods", [])

        periods = [
            {
                "name": p.get("name"),
                "temperature": p.get("temperature"),
                "temperature_unit": p.get("temperatureUnit"),
                "wind_speed": p.get("windSpeed"),
                "wind_direction": p.get("windDirection"),
                "short_forecast": p.get("shortForecast"),
                "detailed_forecast": p.get("detailedForecast"),
                "is_daytime": p.get("isDaytime", True),
            }
            for p in raw_periods
        ]

        return {
            "location": {"city": point["city"], "state": point["state"]},
            "periods": periods,
        }

    async def get_hourly_forecast(self, lat: float, lon: float, hours: int = 12) -> dict[str, Any]:
        """
        Get hourly forecast for the next `hours` hours.

        Returns:
            {
                "location": {"city": str, "state": str},
                "hours": [
                    {
                        "start_time": str,     # ISO 8601
                        "temperature": int,
                        "temperature_unit": str,
                        "wind_speed": str,
                        "short_forecast": str,
                    },
                    ...
                ]
            }
        """
        point = await self._resolve_point(lat, lon)
        hourly_url = point.get("forecast_hourly_url")
        if not hourly_url:
            raise NWSWeatherError("NWS did not return an hourly forecast URL for this location")

        data = await self._get(hourly_url)
        raw_periods = data.get("properties", {}).get("periods", [])[:hours]

        return {
            "location": {"city": point["city"], "state": point["state"]},
            "hours": [
                {
                    "start_time": p.get("startTime"),
                    "temperature": p.get("temperature"),
                    "temperature_unit": p.get("temperatureUnit"),
                    "wind_speed": p.get("windSpeed"),
                    "short_forecast": p.get("shortForecast"),
                }
                for p in raw_periods
            ],
        }

    async def get_alerts(self, state: str) -> dict[str, Any]:
        """
        Get active weather alerts for a US state.

        Args:
            state: Two-letter state code, e.g. "VA", "TX"

        Returns:
            {
                "state": str,
                "alert_count": int,
                "alerts": [
                    {
                        "event": str,          # e.g. "Tornado Warning"
                        "headline": str,
                        "severity": str,       # "Extreme", "Severe", "Moderate", "Minor"
                        "urgency": str,
                        "areas": str,
                        "description": str,
                    },
                    ...
                ]
            }
        """
        data = await self._get(
            f"{self.BASE_URL}/alerts/active",
            params={"area": state.upper()},
        )
        features = data.get("features", [])

        alerts = [
            {
                "event": f.get("properties", {}).get("event"),
                "headline": f.get("properties", {}).get("headline"),
                "severity": f.get("properties", {}).get("severity"),
                "urgency": f.get("properties", {}).get("urgency"),
                "areas": f.get("properties", {}).get("areaDesc"),
                "description": f.get("properties", {}).get("description", "")[:500],
            }
            for f in features
        ]

        return {
            "state": state.upper(),
            "alert_count": len(alerts),
            "alerts": alerts,
        }
