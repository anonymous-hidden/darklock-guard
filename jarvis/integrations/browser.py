"""
Nova — Browser Intelligence Module
=====================================
Read, summarize, and analyze web pages using Playwright.
Supports: full text extraction, heading/link extraction, page type detection,
content summarization, and question answering about pages.

Requires: playwright (pip install playwright && playwright install chromium)
"""

import asyncio
import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PageContent:
    """Extracted web page data."""
    url: str
    title: str
    text: str
    headings: list[str] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    forms: int = 0
    page_type: str = "unknown"
    meta_description: str = ""
    word_count: int = 0

    def brief(self) -> str:
        """One-line summary."""
        return f"{self.title} ({self.page_type}) — {self.word_count} words"


class BrowserClient:
    """Headless browser for intelligent web reading."""

    def __init__(self, headless: bool = True):
        self._headless = headless
        self._browser = None
        self._pw = None

    async def _ensure_browser(self):
        if self._browser is None:
            from playwright.async_api import async_playwright
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(headless=self._headless)

    async def close(self):
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._pw:
            await self._pw.stop()
            self._pw = None

    async def read_page(self, url: str, max_chars: int = 15000) -> PageContent:
        """Read a web page and extract structured content."""
        await self._ensure_browser()
        page = await self._browser.new_page()
        try:
            # Navigate with timeout
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(1000)  # Let JS render

            # Extract title
            title = await page.title() or ""

            # Extract visible text
            text = await page.evaluate("""() => {
                // Remove script, style, noscript elements
                const remove = document.querySelectorAll('script, style, noscript, nav, footer, header');
                remove.forEach(el => el.remove());
                
                // Get main content area if available
                const main = document.querySelector('main, article, [role="main"], .content, #content');
                const target = main || document.body;
                return target.innerText || target.textContent || '';
            }""")

            # Clean up text
            text = re.sub(r'\n{3,}', '\n\n', text.strip())
            word_count = len(text.split())

            # Extract headings
            headings = await page.evaluate("""() => {
                const heads = document.querySelectorAll('h1, h2, h3, h4');
                return Array.from(heads).slice(0, 20).map(h => {
                    return h.tagName + ': ' + (h.innerText || '').trim();
                }).filter(h => h.length > 4);
            }""")

            # Extract links (top 30)
            links = await page.evaluate("""() => {
                const anchors = document.querySelectorAll('a[href]');
                return Array.from(anchors).slice(0, 30).map(a => ({
                    text: (a.innerText || '').trim().slice(0, 100),
                    href: a.href
                })).filter(l => l.text && l.href.startsWith('http'));
            }""")

            # Count forms
            forms = await page.evaluate("() => document.querySelectorAll('form').length")

            # Get meta description
            meta_desc = await page.evaluate("""() => {
                const meta = document.querySelector('meta[name="description"]');
                return meta ? meta.content : '';
            }""")

            # Detect page type
            page_type = self._detect_page_type(url, title, text, headings, forms)

            # Truncate if needed
            if len(text) > max_chars:
                text = text[:max_chars] + f"\n\n... (truncated at {max_chars} chars)"

            return PageContent(
                url=url,
                title=title,
                text=text,
                headings=headings,
                links=links,
                forms=forms,
                page_type=page_type,
                meta_description=meta_desc,
                word_count=word_count,
            )
        finally:
            await page.close()

    async def get_text_only(self, url: str, max_chars: int = 10000) -> str:
        """Simple text extraction for quick reads."""
        content = await self.read_page(url, max_chars)
        return content.text

    async def get_page_info(self, url: str) -> dict:
        """Get structured page info (headings, links, type, etc.)."""
        content = await self.read_page(url, max_chars=5000)
        return {
            "title": content.title,
            "type": content.page_type,
            "description": content.meta_description,
            "word_count": content.word_count,
            "headings": content.headings[:10],
            "links": content.links[:15],
            "forms": content.forms,
            "preview": content.text[:800],
        }

    async def screenshot(self, url: str, path: str) -> str:
        """Take a screenshot of a page."""
        await self._ensure_browser()
        page = await self._browser.new_page(viewport={"width": 1280, "height": 720})
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=path, full_page=False)
            return path
        finally:
            await page.close()

    @staticmethod
    def _detect_page_type(url: str, title: str, text: str, headings: list, forms: int) -> str:
        """Detect what kind of page this is."""
        url_lower = url.lower()
        title_lower = title.lower()
        text_lower = text[:2000].lower()

        # Login/auth page
        if forms > 0 and any(w in text_lower for w in ("sign in", "log in", "login", "password", "username")):
            return "login"

        # Dashboard
        if any(w in title_lower for w in ("dashboard", "overview", "admin")):
            return "dashboard"

        # Search results
        if any(w in url_lower for w in ("search", "results", "q=", "query=")):
            return "search_results"

        # Video
        if any(w in url_lower for w in ("youtube.com/watch", "vimeo.com", "twitch.tv")):
            return "video"

        # Social media
        if any(w in url_lower for w in ("twitter.com", "x.com", "reddit.com", "facebook.com", "instagram.com")):
            return "social_media"

        # E-commerce / product
        if any(w in text_lower for w in ("add to cart", "buy now", "price", "add to bag")):
            return "product"

        # Documentation / wiki
        if any(w in url_lower for w in ("docs.", "wiki", "documentation", "readme")):
            return "documentation"

        # News / article
        if len(headings) >= 2 and len(text.split()) > 300:
            return "article"

        # Forum / Q&A
        if any(w in url_lower for w in ("stackoverflow", "forum", "community", "discuss")):
            return "forum"

        return "webpage"

    def format_page_brief(self, content: PageContent) -> str:
        """Format page content for display."""
        parts = [f"**{content.title}**", f"Type: {content.page_type} | {content.word_count} words"]
        if content.meta_description:
            parts.append(f"Description: {content.meta_description}")
        if content.headings:
            parts.append("Headings: " + " → ".join(h.split(": ", 1)[-1] for h in content.headings[:5]))
        return "\n".join(parts)
