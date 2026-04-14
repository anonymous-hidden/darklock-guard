"""
Nova — Light Scene Engine
===========================
Orchestrates cinematic light shows across Govee devices with
staggered zone-to-zone flow (LEFT → CENTER → RIGHT).

Devices are mapped to logical zones so scenes are written in terms
of zones, not hardware.  The runner translates zones into the
correct Govee API calls (whole-device color OR segment color).
"""

import asyncio
from dataclasses import dataclass, field
from integrations.govee import GoveeClient, GoveeDevice

# ── Zone ↔ Device Mapping ───────────────────────────────────
# Adjust segment indices if your physical wiring differs.

ZONE_MAP = {
    # Whole-device color (has colorRgb)
    "curtain":    {"device": "Curtain Lights"},
    "star":       {"device": "Star Light Projector", "brightness_only": True},

    # Segment-addressed zones (RGBIC Spotlights has 4 heads)
    "left_spot":  {"device": "RGBIC Spotlights", "segments": [0, 1]},
    "right_spot": {"device": "RGBIC Spotlights", "segments": [2, 3]},

    # Strip Light split into bed (left) and desk (right)
    "bed_strip":  {"device": "Strip Light", "segments": [0, 1, 2, 3, 4, 5, 6]},
    "desk_strip": {"device": "Strip Light", "segments": [7, 8, 9, 10, 11, 12, 13, 14]},
}

# The ORDER in which zones receive each new keyframe.
# This creates the left-to-right sweep the user asked for.
FLOW_ORDER = ["left_spot", "bed_strip", "curtain", "desk_strip", "right_spot", "star"]
FLOW_DELAY = 0.5  # seconds stagger between each zone (start times, not wait-for-complete)


# ── Keyframe definition ─────────────────────────────────────

@dataclass
class ZoneState:
    r: int = 0
    g: int = 0
    b: int = 0
    brightness: int = 80


@dataclass
class Keyframe:
    """One moment in a scene.  *hold* = seconds before the next sweep starts."""
    zones: dict[str, ZoneState]
    hold: float = 20.0


# ═══════════════════════════════════════════════════════════
#  SCENE LIBRARY
# ═══════════════════════════════════════════════════════════

def _kf(hold: float, **zones) -> Keyframe:
    """Shorthand: _kf(20, curtain=(r,g,b,bri), left_spot=(r,g,b,bri), ...)"""
    parsed = {}
    for name, vals in zones.items():
        if len(vals) == 4:
            parsed[name] = ZoneState(*vals)
        else:  # (brightness,) for brightness-only zones like star
            parsed[name] = ZoneState(brightness=vals[0])
    return Keyframe(zones=parsed, hold=hold)


SCENES: dict[str, list[Keyframe]] = {}

# ── Cosmic Flow ──────────────────────────────────────────
# Deep space: indigos, cyans, magentas flowing left→right.
SCENES["cosmic_flow"] = [
    _kf(8,
        left_spot  =(0, 40, 180, 90),
        curtain    =(75, 0, 130, 80),
        right_spot =(0, 150, 150, 50),
        bed_strip  =(20, 0, 80, 35),
        desk_strip =(0, 80, 160, 55),
        star       =(60,)),
    _kf(8,
        left_spot  =(0, 220, 255, 100),    # cyan surge
        curtain    =(80, 20, 200, 85),
        right_spot =(0, 80, 100, 40),
        bed_strip  =(10, 10, 60, 30),
        desk_strip =(60, 0, 120, 60),
        star       =(75,)),
    _kf(8,
        left_spot  =(100, 0, 180, 70),
        curtain    =(200, 0, 150, 100),    # magenta bloom
        right_spot =(0, 100, 200, 55),
        bed_strip  =(60, 0, 100, 40),
        desk_strip =(0, 120, 255, 70),
        star       =(85,)),
    _kf(8,
        left_spot  =(0, 30, 120, 50),
        curtain    =(120, 0, 180, 75),
        right_spot =(0, 200, 180, 95),     # teal arrival
        bed_strip  =(20, 0, 50, 30),
        desk_strip =(200, 0, 100, 80),
        star       =(90,)),
    _kf(8,
        left_spot  =(40, 0, 80, 35),
        curtain    =(100, 0, 150, 60),
        right_spot =(0, 255, 200, 100),    # vivid cyan peak
        bed_strip  =(15, 0, 70, 25),
        desk_strip =(200, 100, 0, 85),
        star       =(100,)),
    _kf(8,
        left_spot  =(30, 60, 180, 60),
        curtain    =(50, 0, 100, 50),      # retreat / breathe
        right_spot =(0, 100, 120, 60),
        bed_strip  =(40, 0, 70, 35),
        desk_strip =(0, 50, 120, 45),
        star       =(50,)),
]

