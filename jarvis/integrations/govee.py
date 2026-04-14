"""
Nova — Govee Light Integration
================================
Controls Govee smart lights via the Govee Open API v2.
Supports: on/off, brightness, color, color temperature, device listing.
Finds ALL devices (v1 only found ~3; v2 finds all device types).

API docs: https://developer.govee.com/docs
Rate limit: 10,000 requests per day.
"""

import asyncio
import httpx
import uuid
from dataclasses import dataclass, field

API_BASE = "https://openapi.api.govee.com/router/api/v1"

# Capability type constants
CAP_ON_OFF = "devices.capabilities.on_off"
CAP_BRIGHTNESS = "devices.capabilities.range"
CAP_COLOR = "devices.capabilities.color_setting"
CAP_SEGMENT = "devices.capabilities.segment_color_setting"


@dataclass
class GoveeDevice:
    device_id: str   # MAC address string
    sku: str         # model number (e.g. H70C2)
    name: str
    capabilities: list[dict] = field(default_factory=list)

    def has_cap(self, cap_type: str) -> bool:
        return any(c["type"] == cap_type for c in self.capabilities)

    def supports_color(self) -> bool:
        return self.has_cap(CAP_COLOR)

    def supports_brightness(self) -> bool:
        return self.has_cap(CAP_BRIGHTNESS)


class GoveeClient:
    """Async client for the Govee Open API v2 (finds all device types)."""

    def __init__(self, api_key: str):
        self._headers = {
            "Govee-API-Key": api_key,
            "Content-Type": "application/json",
        }
        self._cache: list[GoveeDevice] | None = None

    async def get_devices(self) -> list[GoveeDevice]:
        """Fetch all Govee devices linked to this API key."""
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{API_BASE}/user/devices", headers=self._headers)
                r.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Govee API error fetching devices: HTTP {e.response.status_code}") from e
        except httpx.TimeoutException:
            raise RuntimeError("Govee API timed out fetching device list — check your internet connection") from None
        except httpx.ConnectError as e:
            raise RuntimeError(f"Govee API connection failed: {e}") from e
        self._cache = []
        for d in r.json().get("data", []):
            self._cache.append(GoveeDevice(
                device_id=d["device"],
                sku=d["sku"],
                name=d.get("deviceName", d["device"]),
                capabilities=d.get("capabilities", []),
            ))
        return self._cache

    async def _ensure_cache(self):
        if self._cache is None:
            await self.get_devices()

    async def control(self, device: "GoveeDevice", cap_type: str,
                      instance: str, value, retries: int = 2) -> bool:
        """Send a control command to a single device via v2 API with retry."""
        payload = {
            "requestId": str(uuid.uuid4()),
            "payload": {
                "sku": device.sku,
                "device": device.device_id,
                "capability": {
                    "type": cap_type,
                    "instance": instance,
                    "value": value,
                },
            },
        }
        last_err = None
        for attempt in range(retries + 1):
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.post(
                        f"{API_BASE}/device/control",
                        headers=self._headers,
                        json=payload,
                    )
                    if r.status_code != 200:
                        body = r.text[:200]
                        last_err = RuntimeError(f"Govee API {r.status_code} for {device.name}: {body}")
                        if attempt < retries:
                            await asyncio.sleep(0.5 * (attempt + 1))
                            continue
                        raise last_err
                    resp = r.json()
                    if resp.get("code") != 200:
                        msg = resp.get('msg') or resp.get('message') or str(resp)
                        last_err = RuntimeError(f"Govee API error for {device.name}: {msg}")
                        if attempt < retries:
                            await asyncio.sleep(0.5 * (attempt + 1))
                            continue
                        raise last_err
                return True
            except httpx.TimeoutException:
                last_err = RuntimeError(f"Govee API timeout for {device.name}")
                if attempt < retries:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
        if last_err:
            raise last_err
        return False

    # ── Per-device commands ──────────────────────────

    async def turn_on(self, device: "GoveeDevice") -> bool:
        return await self.control(device, CAP_ON_OFF, "powerSwitch", 1)

    async def turn_off(self, device: "GoveeDevice") -> bool:
        return await self.control(device, CAP_ON_OFF, "powerSwitch", 0)

    async def set_brightness(self, device: "GoveeDevice", brightness: int) -> bool:
        brightness = max(1, min(100, brightness))
        return await self.control(device, CAP_BRIGHTNESS, "brightness", brightness)

    async def set_color(self, device: "GoveeDevice", r: int, g: int, b: int) -> bool:
        # v2 API uses a single decimal integer: R*65536 + G*256 + B
        value = r * 65536 + g * 256 + b
        return await self.control(device, CAP_COLOR, "colorRgb", value)

    async def set_color_temp(self, device: "GoveeDevice", temp: int) -> bool:
        return await self.control(device, CAP_COLOR, "colorTemInKelvin", temp)

    async def set_segment_color(self, device: "GoveeDevice",
                                segments: list[int], r: int, g: int, b: int) -> bool:
        """Set color on specific segments of an RGBIC device."""
        value = {"segment": segments, "rgb": r * 65536 + g * 256 + b}
        return await self.control(device, CAP_SEGMENT, "segmentedColorRgb", value)

    async def set_segment_brightness(self, device: "GoveeDevice",
                                     segments: list[int], brightness: int) -> bool:
        """Set brightness on specific segments of an RGBIC device."""
        value = {"segment": segments, "brightness": max(0, min(100, brightness))}
        return await self.control(device, CAP_SEGMENT, "segmentedBrightness", value)

    # ── Bulk commands (all devices in parallel) ──────

    async def _bulk_control(self, action, targets):
        """Run a control action on multiple targets with staggered timing to avoid rate limits."""
        # Send in small batches to avoid API rate limits
        batch_size = 5
        results = []
        for i in range(0, len(targets), batch_size):
            batch = targets[i:i + batch_size]
            batch_results = await asyncio.gather(
                *[action(d) for d in batch], return_exceptions=True
            )
            results.extend(zip(batch, batch_results))
            if i + batch_size < len(targets):
                await asyncio.sleep(0.3)  # Small delay between batches
        succeeded = [d.name for d, r in results if not isinstance(r, Exception)]
        failed = [d.name for d, r in results if isinstance(r, Exception)]
        if failed:
            fail_details = [f"{d.name}: {r}" for d, r in results if isinstance(r, Exception)]
            print(f"[GOVEE] failures: {fail_details}", flush=True)
        return succeeded, failed

    async def turn_on_all(self) -> tuple[list[str], list[str]]:
        """Turn on every device. Returns (succeeded, failed) name lists."""
        await self._ensure_cache()
        targets = [d for d in self._cache if d.has_cap(CAP_ON_OFF)]
        return await self._bulk_control(self.turn_on, targets)

    async def turn_off_all(self) -> tuple[list[str], list[str]]:
        """Turn off every device. Returns (succeeded, failed) name lists."""
        await self._ensure_cache()
        targets = [d for d in self._cache if d.has_cap(CAP_ON_OFF)]
        return await self._bulk_control(self.turn_off, targets)

    async def set_brightness_all(self, brightness: int) -> tuple[list[str], list[str]]:
        await self._ensure_cache()
        targets = [d for d in self._cache if d.supports_brightness()]
        return await self._bulk_control(lambda d: self.set_brightness(d, brightness), targets)

    async def set_color_all(self, r: int, g: int, b: int) -> tuple[list[str], list[str]]:
        await self._ensure_cache()
        targets = [d for d in self._cache if d.supports_color()]
        return await self._bulk_control(lambda d: self.set_color(d, r, g, b), targets)

    # ── Helpers ────────────────────────────────────────

    async def find_device(self, name_or_id: str) -> "GoveeDevice | None":
        """Find a device by name (fuzzy) or exact device ID."""
        await self._ensure_cache()
        name_lower = name_or_id.lower().strip()
        for d in self._cache:
            if d.device_id == name_or_id:
                return d
            if name_lower in d.name.lower():
                return d
        # partial word match
        for d in self._cache:
            if any(w in d.name.lower() for w in name_lower.split()):
                return d
        return None

    async def find_device_or_first(self, name_or_id: str | None) -> "GoveeDevice | None":
        """Find by name/id, or return the first device if none specified."""
        await self._ensure_cache()
        if name_or_id:
            return await self.find_device(name_or_id)
        return self._cache[0] if self._cache else None


