"""
Nova — Home Assistant Integration
===================================
Async REST client for Home Assistant.
Configure via environment variables:
  HA_URL=http://homeassistant.local:8123
  HA_TOKEN=<long-lived access token>
"""

import os
from typing import Any, Optional

try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False


class HomeAssistantError(Exception):
    pass


class HomeAssistant:
    """Async REST client for Home Assistant."""

    def __init__(self, url: str, token: str, timeout: float = 5.0):
        if not _HTTPX_AVAILABLE:
            raise ImportError("httpx is required for Home Assistant integration. Run: pip install httpx")
        self.url = url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    @classmethod
    def from_env(cls) -> Optional["HomeAssistant"]:
        """Create a client from HA_URL and HA_TOKEN environment variables.
        Returns None if either variable is not set."""
        url = os.getenv("HA_URL", "").strip()
        token = os.getenv("HA_TOKEN", "").strip()
        if not url or not token:
            return None
        return cls(url, token)

    async def _get(self, path: str) -> Any:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.get(f"{self.url}{path}", headers=self._headers)
            r.raise_for_status()
            return r.json()

    async def _post(self, path: str, payload: dict) -> Any:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(f"{self.url}{path}", headers=self._headers, json=payload)
            r.raise_for_status()
            return r.json()

    # ── Read operations ──

    async def get_states(self) -> list[dict]:
        """Return all entity states from Home Assistant."""
        return await self._get("/api/states")

    async def get_entity_state(self, entity_id: str) -> dict:
        """Return the state of a single entity."""
        return await self._get(f"/api/states/{entity_id}")

    async def is_available(self) -> bool:
        """Check if HA is reachable."""
        try:
            await self._get("/api/")
            return True
        except Exception:
            return False

    # ── Service calls ──

    async def call_service(self, domain: str, service: str,
                           entity_id: str, **kwargs) -> dict:
        """Call a HA service. Additional kwargs are passed as service data."""
        payload = {"entity_id": entity_id, **kwargs}
        states = await self._post(f"/api/services/{domain}/{service}", payload)
        return {"ok": True, "updated_states": states}

    async def toggle(self, entity_id: str) -> dict:
        domain = entity_id.split(".")[0]
        return await self.call_service(domain, "toggle", entity_id)

    async def turn_on(self, entity_id: str, **kwargs) -> dict:
        domain = entity_id.split(".")[0]
        return await self.call_service(domain, "turn_on", entity_id, **kwargs)

    async def turn_off(self, entity_id: str) -> dict:
        domain = entity_id.split(".")[0]
        return await self.call_service(domain, "turn_off", entity_id)

    async def set_brightness(self, entity_id: str, brightness_pct: int) -> dict:
        """Set light brightness (0-100%)."""
        return await self.call_service(
            "light", "turn_on", entity_id,
            brightness_pct=max(0, min(100, brightness_pct)),
        )

    async def set_color_temp(self, entity_id: str, kelvin: int) -> dict:
        """Set light color temperature in Kelvin."""
        return await self.call_service("light", "turn_on", entity_id, kelvin=kelvin)

    async def set_rgb_color(self, entity_id: str, r: int, g: int, b: int) -> dict:
        """Set light RGB color."""
        return await self.call_service(
            "light", "turn_on", entity_id,
            rgb_color=[max(0, min(255, v)) for v in (r, g, b)],
        )

    # ── Summary helpers ──

    async def get_lights(self) -> list[dict]:
        """Return all light entities."""
        states = await self.get_states()
        return [s for s in states if s.get("entity_id", "").startswith("light.")]

    async def get_switches(self) -> list[dict]:
        """Return all switch entities."""
        states = await self.get_states()
        return [s for s in states if s.get("entity_id", "").startswith("switch.")]

    async def get_sensors(self) -> list[dict]:
        """Return all sensor entities."""
        states = await self.get_states()
        return [s for s in states if s.get("entity_id", "").startswith("sensor.")]

    async def summary(self) -> dict:
        """High-level summary: counts by domain and quick on/off stats."""
        try:
            states = await self.get_states()
        except Exception as e:
            return {"available": False, "error": str(e)}

        by_domain: dict[str, list] = {}
        for s in states:
            domain = s.get("entity_id", "unknown.x").split(".")[0]
            by_domain.setdefault(domain, []).append(s)

        lights = by_domain.get("light", [])
        switches_on = [s for s in by_domain.get("switch", []) if s.get("state") == "on"]

        return {
            "available": True,
            "total_entities": len(states),
            "lights_total": len(lights),
            "lights_on": sum(1 for l in lights if l.get("state") == "on"),
            "switches_on": len(switches_on),
            "domains": {d: len(v) for d, v in by_domain.items()},
        }