# ── Sunset Drift ─────────────────────────────────────────
# Warm: burnt orange, coral, pink, gold, amber.
SCENES["sunset_drift"] = [
    _kf(8,
        left_spot  =(255, 100, 0, 85),     # deep orange
        curtain    =(255, 60, 40, 80),      # ember red
        right_spot =(255, 180, 50, 50),     # warm gold
        bed_strip  =(180, 40, 20, 30),      # dark amber
        desk_strip =(255, 120, 80, 55),     # salmon
        star       =(60,)),
    _kf(8,
        left_spot  =(255, 50, 80, 95),      # hot coral
        curtain    =(255, 80, 0, 90),       # bright orange
        right_spot =(200, 100, 0, 60),      # amber dim
        bed_strip  =(120, 20, 40, 35),      # muted rose
        desk_strip =(255, 150, 0, 65),      # golden
        star       =(75,)),
    _kf(8,
        left_spot  =(200, 0, 100, 75),      # raspberry
        curtain    =(255, 40, 100, 100),    # vivid pink
        right_spot =(255, 160, 80, 70),     # peach
        bed_strip  =(150, 0, 60, 40),       # dark rose
        desk_strip =(255, 80, 0, 75),       # tangerine
        star       =(85,)),
    _kf(8,
        left_spot  =(180, 60, 0, 60),       # rust
        curtain    =(200, 20, 60, 70),      # crimson
        right_spot =(255, 200, 100, 90),    # warm glow
        bed_strip  =(100, 30, 10, 30),      # embers
        desk_strip =(255, 60, 30, 80),      # fire
        star       =(95,)),
    _kf(8,
        left_spot  =(255, 140, 40, 70),     # marigold
        curtain    =(180, 40, 20, 55),      # cool down
        right_spot =(200, 80, 40, 65),      # copper
        bed_strip  =(80, 20, 10, 25),       # dim coals
        desk_strip =(200, 100, 50, 50),     # bronze
        star       =(55,)),
]

# ── Northern Lights ──────────────────────────────────────
# Aurora: greens, teals, electric blue, purple.
SCENES["northern_lights"] = [
    _kf(8,
        left_spot  =(0, 200, 80, 85),       # emerald
        curtain    =(0, 255, 120, 90),       # bright green
        right_spot =(0, 150, 200, 55),       # teal
        bed_strip  =(0, 80, 40, 30),         # forest dark
        desk_strip =(0, 180, 150, 50),       # sea green
        star       =(70,)),
    _kf(8,
        left_spot  =(0, 255, 180, 100),      # mint burst
        curtain    =(0, 200, 200, 85),       # teal shift
        right_spot =(80, 0, 200, 60),        # purple peek
        bed_strip  =(0, 100, 80, 35),
        desk_strip =(0, 220, 180, 65),       # aqua
        star       =(80,)),
    _kf(8,
        left_spot  =(0, 160, 220, 80),       # cerulean
        curtain    =(100, 0, 255, 100),      # electric purple
        right_spot =(0, 200, 100, 70),       # green return
        bed_strip  =(0, 60, 100, 30),        # deep teal
        desk_strip =(60, 0, 200, 70),        # violet
        star       =(90,)),
    _kf(8,
        left_spot  =(50, 0, 180, 65),        # indigo
        curtain    =(0, 255, 150, 85),       # bright aurora
        right_spot =(0, 255, 200, 90),       # vivid teal
        bed_strip  =(20, 0, 60, 25),         # deep blue
        desk_strip =(0, 200, 120, 60),       # jade
        star       =(100,)),
    _kf(8,
        left_spot  =(0, 180, 100, 70),       # calm green
        curtain    =(0, 180, 160, 65),       # muted teal
        right_spot =(40, 80, 180, 55),       # soft blue
        bed_strip  =(0, 60, 40, 25),         # dim forest
        desk_strip =(0, 140, 100, 45),       # sage
        star       =(55,)),
]