def parse_color(color_str: str) -> tuple[int, int, int]:
    """Parse a color string: hex (#FF0000), name (red, blue, etc), or r,g,b."""
    color_str = color_str.strip().lower()

    # Named colors
    named = {
        "red":       (255, 0, 0),
        "green":     (0, 255, 0),
        "blue":      (0, 0, 255),
        "white":     (255, 255, 255),
        "warm white": (255, 200, 150),
        "yellow":    (255, 255, 0),
        "orange":    (255, 165, 0),
        "purple":    (128, 0, 128),
        "pink":      (255, 105, 180),
        "cyan":      (0, 255, 255),
        "teal":      (0, 128, 128),
        "magenta":   (255, 0, 255),
        "lime":      (0, 255, 0),
        "indigo":    (75, 0, 130),
        "violet":    (138, 43, 226),
        "coral":     (255, 127, 80),
        "gold":      (255, 215, 0),
        "lavender":  (200, 160, 255),
        "turquoise": (64, 224, 208),
        "salmon":    (250, 128, 114),
        "sky blue":  (135, 206, 235),
    }
    if color_str in named:
        return named[color_str]

    # Hex: #RRGGBB or RRGGBB
    hex_str = color_str.lstrip("#")
    if len(hex_str) == 6:
        try:
            r = int(hex_str[0:2], 16)
            g = int(hex_str[2:4], 16)
            b = int(hex_str[4:6], 16)
            return (r, g, b)
        except ValueError:
            pass

    # CSV: r,g,b
    parts = color_str.replace(" ", "").split(",")
    if len(parts) == 3:
        try:
            return (int(parts[0]), int(parts[1]), int(parts[2]))
        except ValueError:
            pass

    raise ValueError(f"Can't parse color: '{color_str}'. Use a name (red, blue), hex (#FF0000), or r,g,b.")
