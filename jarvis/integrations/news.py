"""
Nova — Live News Headlines
=============================
Fetches today's top headlines via RSS feeds (no API key required).
Lightweight, fast, and always current.
"""

import re
import logging
from datetime import datetime
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

# Free RSS feeds — top news sources, no auth needed
_FEEDS = [
    ("AP News", "https://rsshub.app/apnews/topics/apf-topnews"),
    ("Reuters", "https://rsshub.app/reuters/world"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml"),
    ("BBC", "http://feeds.bbci.co.uk/news/rss.xml"),
]

# Fallback: Google News RSS (very reliable)
_GOOGLE_NEWS = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"


def _strip_html(text: str) -> str:
    """Remove HTML tags from a string."""
    return re.sub(r"<[^>]+>", "", text).strip()


async def _fetch_feed(client: httpx.AsyncClient, name: str, url: str) -> list[dict]:
    """Parse an RSS feed and return headline dicts."""
    items = []
    try:
        r = await client.get(url, timeout=8, follow_redirects=True)
        if r.status_code != 200:
            return items
        root = ElementTree.fromstring(r.content)
        # Standard RSS 2.0
        for item in root.iter("item"):
            title_el = item.find("title")
            desc_el = item.find("description")
            if title_el is not None and title_el.text:
                items.append({
                    "source": name,
                    "title": _strip_html(title_el.text.strip()),
                    "summary": _strip_html(desc_el.text.strip())[:150] if desc_el is not None and desc_el.text else "",
                })
            if len(items) >= 5:
                break
    except Exception as e:
        logger.debug(f"[NEWS] {name} feed failed: {e}")
    return items


async def fetch_headlines(max_items: int = 5) -> list[dict]:
    """
    Fetch today's top headlines from multiple RSS feeds.
    Returns up to `max_items` deduplicated headlines.
    """
    all_items: list[dict] = []
    seen_titles: set[str] = set()

    async with httpx.AsyncClient() as client:
        # Try each feed until we have enough
        for name, url in _FEEDS:
            if len(all_items) >= max_items:
                break
            items = await _fetch_feed(client, name, url)
            for item in items:
                key = item["title"].lower()[:60]
                if key not in seen_titles:
                    seen_titles.add(key)
                    all_items.append(item)
                    if len(all_items) >= max_items:
                        break

        # Fallback to Google News if we got nothing
        if not all_items:
            items = await _fetch_feed(client, "Google News", _GOOGLE_NEWS)
            for item in items[:max_items]:
                all_items.append(item)

    return all_items[:max_items]


async def get_news_summary(max_items: int = 5) -> str:
    """Return a formatted news summary string for the morning briefing."""
    headlines = await fetch_headlines(max_items)
    if not headlines:
        return ""

    lines = ["Today's headlines:"]
    for h in headlines:
        source = h["source"]
        title = h["title"]
        lines.append(f"  • [{source}] {title}")
    return "\n".join(lines)