# ── Neon Pulse ───────────────────────────────────────────
# Cyberpunk: hot pink, electric blue, neon purple.  Faster.
SCENES["neon_pulse"] = [
    _kf(6,
        left_spot  =(255, 0, 100, 100),      # hot pink
        curtain    =(0, 0, 255, 90),          # electric blue
        right_spot =(160, 0, 255, 60),        # purple
        bed_strip  =(80, 0, 120, 40),         # dim violet
        desk_strip =(0, 200, 255, 70),        # cyan
        star       =(80,)),
    _kf(6,
        left_spot  =(0, 100, 255, 90),        # blue shift
        curtain    =(255, 0, 200, 100),       # magenta blast
        right_spot =(0, 255, 180, 80),        # neon green
        bed_strip  =(0, 40, 120, 35),
        desk_strip =(255, 0, 80, 80),         # pink
        star       =(100,)),
    _kf(6,
        left_spot  =(160, 0, 255, 95),        # vivid purple
        curtain    =(0, 255, 100, 85),        # neon green
        right_spot =(255, 0, 150, 90),        # hot pink
        bed_strip  =(60, 0, 160, 45),
        desk_strip =(0, 0, 255, 85),          # pure blue
        star       =(90,)),
    _kf(6,
        left_spot  =(0, 255, 200, 85),        # aqua neon
        curtain    =(200, 0, 255, 95),        # violet
        right_spot =(0, 100, 255, 75),        # blue
        bed_strip  =(40, 0, 100, 35),
        desk_strip =(255, 0, 200, 90),        # magenta
        star       =(85,)),
]

# ── Ocean Abyss ──────────────────────────────────────────
# Deep underwater: navy, bioluminescent cyan, dark teal.  Slow.
SCENES["ocean_abyss"] = [
    _kf(10,
        left_spot  =(0, 30, 100, 60),        # deep navy
        curtain    =(0, 80, 120, 70),         # ocean blue
        right_spot =(0, 60, 80, 45),          # dark teal
        bed_strip  =(0, 10, 50, 20),          # abyss
        desk_strip =(0, 50, 90, 40),          # deep water
        star       =(40,)),
    _kf(10,
        left_spot  =(0, 180, 200, 80),        # bioluminescent
        curtain    =(0, 60, 100, 65),         # stays deep
        right_spot =(0, 40, 70, 40),          # dark
        bed_strip  =(0, 20, 60, 25),
        desk_strip =(0, 100, 140, 55),        # mid-water
        star       =(55,)),
    _kf(10,
        left_spot  =(0, 80, 130, 55),         # fading
        curtain    =(0, 160, 180, 85),        # bioluminous center
        right_spot =(0, 120, 150, 65),        # cyan arriving
        bed_strip  =(0, 30, 70, 25),
        desk_strip =(0, 140, 160, 65),        # brightening
        star       =(70,)),
    _kf(10,
        left_spot  =(0, 20, 70, 40),          # dim
        curtain    =(0, 100, 140, 60),        # settling
        right_spot =(0, 180, 200, 80),        # bioluminescent peak
        bed_strip  =(0, 15, 50, 20),
        desk_strip =(0, 80, 120, 50),
        star       =(80,)),
    _kf(10,
        left_spot  =(0, 40, 90, 50),          # calm
        curtain    =(0, 50, 80, 50),          # deep rest
        right_spot =(0, 60, 90, 50),
        bed_strip  =(0, 10, 40, 18),          # near-dark
        desk_strip =(0, 40, 70, 35),
        star       =(35,)),
]

# ── Lava ─────────────────────────────────────────────────
# Volcanic: deep reds, orange glow, molten amber.
SCENES["lava"] = [
    _kf(8,
        left_spot  =(200, 0, 0, 85),          # deep red
        curtain    =(255, 40, 0, 80),         # hot orange
        right_spot =(180, 20, 0, 55),         # dark crimson
        bed_strip  =(100, 0, 0, 30),          # embers
        desk_strip =(255, 80, 0, 60),         # molten
        star       =(65,)),
    _kf(8,
        left_spot  =(255, 60, 0, 100),        # bright orange burst
        curtain    =(200, 10, 0, 90),         # crimson
        right_spot =(150, 0, 0, 45),          # deep red stay
        bed_strip  =(80, 0, 0, 25),
        desk_strip =(200, 50, 0, 65),         # amber
        star       =(80,)),
    _kf(8,
        left_spot  =(180, 0, 20, 70),         # dark magma
        curtain    =(255, 80, 0, 100),        # eruption orange
        right_spot =(255, 40, 0, 75),         # orange arrival
        bed_strip  =(120, 10, 0, 35),         # warm glow
        desk_strip =(255, 100, 0, 80),        # golden lava
        star       =(90,)),
    _kf(8,
        left_spot  =(120, 0, 0, 50),          # cooling
        curtain    =(180, 20, 0, 65),         # settling
        right_spot =(255, 70, 0, 95),         # hot tip peak
        bed_strip  =(60, 0, 0, 20),           # dim coals
        desk_strip =(180, 40, 0, 60),
        star       =(100,)),
    _kf(8,
        left_spot  =(160, 10, 0, 65),         # warm reset
        curtain    =(140, 0, 0, 55),          # deep
        right_spot =(140, 30, 0, 60),
        bed_strip  =(70, 0, 0, 22),           # ember rest
        desk_strip =(150, 30, 0, 50),
        star       =(50,)),
]


