"""
Nova — Good Morning Routine
==============================
Orchestrates the "Good morning" response with:
  1. Darklock server status
  2. Day, date, and time
  3. Schedule / reminders (only real data)
  4. Weather conditions
  5. Today's news headlines (live RSS)
"""

import httpx
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from integrations.weather import WeatherClient


DEFAULT_TZ = "America/Chicago"


async def _check_darklock_status() -> str:
    """Ping Darklock (port 3002) and the Discord bot to report system status."""
    services = {}
    # Darklock web server
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("http://127.0.0.1:3002/")
            services["Darklock"] = "online" if r.status_code < 500 else f"error ({r.status_code})"
    except Exception:
        services["Darklock"] = "offline"

    # Discord bot
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("http://127.0.0.1:3001/")
            services["Discord bot"] = "online" if r.status_code < 500 else f"error ({r.status_code})"
    except Exception:
        services["Discord bot"] = "offline"

    lines = ["System status:"]
    for name, status in services.items():
        icon = "✓" if status == "online" else "✗"
        lines.append(f"  {icon} {name}: {status}")
    return "\n".join(lines)


async def build_morning_briefing(
    weather_client: Optional["WeatherClient"] = None,
    calendar_client=None,
    persistent_memory=None,
    timezone: str = DEFAULT_TZ,
) -> str:
    """Build the full Good Morning briefing text.

    Order: Darklock status → day/date/time → schedule/reminders → weather → news.
    Only includes real data — never fabricates events or information.
    """
    tz = ZoneInfo(timezone)
    now = datetime.now(tz)
    parts = []

    # 1. Darklock server status
    try:
        status = await _check_darklock_status()
        parts.append(status)
    except Exception:
        parts.append("System status: could not check.")

    # 2. Day, date, and time
    day_str = now.strftime("%A, %B %-d, %Y")
    time_str = now.strftime("%-I:%M %p")
    parts.append(f"Today is {day_str}. The time is {time_str}.")

    # 3. Schedule / reminders
    schedule_lines = []
    if calendar_client:
        try:
            events = calendar_client.get_today()
            if events:
                count = len(events)
                schedule_lines.append(f"You have {count} event{'s' if count != 1 else ''} today:")
                for ev in events[:5]:
                    time_display = ev["start_display"]
                    if ev["all_day"]:
                        time_display = "All day"
                    schedule_lines.append(f"  • {ev['summary']} at {time_display}")
            else:
                schedule_lines.append("No events on your calendar today.")
        except Exception as e:
            schedule_lines.append(f"Couldn't fetch calendar: {e}")
    else:
        schedule_lines.append("No events on your calendar today.")

    if persistent_memory:
        try:
            reminders = persistent_memory.get_user_fact("reminders")
            if reminders:
                schedule_lines.append(f"Reminders: {reminders}")
        except Exception:
            pass

    parts.append("\n".join(schedule_lines))

    # 4. Weather
    if weather_client:
        try:
            weather = await weather_client.get_current()
            parts.append(
                f"Weather: {weather.temp_f:.0f}°F and {weather.description}. "
                f"High of {weather.high_f:.0f}°F, low of {weather.low_f:.0f}°F."
            )
        except Exception as e:
            parts.append(f"Couldn't fetch weather: {e}")

    # 5. Today's news headlines (live RSS — always current)
    try:
        from integrations.news import get_news_summary
        news = await get_news_summary(max_items=5)
        if news:
            parts.append(news)
    except Exception as e:
        parts.append(f"Couldn't fetch news: {e}")

    return "\n".join(parts)


def is_morning_greeting(text: str) -> bool:
    """Check if the user's message is a morning greeting."""
    import re
    text = text.strip().lower()
    return bool(re.match(
        r'^(?:hey\s+(?:nova|buddy)[,!.\s]*)?'
        r'(?:good\s+)?mornin[g\']?\s*[.!]*$',
        text
    ))