# ═══════════════════════════════════════════════════════════
#  SCENE RUNNER
# ═══════════════════════════════════════════════════════════

_running_task: asyncio.Task | None = None
_running_name: str | None = None


def scene_names() -> list[str]:
    return list(SCENES.keys())


def current_scene() -> str | None:
    return _running_name


async def _apply_zone(govee: GoveeClient, zone_name: str, state: ZoneState,
                       device_cache: dict[str, GoveeDevice]) -> None:
    """Send a single zone update to the hardware."""
    mapping = ZONE_MAP.get(zone_name)
    if not mapping:
        return

    dev_name = mapping["device"]
    dev = device_cache.get(dev_name)
    if not dev:
        return

    try:
        segments = mapping.get("segments")
        is_brightness_only = mapping.get("brightness_only", False)
        print(f"[SCENE] {zone_name} → rgb=({state.r},{state.g},{state.b}) bri={state.brightness}", flush=True)

        if is_brightness_only:
            await govee.set_brightness(dev, state.brightness)
        elif segments:
            # Try segment color first; fall back to whole-device if unsupported
            from integrations.govee import CAP_SEGMENT
            if dev.has_cap(CAP_SEGMENT):
                await govee.set_segment_color(dev, segments, state.r, state.g, state.b)
                await asyncio.sleep(0.1)
                await govee.set_segment_brightness(dev, segments, state.brightness)
            else:
                # Device doesn't support segments — use whole-device color
                print(f"[SCENE] {zone_name}/{dev_name} no segment cap, using whole-device color", flush=True)
                await govee.set_color(dev, state.r, state.g, state.b)
                await asyncio.sleep(0.1)
                await govee.set_brightness(dev, state.brightness)
        else:
            # Whole-device color
            await govee.set_color(dev, state.r, state.g, state.b)
            await asyncio.sleep(0.1)
            await govee.set_brightness(dev, state.brightness)
        print(f"[SCENE] {zone_name} ✓", flush=True)
    except Exception as e:
        print(f"[SCENE] zone '{zone_name}' ({dev_name}) error: {type(e).__name__}: {e}", flush=True)


async def _scene_loop(govee: GoveeClient, keyframes: list[Keyframe]) -> None:
    """Main scene loop — sweeps each keyframe across zones left→right, then holds."""
    # Build device cache once
    devices = await govee.get_devices()
    device_cache: dict[str, GoveeDevice] = {d.name: d for d in devices}

    # Turn on all scene devices first
    for zone_name, mapping in ZONE_MAP.items():
        dev = device_cache.get(mapping["device"])
        if dev:
            try:
                await govee.turn_on(dev)
            except Exception:
                pass
    await asyncio.sleep(1.0)

    print(f"[SCENE] loop started, {len(device_cache)} devices in cache: {list(device_cache.keys())}", flush=True)

    while True:
        for kf in keyframes:
            # Staggered-parallel sweep: all zones start at offset intervals,
            # run concurrently → full sweep takes FLOW_DELAY*(n-1) + API time, not sum of all
            async def _do_zone(zone_name: str, delay: float):
                await asyncio.sleep(delay)
                state = kf.zones.get(zone_name)
                if state:
                    await _apply_zone(govee, zone_name, state, device_cache)

            tasks = [
                asyncio.create_task(_do_zone(z, i * FLOW_DELAY))
                for i, z in enumerate(FLOW_ORDER)
            ]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Hold this keyframe
            await asyncio.sleep(kf.hold)


async def start_scene(govee: GoveeClient, name: str) -> str:
    """Start a named scene.  Stops any running scene first."""
    global _running_task, _running_name

    name_lower = name.lower().replace(" ", "_").replace("-", "_")
    keyframes = SCENES.get(name_lower)
    if not keyframes:
        available = ", ".join(SCENES.keys())
        return f"Unknown scene '{name}'. Available: {available}"

    # Stop current scene if one is running
    await stop_scene()

    _running_name = name_lower
    _running_task = asyncio.create_task(_scene_loop(govee, keyframes))
    nice_name = name_lower.replace("_", " ").title()
    return f"Started light scene: {nice_name}. Say 'stop light scene' to end it."


async def stop_scene() -> str:
    """Stop the currently running scene."""
    global _running_task, _running_name

    if _running_task and not _running_task.done():
        _running_task.cancel()
        try:
            await _running_task
        except asyncio.CancelledError:
            pass
    _running_task = None
    old = _running_name
    _running_name = None
    if old:
        return f"Stopped the {old.replace('_', ' ').title()} scene."
    return "No scene was running."
