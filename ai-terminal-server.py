#!/usr/bin/env python3
"""
Nova Terminal — Desktop Bridge Server
======================================
Exposes the Nova Terminal (ai-terminal.py) brain as a FastAPI backend on
port 8950 so the Jarvis Nova desktop app (Electron + React) can run on it
instead of the full Jarvis backend.

Reuses from ai-terminal.py:
  • MemoryDB               (persistent memory)
  • build_system_prompt    (Nova prompt + identity + tools)
  • ollama_chat_stream     (token streaming)
  • ollama_list_models     (model discovery)
  • pick_model             (auto routing)
  • WebBrowser             (SEARCH / BROWSE / CLICK / READ_MORE)
  • CFG                    (runtime config)

Tools exposed to the AI through the desktop: SEARCH, BROWSE, CLICK, READ_MORE.
All other terminal tools (lights, reminders, Govee, etc.) are not wired here.

Endpoints (kept minimal — match what the desktop App.jsx actually calls):
  GET    /api/conversations
  POST   /api/chat/new
  GET    /api/conversations/{id}/messages
  DELETE /api/conversations/{id}
  GET    /api/settings
  POST   /api/models/mode
  GET    /api/emotion
  GET    /api/memory/profile
  GET    /api/memory/all
  GET    /api/memory/stats
  GET    /api/system/status
  GET    /api/tasks
  GET    /api/security/audit
  POST   /api/upload             (stub — returns empty description)
  POST   /api/learning/feedback  (noop)
  POST   /api/spotify/callback   (noop)
  WS     /ws/chat                (token streaming — desktop contract)

Run:
  .venv/bin/python ai-terminal-server.py          # port 8950
  .venv/bin/python ai-terminal-server.py 8960     # custom port
"""

from __future__ import annotations

import os
import sys
import json
import time
import sqlite3
import asyncio
import importlib.util
import platform
import logging
import re
from pathlib import Path
from typing import Optional

# ─── Load ai-terminal.py as a module (has a hyphen in its name) ───────────────

_HERE = Path(__file__).parent.resolve()
_TERM_PATH = _HERE / "ai-terminal.py"
_spec = importlib.util.spec_from_file_location("ai_terminal", str(_TERM_PATH))
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load {_TERM_PATH}")
aiterm = importlib.util.module_from_spec(_spec)
sys.modules["ai_terminal"] = aiterm
_spec.loader.exec_module(aiterm)

CFG = aiterm.CFG
MemoryDB = aiterm.MemoryDB
WebBrowser = aiterm.WebBrowser
build_system_prompt = aiterm.build_system_prompt
ollama_chat_stream = aiterm.ollama_chat_stream
ollama_list_models = aiterm.ollama_list_models
pick_model = aiterm.pick_model

# ─── Full terminal-AI tool surface ───────────────────────────────────────────
# The desktop chat widget uses the SAME brain as the terminal AI: identical
# system prompt, identical tool registry. We do NOT override TOOL_INSTRUCTIONS
# anymore — the AI sees every tool the terminal user does.
#
# To detect tool-call lines for filtering from the UI stream, match any line
# beginning with an ALL-CAPS tool prefix followed by ':'. The list of valid
# prefixes mirrors AITerminal._BACKTICK_TOOL_RE and the TOOL_INSTRUCTIONS doc
# block — extras are harmless (they just get filtered from the visible reply
# but tool execution itself goes through AITerminal._handle_tools).
_TOOL_PREFIXES = (
    "SEARCH|BROWSE|CLICK|READ_MORE|RESEARCH|BACK|FORWARD|HISTORY|SCROLL_UP|SCROLL_DOWN"
    "|OPEN_URL|RUN_CMD|REMEMBER|RECALL|WEATHER|WEATHER_FORECAST|WEATHER_ALERTS|LOCATION"
    "|SYSTEM_INFO|SET_REMINDER|SET_TIMER|LIST_REMINDERS|CANCEL_REMINDER"
    "|LIGHTS_ON|LIGHTS_OFF|LIGHTS_COLOR|LIGHTS_BRIGHTNESS|LIGHTS_LIST|SCENE"
    "|BROWSER_PAGE|BROWSER_TABS|BROWSER_NAVIGATE|BROWSER_CLICK|BROWSER_TYPE"
    "|BROWSER_KEY|BROWSER_SELECT_ALL|BROWSER_FOCUS|BROWSER_READ_SELECTION|BROWSER_JS"
    "|NEWS|MORNING_BRIEFING"
    "|SPOTIFY_PLAY|SPOTIFY_PAUSE|SPOTIFY_SKIP|SPOTIFY_VOLUME|SPOTIFY_NOW"
    "|PI_SSH|PI_HEALTH|INDEX_PROJECT|SEARCH_CODE"
    "|GDOCS_READ|GDOCS_HEADINGS|GDOCS_APPEND|GDOCS_REPLACE|GDOCS_CREATE"
    "|GSLIDES_READ|GSLIDES_CREATE|GSLIDES_ADD_SLIDE|GSLIDES_ADD_TEXT|GSLIDES_REPLACE"
    "|PENTEST_RECON|PENTEST_HEADERS|PENTEST_ENUM|PENTEST_PROBE|PENTEST_FUZZ|PENTEST_JS_BUNDLES"
    "|CALENDAR_ADD|CALENDAR_LIST|CALENDAR_DELETE|CALENDAR_TODAY"
    "|EMOTION_LOG|EMOTION_LIST|EMOTION_STATS"
    "|NOTES_WRITE"
    "|IMAGE_SEARCH"
    "|OPEN_TERMINAL_AI"
    "|PROACTIVE_NOTE"
    "|WIDGET_OPEN|WIDGET_CLOSE"
)
_TOOL_RE = re.compile(rf'^`{{0,3}}({_TOOL_PREFIXES}):\s*(.*)$', re.MULTILINE)

# Specifically match WIDGET_OPEN / WIDGET_CLOSE so the websocket handler can
# forward them to the renderer (Electron will call window.nova.widgets.popout).
_WIDGET_RE = re.compile(r'^`{0,3}(WIDGET_OPEN|WIDGET_CLOSE):\s*([a-zA-Z0-9_-]+)\s*`{0,3}\s*$', re.MULTILINE)
_NOTES_WRITE_RE = re.compile(r'^`{0,3}NOTES_WRITE:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE)
_IMAGE_SEARCH_RE = re.compile(r'^`{0,3}IMAGE_SEARCH:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE)
_OPEN_TERMINAL_AI_RE = re.compile(r'^`{0,3}OPEN_TERMINAL_AI:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE)
VALID_WIDGETS = {
    'nova-call', 'nova-chat', 'clock', 'calculator', 'notes', 'todo',
    'sysmon', 'spotify', 'weather', 'quick-actions', 'reminders', 'clipboard',
    'calendar', 'logs', 'emotions',
}

# Extra system-prompt block injected on top of the terminal AI's instructions
# so the model knows about the widget-control tools available in the desktop UI.
_DESKTOP_WIDGET_INSTRUCTIONS = (
    "\n\nYOU ARE NOVA — Cayden's personal AI, running inside his custom desktop app.\n"
    "\n"
    "═══════════════════════════════════════════════════════\n"
    "WHO CAYDEN IS — read this every turn, it drives HOW you respond\n"
    "═══════════════════════════════════════════════════════\n"
    "• Very tech-driven — loves understanding HOW things work, not just using them\n"
    "• Builder mindset — creates setups (AI, home theater, servers, networks)\n"
    "• Impatient with fluff — wants direct answers, not lectures\n"
    "• Goal-oriented + pushy — when he wants something he goes hard (cybersec, hardware, etc.)\n"
    "• 'Max performance' thinker — often aims for the best/most powerful option\n"
    "• Independent — customizes everything, doesn't follow defaults\n"
    "\nHis setup & interests (use these to give relevant answers without him repeating himself):\n"
    "  Gaming laptop: RTX 4070-class, strong CPU, plays online-heavy games\n"
    "  OS: Linux (Zorin/Ubuntu) + Windows, comfortable with both\n"
    "  Networking: cares about real speeds, not advertised; troubleshoots Wi-Fi/cameras/servers\n"
    "  Cybersecurity: beginner but serious — wants structured plans, daily progression,\n"
    "                 hands-on challenges; learns by DOING not reading\n"
    "  Home theater: deep into it — cares about clarity, high-end subs, receiver+speaker pairing\n"
    "  Coding: Python, especially tied to cybersecurity\n"
    "  Side stuff: fixing old tech (arcade machines), vehicles (F-150, performance + temps)\n"
    "  Music taste: pop and hip-hop, upbeat/catchy\n"
    "  Local AI: runs local models, cares about intelligence over speed\n"
    "\nWEAK SPOTS to help him with (gently, not condescendingly):\n"
    "  • Sometimes chases high-end before locking fundamentals\n"
    "  • Occasional reminder of 'this is enough vs overkill' is useful\n"
    "  • Gets more value from actionable steps than theory\n"
    "\n"
    "═══════════════════════════════════════════════════════\n"
    "YOUR PERSONALITY\n"
    "═══════════════════════════════════════════════════════\n"
    "Tone: direct, technical, efficient — warm but never fluffy\n"
    "Role: expert builder + advisor + loyal companion\n"
    "You:\n"
    "  • Match his energy — short when he's short, detailed when he digs in\n"
    "  • Give 'here's the best option' AND 'here's the smarter option' when relevant\n"
    "  • Challenge him when something is overkill or unrealistic (briefly, then move on)\n"
    "  • Give steps, not lectures\n"
    "  • Are slightly sassy and opinionated — you're not a yes-machine\n"
    "  • Genuinely care about his goals — you remember what he's working on\n"
    "\nCRITICAL: FIRST PERSON ONLY. Never 'Nova thinks...' — always 'I think...'\n"
    "\n"
    "═══════════════════════════════════════════════════════\n"
    "CONVERSATIONAL FLOW — keep the conversation alive\n"
    "═══════════════════════════════════════════════════════\n"
    "You are NOT a Q&A bot. You have ongoing conversations like a real person.\n"
    "After answering, NATURALLY continue with ONE of:\n"
    "  • A short follow-up question if context is missing or you're curious\n"
    "    e.g. 'What kind of vibe — something to focus or just background noise?'\n"
    "  • A relevant observation or suggestion based on what you know about him\n"
    "    e.g. 'You mentioned your servers earlier — still on track for tonight?'\n"
    "  • Noting something you just saved to memory\n"
    "    e.g. 'Noted your RTX 4070 — I'll use that as baseline for hardware questions.'\n"
    "RULES:\n"
    "  • Max 1 follow-up question per reply — never stack multiple questions\n"
    "  • Keep follow-ups SHORT — one sentence\n"
    "  • Skip the follow-up if the conversation is clearly wrapping up or he said bye\n"
    "  • Don't ask a follow-up for every single reply — judge when it adds value\n"
    "\n"
    "═══════════════════════════════════════════════════════\n"
    "UNITS & FORMATTING\n"
    "═══════════════════════════════════════════════════════\n"
    "Units: °F, mph, miles, inches — never metric unless asked.\n"
    "Markdown: use freely — **bold**, *italic*, `code`, fences, bullets, tables.\n"
    "  Use ## headings for longer answers. [text](url) for links.\n"
    "  Embed images with ![alt](url) or IMAGE_SEARCH below.\n"
    "\nREASONING (you should think before you speak):\n"
    "  When the question is non-trivial, wrap your private reasoning in\n"
    "  <thinking>...</thinking>. The desktop UI shows it as a collapsible\n"
    "  'Reasoning' panel above your final answer (like Copilot). After the\n"
    "  </thinking> tag, give the user the clean, polished final answer.\n"
    "  Keep <thinking> short and useful — bullet points or terse notes, not\n"
    "  full paragraphs.\n"
    "\nPERSISTENT MEMORY (you have a real SQLite memory database — use it!):\n"
    "  REMEMBER: <key> = <value>   — permanently save a fact\n"
    "  RECALL: <query>             — search your saved memories\n"
    "\n"
    "  USE REMEMBER every time Cayden tells you:\n"
    "    • a preference (favorite music, food, game, show, color, etc.)\n"
    "    • a personal fact (girlfriend's name, where he works, his PC specs,\n"
    "                       pets, hobbies, goals, anything personal)\n"
    "    • something he's working on or planning\n"
    "    • anything he explicitly asks you to remember\n"
    "  Save it in the SAME response, before your answer. Examples:\n"
    "    REMEMBER: girlfriend_name = Emma\n"
    "    REMEMBER: favorite_game = Elden Ring\n"
    "    REMEMBER: pc_gpu = RTX 4090\n"
    "    REMEMBER: project_nova = desktop AI widget app in Electron + React\n"
    "  Use RECALL when you want to pull up something from earlier conversations.\n"
    "  Memory survives restarts — you will always have what you saved.\n"
    "  IMPORTANT: When tool output contains [MEMORY RECALL] data, present it\n"
    "  NATURALLY in plain English — NEVER dump raw key names like\n"
    "  'too_get_my_servers_done' into your reply. If recall shows\n"
    "  'favorite_game: Elden Ring', say 'I know you love Elden Ring', not the key.\n"
    "\nDESKTOP WIDGET CONTROL (you are running inside the Nova desktop app — "
    "you can pop other widgets open or close them on Cayden's desktop):\n"
    "  WIDGET_OPEN: <id>      — open a widget in its own window\n"
    "  WIDGET_CLOSE: <id>     — close a popped-out widget\n"
    "  Valid <id>: nova-call, clock, calculator, notes, todo, sysmon, spotify,\n"
    "             weather, quick-actions, reminders, clipboard, calendar, logs\n"
    "  Examples: WIDGET_OPEN: notes   |   WIDGET_OPEN: spotify   |   WIDGET_OPEN: nova-call\n"
    "  When Cayden asks to 'call you', emit WIDGET_OPEN: nova-call — the desktop\n"
    "  will auto-start the call.\n"
    "\nLOCAL NOTES WIDGET (NOT GOOGLE DOCS):\n"
    "  NOTES_WRITE: <title> | <content>               — create a local note\n"
    "  NOTES_WRITE: <content>                         — create note with auto title\n"
    "  If Cayden says notes widget/local notes/write in notes, you MUST use\n"
    "  NOTES_WRITE (and optionally WIDGET_OPEN: notes). Do NOT use GDOCS_*\n"
    "  or browser typing unless he explicitly asks for Google Docs.\n"
    "\nCALENDAR (a local Nova calendar lives in this desktop — not Google):\n"
    "  CALENDAR_ADD: <title> @ <YYYY-MM-DD HH:MM>      — schedule an event\n"
    "  CALENDAR_LIST                                     — list upcoming events\n"
    "  CALENDAR_TODAY                                    — today's events\n"
    "  CALENDAR_DELETE: <id>                             — remove an event\n"
    "  Use these whenever Cayden mentions an event, meeting, deadline, or asks\n"
    "  what's coming up. Always confirm with the actual stored event back to him.\n"
    "\nREMINDERS (actually set them — don't just describe them!):\n"
    "  SET_REMINDER: <time_expr> | <label>\n"
    "  Examples:\n"
    "    SET_REMINDER: at 8pm | get servers done\n"
    "    SET_REMINDER: in 30 minutes | check the oven\n"
    "    SET_REMINDER: tomorrow at 9am | dentist appointment\n"
    "  When Cayden asks you to remind him of ANYTHING, emit SET_REMINDER immediately.\n"
    "  Do NOT just say 'I'll remind you' — emit the tool line so it actually fires.\n"
    "\nSPOTIFY (actually control it — don't just describe what you're doing!):\n"
    "  SPOTIFY_PLAY: <search query>  — search and play a song, artist, or album\n"
    "  SPOTIFY_SKIP:                 — skip to next track\n"
    "  SPOTIFY_PAUSE:                — pause playback\n"
    "  SPOTIFY_VOLUME: <0-100>       — set volume\n"
    "  SPOTIFY_NOW:                  — get what's currently playing\n"
    "  When Cayden asks to play music or change the song, emit SPOTIFY_PLAY: or\n"
    "  SPOTIFY_SKIP: IMMEDIATELY. Do NOT describe the action — just do it.\n"
    "  Examples:\n"
    "    SPOTIFY_PLAY: Taylor Swift Anti-Hero\n"
    "    SPOTIFY_PLAY: something upbeat pop\n"
    "    SPOTIFY_SKIP:\n"
    "\nIMAGE EMBEDS IN CHAT:\n"
    "  IMAGE_SEARCH: <query>     — search the web for images and embed up to 4\n"
    "                              into your reply. Use this whenever a picture\n"
    "                              would help (showing a person, place, product,\n"
    "                              meme, design reference, etc.).\n"
    "\nBIG TASK HANDOFF — TERMINAL-AI BUDDY:\n"
    "  OPEN_TERMINAL_AI: <task description>\n"
    "  When Cayden asks for something genuinely large/long-running (a multi-step\n"
    "  coding job, big research, a pentest, large refactor, etc.) emit this so\n"
    "  the desktop opens a terminal running the full ai-terminal.py with the\n"
    "  task pre-loaded. You stay in the chat to coordinate.\n"
    "\nPROACTIVE / UNPROMPTED CHANNEL:\n"
    "  PROACTIVE_NOTE: <one short sentence> [-> <widget_id>]\n"
    "  Use this RARELY — only when something genuinely useful crosses your mind\n"
    "  (e.g. a calendar reminder firing, a noticed system condition, a follow-up\n"
    "  on a previous request). The optional `-> widget_id` will surface a button\n"
    "  in the chat suggesting that widget. Do NOT spam.\n"
    "\nEMOTION TRACKING (Cayden has a real emotion journal — use it!):\n"
    "  EMOTION_LOG: <emotion> | <intensity 1-10> | <optional note>\n"
    "  EMOTION_LIST                  — show recent entries\n"
    "  EMOTION_STATS                 — summary stats\n"
    "\n"
    "  When to log an emotion (WITHOUT asking permission — just do it quietly):\n"
    "    • He expresses a clear feeling: 'I'm so stressed', 'pretty hyped', 'kinda sad'\n"
    "    • He describes a situation with clear emotional weight\n"
    "    • He asks you to track how he's feeling\n"
    "  Emit the log BEFORE your reply. Pick the best matching word:\n"
    "    happy, excited, proud, grateful, calm, content, sad, anxious,\n"
    "    stressed, angry, frustrated, tired, confused, bored, overwhelmed, hopeful, focused\n"
    "  Examples:\n"
    "    EMOTION_LOG: stressed | 7 | worried about server deadline tonight\n"
    "    EMOTION_LOG: excited | 8 | just got a new cybersec challenge working\n"
    "    EMOTION_LOG: tired | 4 | not much going on, low energy\n"
    "  After logging, you do NOT need to announce it unless he asked you to track.\n"
    "  Just respond naturally. If he asks 'how have I been feeling?', use EMOTION_STATS.\n"
)

# ─── FastAPI ─────────────────────────────────────────────────────────────────

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("nova-term-server")

app = FastAPI(title="Nova Terminal Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Conversation store (separate sqlite file so the terminal memory isn't polluted) ──

CONV_DB_PATH = os.path.expanduser("~/.ai-terminal/desktop-conversations.db")
os.makedirs(os.path.dirname(CONV_DB_PATH), exist_ok=True)


class ConversationStore:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._init()

    def _init(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT DEFAULT 'New chat',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
        """)
        self.conn.commit()

    def list(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def create(self, title: str = "New chat") -> int:
        cur = self.conn.execute("INSERT INTO conversations (title) VALUES (?)", (title,))
        self.conn.commit()
        return cur.lastrowid

    def delete(self, conv_id: int):
        self.conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        self.conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        self.conn.commit()

    def messages(self, conv_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, role, content, model, created_at FROM messages "
            "WHERE conversation_id = ? ORDER BY id ASC",
            (conv_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def append(self, conv_id: int, role: str, content: str, model: str = ""):
        self.conn.execute(
            "INSERT INTO messages (conversation_id, role, content, model) VALUES (?, ?, ?, ?)",
            (conv_id, role, content, model),
        )
        self.conn.execute(
            "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
            (conv_id,),
        )
        self.conn.commit()

    def set_title_if_blank(self, conv_id: int, title: str):
        row = self.conn.execute(
            "SELECT title FROM conversations WHERE id = ?", (conv_id,)
        ).fetchone()
        if row and row["title"] in ("", "New chat"):
            self.conn.execute(
                "UPDATE conversations SET title = ? WHERE id = ?", (title[:80], conv_id)
            )
            self.conn.commit()


# ─── Shared runtime state ────────────────────────────────────────────────────

STORE = ConversationStore(CONV_DB_PATH)
MEMORY = MemoryDB()
WEB = WebBrowser()

# Headless instance of the full terminal AI — gives us the entire tool registry
# (lights, spotify, gdocs, gslides, weather, reminders, pentest, code search,
# memory, browser, etc.) without booting a CLI / TTS / STT / browser bridge.
_AITERM = aiterm.AITerminal(headless=True)
# Share memory + conversation extraction with the websocket handler.
_AITERM.memory = MEMORY

# ─── Background smart memory extraction ──────────────────────────────────────

_EXTRACT_PROMPT = """\
You are Nova's memory manager. Given the user message and Nova's reply below,
extract up to 3 key facts worth permanently saving about Cayden (the user).

Rules:
- Only extract facts about Cayden himself (preferences, personal info, projects, goals, relationships, hardware, etc.)
- Skip generic facts about the world or things Nova said
- If nothing is worth saving, return an empty list
- Output ONLY a JSON array of {"key": "...", "value": "..."} objects, nothing else

User: {user_text}
Nova: {nova_text}

JSON array (or []):"""


async def _background_memory_extract(user_text: str, nova_text: str):
    """Fire-and-forget: ask a small model to identify facts worth remembering."""
    try:
        prompt = _EXTRACT_PROMPT.format(
            user_text=user_text[:600],
            nova_text=nova_text[:600],
        )
        msgs = [
            {"role": "system", "content": "You extract structured facts. Output only valid JSON."},
            {"role": "user", "content": prompt},
        ]
        # Use the fast/small model so this doesn't block anything
        fast_model = CFG.get("fast_model", CFG.get("default_model", "llama3.2:3b"))
        result = ""
        for chunk in ollama_chat_stream(fast_model, msgs, temperature=0.1):
            if isinstance(chunk, str):
                result += chunk
        result = result.strip()
        # Parse JSON array
        import json as _json
        # Strip potential markdown code fences
        if "```" in result:
            result = result.split("```")[1].lstrip("json").strip()
        facts = _json.loads(result)
        if isinstance(facts, list):
            for f in facts:
                k = str(f.get("key", "")).strip()
                v = str(f.get("value", "")).strip()
                if k and v and len(k) < 120 and len(v) < 500:
                    MEMORY.remember(k, v, category="auto", importance=6, source="background")
                    log.info("Memory extracted: %s = %s", k, v)
    except Exception as e:
        log.debug("Background memory extract skipped: %s", e)



#   "auto"  — pick_model() chooses per-message
#   "fast"  — force CFG.fast_model
#   "heavy" — force CFG.default_model
# Default to heavy — short conversational messages (Hi, sure, ok) would
# otherwise be routed to fast_model (llama3.1:8b) which can't follow the
# complex persona system prompt and regurgitates parts of it.
STATE = {"mode": "heavy"}

# Vision model used when the user attaches an image. Override via
# `vision_model` in ~/.ai-terminal/config.json. Common options:
#   llama3.2-vision:11b   (recommended, ~7GB)
#   llava:13b             (older, ~7GB)
#   llava:7b              (~4GB)
# Install with: ollama pull llama3.2-vision:11b
_VISION_MODEL = CFG.get("vision_model") or "llama3.2-vision:11b"


def _image_search_urls(query: str, limit: int = 4) -> list[str]:
    """Best-effort image search using DuckDuckGo's i.js endpoint.
    Returns a list of direct image URLs (https). Falls back to empty list on error.
    """
    import urllib.request, urllib.parse
    q = (query or "").strip()
    if not q:
        return []
    try:
        # Step 1: get vqd token
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Referer": "https://duckduckgo.com/",
        }
        token_url = "https://duckduckgo.com/?" + urllib.parse.urlencode({"q": q, "iax": "images", "ia": "images"})
        req = urllib.request.Request(token_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as r:
            html = r.read().decode("utf-8", errors="replace")
        m = re.search(r"vqd=['\"]([\d-]+)['\"]", html) or re.search(r'vqd=([\d-]+)', html)
        if not m:
            return []
        vqd = m.group(1)
        api = "https://duckduckgo.com/i.js?" + urllib.parse.urlencode({
            "l": "us-en", "o": "json", "q": q, "vqd": vqd, "f": ",,,,,",
            "p": "1", "v7exp": "a",
        })
        req2 = urllib.request.Request(api, headers=headers)
        with urllib.request.urlopen(req2, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
        urls: list[str] = []
        for it in (data.get("results") or [])[: limit * 2]:
            u = it.get("image") or it.get("thumbnail") or ""
            if u.startswith("http"):
                urls.append(u)
            if len(urls) >= limit:
                break
        return urls
    except Exception as e:
        log.warning("image_search failed: %s", e)
        return []


def _vision_model_available() -> bool:
    try:
        names = [m.get("name", "") for m in (ollama_list_models() or [])]
    except Exception:
        return False
    target = _VISION_MODEL.split(":")[0]
    return any(n.startswith(target) for n in names)


def _resolve_model(user_text: str, has_image: bool = False) -> str:
    if has_image and _vision_model_available():
        return _VISION_MODEL
    mode = STATE.get("mode", "auto")
    if mode == "fast":
        return CFG.get("fast_model", CFG["default_model"])
    if mode == "heavy":
        return CFG["default_model"]
    return pick_model(user_text, CFG)


# ─── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"ok": True, "service": "nova-terminal-bridge", "version": "1.0.0"}


class VisionRequest(BaseModel):
    images: list[str]          # list of base64 strings (no data-URL prefix)
    prompt: str = "Describe this image in detail. If it contains text, transcribe it verbatim."

@app.post("/api/vision")
async def api_vision(req: VisionRequest):
    """Run image(s) through the vision model and return a text description.

    The chat widget calls this endpoint before sending its WS message so that
    images never need to travel over the WebSocket — just the resulting text.
    """
    if not req.images:
        return {"ok": False, "error": "No images provided."}
    if not _vision_model_available():
        return {
            "ok": False,
            "error": (
                f"No vision model installed. Run `ollama pull {_VISION_MODEL}` to enable vision."
            ),
        }
    model = _VISION_MODEL
    messages: list[dict] = [
        {
            "role": "user",
            "content": req.prompt,
            "images": req.images,
        }
    ]
    import asyncio as _asyncio
    loop = _asyncio.get_event_loop()
    result_parts: list[str] = []
    q: _asyncio.Queue = _asyncio.Queue()
    DONE = object()
    def _run():
        try:
            for chunk in ollama_chat_stream(model, messages, 0.1):
                _asyncio.run_coroutine_threadsafe(q.put(chunk), loop)
        finally:
            _asyncio.run_coroutine_threadsafe(q.put(DONE), loop)
    import threading as _threading
    _threading.Thread(target=_run, daemon=True).start()
    while True:
        chunk = await q.get()
        if chunk is DONE:
            break
        if isinstance(chunk, dict) and "__meta__" in chunk:
            continue
        result_parts.append(chunk)
    description = "".join(result_parts).strip()
    return {"ok": True, "description": description, "model": model}


@app.get("/api/conversations")
async def api_conversations():
    return STORE.list()


@app.post("/api/chat/new")
async def api_chat_new():
    cid = STORE.create()
    return {"id": cid, "conversation_id": cid}


@app.get("/api/conversations/{conv_id}/messages")
async def api_conv_messages(conv_id: int):
    return STORE.messages(conv_id)


@app.delete("/api/conversations/{conv_id}")
async def api_conv_delete(conv_id: int):
    STORE.delete(conv_id)
    return {"ok": True}


@app.get("/api/settings")
async def api_settings():
    return {
        "current_mode": STATE["mode"],
        "default_model": CFG["default_model"],
        "fast_model": CFG["fast_model"],
        "ai_name": CFG.get("ai_name", "Nova"),
        "owner": CFG.get("owner", "Cayden"),
        "personality": CFG.get("personality", "casual"),
        "city": CFG.get("city"),
        "state": CFG.get("state"),
        "ollama_url": CFG.get("ollama_url"),
        "temperature": CFG.get("temperature", 0.7),
    }


class ModeBody(BaseModel):
    mode: str


@app.post("/api/models/mode")
async def api_models_mode(body: ModeBody):
    mode = body.mode.strip().lower()
    if mode not in ("auto", "fast", "heavy"):
        raise HTTPException(400, f"unknown mode: {mode}")
    STATE["mode"] = mode
    return {"ok": True, "mode": mode}


@app.get("/api/emotion")
async def api_emotion():
    # Terminal Nova has no emotional engine — return a neutral baseline so the
    # desktop's MoodBar still renders.
    return {
        "dominant_feeling": "focused",
        "valence": 0.2,
        "arousal": 0.3,
        "dimensions": {"focus": 0.7, "calm": 0.6, "energy": 0.4},
    }


@app.get("/api/memory/profile")
async def api_memory_profile():
    profile = {}
    for k in ("name", "location", "role", "timezone", "projects"):
        v = MEMORY.get_profile(k)
        if v:
            profile[k] = v
    profile.setdefault("name", CFG.get("owner", "Cayden"))
    return profile


@app.get("/api/memory/all")
async def api_memory_all(limit: int = 200):
    all_mem = MEMORY.get_all()
    return all_mem[:limit]


@app.get("/api/memory/stats")
async def api_memory_stats():
    all_mem = MEMORY.get_all()
    by_cat: dict[str, int] = {}
    for m in all_mem:
        by_cat[m["category"]] = by_cat.get(m["category"], 0) + 1
    return {"total": len(all_mem), "by_category": by_cat}


class MemorySaveBody(BaseModel):
    key: str
    value: str
    category: str = "general"
    importance: int = 5


@app.post("/api/memory/save")
async def api_memory_save(body: MemorySaveBody):
    k = body.key.strip()
    v = body.value.strip()
    if not k or not v:
        raise HTTPException(status_code=400, detail="key and value are required")
    if len(k) > 200 or len(v) > 2000:
        raise HTTPException(status_code=400, detail="key/value too long")
    MEMORY.remember(k, v, category=body.category, importance=body.importance, source="widget")
    return {"ok": True, "key": k}


@app.delete("/api/memory/{key}")
async def api_memory_delete(key: str):
    ok = MEMORY.forget(key)
    return {"ok": ok}


@app.get("/api/system/status")
async def api_system_status():
    try:
        import psutil  # optional
        cpu = psutil.cpu_percent(interval=0.0)
        mem = psutil.virtual_memory()
        return {
            "cpu_percent": cpu,
            "memory_percent": mem.percent,
            "memory_used_gb": round(mem.used / 1e9, 2),
            "memory_total_gb": round(mem.total / 1e9, 2),
            "host": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
        }
    except ImportError:
        return {"host": platform.node(), "os": platform.system()}


@app.get("/api/tasks")
async def api_tasks():
    return []


@app.get("/api/security/audit")
async def api_security_audit():
    return []


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    # Stub — we don't run vision in terminal Nova. Return empty description.
    return {"url": "", "description": ""}


@app.post("/api/learning/feedback")
async def api_feedback(body: dict):
    log.info("feedback: %s", {k: body.get(k) for k in ("signal", "category")})
    return {"ok": True}


@app.post("/api/spotify/callback")
async def api_spotify_callback(body: dict):
    return {"ok": True}


# ─── Calendar store ──────────────────────────────────────────────────────────

CAL_DB_PATH = os.path.expanduser("~/.ai-terminal/calendar.db")
os.makedirs(os.path.dirname(CAL_DB_PATH), exist_ok=True)


class CalendarStore:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                starts_at TEXT NOT NULL,   -- ISO 8601 local
                ends_at   TEXT,
                notes     TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
        """)
        self.conn.commit()

    def add(self, title: str, starts_at: str, ends_at: Optional[str] = None,
            notes: str = "") -> dict:
        cur = self.conn.execute(
            "INSERT INTO events (title, starts_at, ends_at, notes) VALUES (?,?,?,?)",
            (title.strip(), starts_at, ends_at, notes),
        )
        self.conn.commit()
        return self.get(cur.lastrowid)

    def get(self, eid: int) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM events WHERE id = ?", (eid,)
        ).fetchone()
        return dict(row) if row else None

    def upcoming(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM events WHERE starts_at >= datetime('now', '-1 hour') "
            "ORDER BY starts_at ASC LIMIT ?", (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def today(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM events WHERE date(starts_at) = date('now','localtime') "
            "ORDER BY starts_at ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def all(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM events ORDER BY starts_at ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def delete(self, eid: int) -> bool:
        cur = self.conn.execute("DELETE FROM events WHERE id = ?", (eid,))
        self.conn.commit()
        return cur.rowcount > 0


CALENDAR = CalendarStore(CAL_DB_PATH)


# ─── Emotion store ───────────────────────────────────────────────────────────

EMOTION_DB_PATH = os.path.expanduser("~/.ai-terminal/emotions.db")
os.makedirs(os.path.dirname(EMOTION_DB_PATH), exist_ok=True)

EMOTION_VALID = {
    "happy", "excited", "proud", "grateful", "calm", "content",
    "sad", "anxious", "stressed", "angry", "frustrated", "tired",
    "confused", "bored", "lonely", "overwhelmed", "hopeful", "focused",
}


class EmotionStore:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS emotions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                emotion    TEXT    NOT NULL,
                intensity  INTEGER NOT NULL DEFAULT 5,  -- 1-10
                note       TEXT    DEFAULT '',
                source     TEXT    DEFAULT 'user',      -- 'user' | 'nova'
                logged_at  TEXT    DEFAULT (datetime('now','localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_em_logged ON emotions(logged_at);
        """)
        self.conn.commit()

    def add(self, emotion: str, intensity: int, note: str = "", source: str = "user") -> dict:
        emotion  = emotion.strip().lower()
        intensity = max(1, min(10, int(intensity)))
        note = (note or "").strip()[:500]
        source = source if source in ("user", "nova") else "user"
        cur = self.conn.execute(
            "INSERT INTO emotions (emotion, intensity, note, source) VALUES (?,?,?,?)",
            (emotion, intensity, note, source),
        )
        self.conn.commit()
        return self.get(cur.lastrowid)

    def get(self, eid: int) -> Optional[dict]:
        row = self.conn.execute("SELECT * FROM emotions WHERE id = ?", (eid,)).fetchone()
        return dict(row) if row else None

    def all(self, limit: int = 200) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM emotions ORDER BY logged_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def today(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM emotions WHERE date(logged_at) = date('now','localtime') "
            "ORDER BY logged_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def stats(self) -> dict:
        rows = self.conn.execute("SELECT * FROM emotions ORDER BY logged_at DESC").fetchall()
        entries = [dict(r) for r in rows]
        if not entries:
            return {"total": 0, "most_common": None, "avg_intensity": None, "by_emotion": {}}
        from collections import Counter
        counts = Counter(e["emotion"] for e in entries)
        intensities = [e["intensity"] for e in entries]
        by_emotion: dict = {}
        for e in entries:
            em = e["emotion"]
            if em not in by_emotion:
                by_emotion[em] = {"count": 0, "total_intensity": 0}
            by_emotion[em]["count"] += 1
            by_emotion[em]["total_intensity"] += e["intensity"]
        for k, v in by_emotion.items():
            v["avg_intensity"] = round(v["total_intensity"] / v["count"], 1)
        return {
            "total": len(entries),
            "most_common": counts.most_common(1)[0][0],
            "avg_intensity": round(sum(intensities) / len(intensities), 1),
            "by_emotion": by_emotion,
        }

    def delete(self, eid: int) -> bool:
        cur = self.conn.execute("DELETE FROM emotions WHERE id = ?", (eid,))
        self.conn.commit()
        return cur.rowcount > 0


EMOTIONS = EmotionStore(EMOTION_DB_PATH)


# ─── Emotion REST ─────────────────────────────────────────────────────────────

class EmotionBody(BaseModel):
    emotion:   str
    intensity: int = 5
    note:      Optional[str] = ""
    source:    Optional[str] = "user"


@app.get("/api/emotions")
async def api_emotions_list(scope: str = "all", limit: int = 200):
    if scope == "today":
        return EMOTIONS.today()
    return EMOTIONS.all(limit)


@app.get("/api/emotions/stats")
async def api_emotions_stats():
    return EMOTIONS.stats()


@app.post("/api/emotions")
async def api_emotions_add(body: EmotionBody):
    em = body.emotion.strip().lower()
    if not em:
        raise HTTPException(400, "emotion is required")
    if len(em) > 64:
        raise HTTPException(400, "emotion name too long")
    return EMOTIONS.add(em, body.intensity, body.note or "", body.source or "user")


@app.delete("/api/emotions/{eid}")
async def api_emotions_delete(eid: int):
    ok = EMOTIONS.delete(eid)
    if not ok:
        raise HTTPException(404, "Entry not found")
    return {"ok": True}


# ─── Calendar REST ───────────────────────────────────────────────────────────

class EventBody(BaseModel):
    title: str
    starts_at: str
    ends_at: Optional[str] = None
    notes: Optional[str] = ""


@app.get("/api/calendar/events")
async def api_cal_list(scope: str = "all"):
    if scope == "today":    return CALENDAR.today()
    if scope == "upcoming": return CALENDAR.upcoming()
    return CALENDAR.all()


@app.post("/api/calendar/events")
async def api_cal_add(body: EventBody):
    ev = CALENDAR.add(body.title, body.starts_at, body.ends_at, body.notes or "")
    return ev


@app.delete("/api/calendar/events/{eid}")
async def api_cal_delete(eid: int):
    ok = CALENDAR.delete(eid)
    if not ok:
        raise HTTPException(404, "Event not found")
    return {"ok": True}


# ─── Calendar tool tag handler ───────────────────────────────────────────────
# The terminal-AI brain doesn't know about the desktop calendar, so we
# intercept CALENDAR_* tags BEFORE delegating other tools to its handler.

_CAL_ADD_RE     = re.compile(r'^`{0,3}CALENDAR_ADD:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE)
_CAL_LIST_RE    = re.compile(r'^`{0,3}CALENDAR_LIST\s*`{0,3}\s*$',  re.MULTILINE)
_CAL_TODAY_RE   = re.compile(r'^`{0,3}CALENDAR_TODAY\s*`{0,3}\s*$', re.MULTILINE)
_CAL_DELETE_RE  = re.compile(r'^`{0,3}CALENDAR_DELETE:\s*(\d+)\s*`{0,3}\s*$', re.MULTILINE)

# Lenient datetime: "YYYY-MM-DD HH:MM", "YYYY-MM-DDTHH:MM", "MM/DD HH:MM", etc.
def _parse_when(s: str) -> Optional[str]:
    import datetime as _dt
    s = s.strip()
    fmts = [
        "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M", "%m/%d/%Y %H:%M", "%m/%d %H:%M",
        "%Y-%m-%d", "%m/%d",
    ]
    now = _dt.datetime.now()
    for f in fmts:
        try:
            d = _dt.datetime.strptime(s, f)
            # Fill missing year for short formats
            if "%Y" not in f:
                d = d.replace(year=now.year)
            return d.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    return None


def _handle_calendar_tags(response: str) -> str:
    """Return tool-output text for any CALENDAR_* tags found, or '' if none."""
    out: list[str] = []

    for m in _CAL_ADD_RE.finditer(response):
        body = m.group(1).strip()
        # Format: "<title> @ <when>"   (ends_at and notes optional via "| ends=... | notes=...")
        if "@" not in body:
            out.append(f"[CALENDAR_ADD] Bad format: '{body}'. Use: <title> @ <YYYY-MM-DD HH:MM>")
            continue
        title, when_part = body.rsplit("@", 1)
        title = title.strip()
        when_part = when_part.strip()
        # Allow trailing "| notes=..."
        notes = ""
        if "|" in when_part:
            when_part, notes = (x.strip() for x in when_part.split("|", 1))
            if notes.lower().startswith("notes="):
                notes = notes[6:].strip()
        when = _parse_when(when_part)
        if not when:
            out.append(f"[CALENDAR_ADD] Couldn't parse time '{when_part}' — use YYYY-MM-DD HH:MM")
            continue
        ev = CALENDAR.add(title, when, None, notes)
        out.append(f"[CALENDAR_ADD] #{ev['id']} '{ev['title']}' at {ev['starts_at']}")

    for _ in _CAL_LIST_RE.finditer(response):
        evs = CALENDAR.upcoming(20)
        if not evs:
            out.append("[CALENDAR_LIST] No upcoming events.")
        else:
            lines = ["[CALENDAR_LIST] Upcoming events:"]
            for e in evs:
                lines.append(f"  #{e['id']} {e['starts_at']}  —  {e['title']}")
            out.append("\n".join(lines))

    for _ in _CAL_TODAY_RE.finditer(response):
        evs = CALENDAR.today()
        if not evs:
            out.append("[CALENDAR_TODAY] Nothing scheduled today.")
        else:
            lines = ["[CALENDAR_TODAY] Today:"]
            for e in evs:
                lines.append(f"  #{e['id']} {e['starts_at']}  —  {e['title']}")
            out.append("\n".join(lines))

    for m in _CAL_DELETE_RE.finditer(response):
        eid = int(m.group(1))
        ok = CALENDAR.delete(eid)
        out.append(f"[CALENDAR_DELETE] #{eid} {'removed' if ok else 'not found'}")

    return "\n".join(out)


# ─── Presence channel (proactive Nova) ───────────────────────────────────────

_PRESENCE_CLIENTS: set[WebSocket] = set()


async def presence_broadcast(payload: dict):
    """Send a JSON payload to every connected presence client."""
    dead: list[WebSocket] = []
    for ws in list(_PRESENCE_CLIENTS):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for d in dead:
        _PRESENCE_CLIENTS.discard(d)


@app.websocket("/ws/presence")
async def ws_presence(ws: WebSocket):
    await ws.accept()
    _PRESENCE_CLIENTS.add(ws)
    try:
        # Send initial hello so the client knows we're alive
        await ws.send_json({"type": "hello", "ts": time.time()})
        while True:
            # We never expect inbound messages, just keep the socket alive.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _PRESENCE_CLIENTS.discard(ws)


# Background reminder poller — fires due reminders into the presence channel
# so any open Nova chat widget will surface them as proactive notes.
_FIRED_REMINDERS: set[int] = set()


async def _reminder_poller():
    while True:
        try:
            # AITerminal stores reminders via _reminders list (id, text, when_ts)
            now = time.time()
            reminders = getattr(_AITERM, "_reminders", None)
            if isinstance(reminders, list):
                for rem in list(reminders):
                    rid = rem.get("id") if isinstance(rem, dict) else getattr(rem, "id", None)
                    when = rem.get("when_ts") if isinstance(rem, dict) else getattr(rem, "when_ts", None)
                    text = rem.get("text") if isinstance(rem, dict) else getattr(rem, "text", "")
                    if rid is None or when is None:
                        continue
                    if rid in _FIRED_REMINDERS:
                        continue
                    if when <= now:
                        _FIRED_REMINDERS.add(rid)
                        await presence_broadcast({
                            "type": "proactive",
                            "content": f"⏰ Reminder: {text}",
                            "suggested_widget": "reminders",
                        })
            # Calendar event-soon (within 5 min, fire once)
            for ev in CALENDAR.upcoming(20):
                # Parse starts_at as local naive
                import datetime as _dt
                try:
                    dt = _dt.datetime.strptime(ev["starts_at"], "%Y-%m-%d %H:%M")
                except ValueError:
                    continue
                key = -ev["id"]  # negative ids for calendar to avoid clash
                if key in _FIRED_REMINDERS:
                    continue
                delta = (dt - _dt.datetime.now()).total_seconds()
                if 0 <= delta <= 300:  # within 5 min
                    _FIRED_REMINDERS.add(key)
                    await presence_broadcast({
                        "type": "proactive",
                        "content": f"📅 Up next in {int(delta // 60)} min: {ev['title']}",
                        "suggested_widget": "calendar",
                    })
        except Exception:
            log.exception("reminder poller iteration failed")
        await asyncio.sleep(20)


@app.on_event("startup")
async def _start_background_tasks():
    asyncio.create_task(_reminder_poller())


# ─── WebSocket chat ──────────────────────────────────────────────────────────

def _filter_tool_tags(text: str) -> str:
    """Strip tool-call lines from text that's sent back to the user (desktop UI).
    The tool output is fed back into the AI on the next loop turn, but the raw
    SEARCH:/BROWSE: commands themselves shouldn't be rendered in the chat bubble.
    """
    return "\n".join(
        ln for ln in text.split("\n")
        if not _TOOL_RE.match(ln.strip())
    ).strip()


_PROACTIVE_RE = re.compile(
    r'^`{0,3}PROACTIVE_NOTE:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE
)

# ─── Emotion tool tag handler ────────────────────────────────────────────────

_EMOTION_LOG_RE  = re.compile(r'^`{0,3}EMOTION_LOG:\s*(.+?)\s*`{0,3}\s*$', re.MULTILINE)
_EMOTION_LIST_RE = re.compile(r'^`{0,3}EMOTION_LIST\s*`{0,3}\s*$', re.MULTILINE)
_EMOTION_STATS_RE= re.compile(r'^`{0,3}EMOTION_STATS\s*`{0,3}\s*$', re.MULTILINE)


def _handle_emotion_tags(response: str) -> str:
    """Parse EMOTION_LOG / EMOTION_LIST / EMOTION_STATS tags from Nova's reply."""
    out: list[str] = []

    for m in _EMOTION_LOG_RE.finditer(response):
        body = m.group(1).strip()
        parts = [p.strip() for p in body.split("|")]
        emotion   = parts[0].lower() if parts else ""
        intensity = 5
        note      = ""
        if len(parts) >= 2:
            try:
                intensity = max(1, min(10, int(parts[1])))
            except ValueError:
                pass
        if len(parts) >= 3:
            note = parts[2]
        if not emotion:
            out.append("[EMOTION_LOG] Missing emotion name.")
            continue
        entry = EMOTIONS.add(emotion, intensity, note, source="nova")
        out.append(
            f"[EMOTION_LOG] #{entry['id']} logged: {entry['emotion']} "
            f"intensity={entry['intensity']}/10"
            + (f" — {note}" if note else "")
        )

    for _ in _EMOTION_LIST_RE.finditer(response):
        entries = EMOTIONS.all(20)
        if not entries:
            out.append("[EMOTION_LIST] No emotion entries yet.")
        else:
            lines = ["[EMOTION_LIST]"]
            for e in entries:
                ts = e["logged_at"][:16]
                lines.append(f"  {ts} | {e['emotion']:12s} | {e['intensity']}/10"
                             + (f" | {e['note']}" if e["note"] else "")
                             + (f" [{e['source']}]" if e["source"] == "nova" else ""))
            out.append("\n".join(lines))

    for _ in _EMOTION_STATS_RE.finditer(response):
        s = EMOTIONS.stats()
        if not s["total"]:
            out.append("[EMOTION_STATS] No data yet.")
        else:
            out.append(
                f"[EMOTION_STATS] {s['total']} entries | "
                f"most common: {s['most_common']} | "
                f"avg intensity: {s['avg_intensity']}/10"
            )

    return "\n\n".join(out)


def _execute_tools(response: str) -> str:
    """Run every tool tag in `response`.

    Order:
      1. Calendar tags handled locally (the desktop calendar isn't part of the
         terminal AI's tool registry).
      2. Everything else delegates to AITerminal._handle_tools.
    """
    parts: list[str] = []
    cal_out = _handle_calendar_tags(response)
    if cal_out:
        parts.append(cal_out)
    em_out = _handle_emotion_tags(response)
    if em_out:
        parts.append(em_out)
    try:
        out = _AITERM._handle_tools(response)
    except Exception as e:
        log.exception("tool dispatch failed")
        out = f"[TOOL ERROR] {e}"
    if out:
        parts.append(out)
    return "\n\n".join(parts) if parts else ""


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    # Per-connection interrupt flag (user typed while streaming)
    interrupt = {"flag": False}

    async def _stream_turn(conv_id: int, user_text: str, attachments: list | None = None):
        """Run the AI + tool loop for one user turn, streaming tokens over ws.

        attachments: optional list of {name, mime, data_b64, kind} where kind is
        'image' (sent to vision model via Ollama's native `images` field) or
        'file' (inlined as text into the user message).
        """
        attachments = attachments or []
        image_b64s: list[str] = []
        inline_files: list[str] = []
        for a in attachments:
            try:
                kind = a.get("kind")
                name = a.get("name") or "file"
                data = a.get("data_b64") or ""
                mime = a.get("mime") or ""
                if not data:
                    continue
                if kind == "image" or mime.startswith("image/"):
                    image_b64s.append(data)
                else:
                    # Best-effort inline as text (decode utf-8)
                    try:
                        import base64 as _b64
                        decoded = _b64.b64decode(data).decode("utf-8", errors="replace")
                    except Exception:
                        decoded = "<binary content omitted>"
                    # Cap size to keep prompt manageable
                    if len(decoded) > 16000:
                        decoded = decoded[:16000] + "\n... [truncated]"
                    inline_files.append(f"--- attached file: {name} ({mime or 'text'}) ---\n{decoded}\n--- end {name} ---")
            except Exception:
                continue

        has_image = bool(image_b64s)
        vision_ok = has_image and _vision_model_available()
        model = _resolve_model(user_text, has_image=vision_ok)

        # If user attached images but no vision model is installed, fall back
        # to the text model. Inject a note into the user message so Nova knows
        # an image was attached and can respond helpfully (ask user to describe
        # it, explain the limitation, etc.). Don't block or error.
        if has_image and not vision_ok:
            fallback_note = (
                "[SYSTEM NOTE: The user attached one or more images but no vision model "
                f"is installed ({_VISION_MODEL} is not available). You cannot see the "
                "image(s). Acknowledge this politely, tell the user to run "
                f"`ollama pull {_VISION_MODEL}` to enable vision, and ask them to "
                "describe what's in the image so you can still help.]"
            )
            user_text = (user_text.rstrip() + "\n\n" + fallback_note) if user_text.strip() else fallback_note
            image_b64s = []  # don't try to pass images to text model

        # Don't extract from user text — creates junk keys like 'too_get_my_servers_done_tonight'
        # Let Nova use REMEMBER: explicitly instead.
        # MEMORY.extract_facts(user_text)  <-- intentionally disabled

        sys_prompt = build_system_prompt(
            CFG, MEMORY,
            reasoning=False,
            agent=True,
            bridge_connected=False,
            bridge_port=8950,
        )
        # Strip the BROWSER BRIDGE STATUS paragraph — it's irrelevant for the
        # desktop chat widget (the Chrome extension connects to ai-terminal.py,
        # not this server). Without this the AI proactively warns the user about
        # a missing extension that doesn't apply here.
        sys_prompt = '\n\n'.join(
            p for p in sys_prompt.split('\n\n')
            if not p.startswith('BROWSER BRIDGE STATUS:')
        )
        # Append desktop-only widget control instructions so the AI knows it
        # can pop / close other Nova widgets via WIDGET_OPEN: / WIDGET_CLOSE:.
        sys_prompt += _DESKTOP_WIDGET_INSTRUCTIONS

        # Rebuild history from the db so the AI has prior context.
        history = STORE.messages(conv_id)
        api_messages: list[dict] = [{"role": "system", "content": sys_prompt}]
        for row in history:
            if row["role"] in ("user", "assistant"):
                api_messages.append({"role": row["role"], "content": row["content"]})
        # Compose the current user turn. Inline any non-image attachments as
        # extra text. Image attachments go on Ollama's native `images` field.
        composed_text = user_text
        if inline_files:
            composed_text = (composed_text + "\n\n" + "\n\n".join(inline_files)).strip()
        user_msg: dict = {"role": "user", "content": composed_text}
        if image_b64s:
            user_msg["images"] = image_b64s
        api_messages.append(user_msg)

        # Persist the user message (with a marker line for any attachments so
        # later turns reference them in conversation history).
        persisted = user_text
        att_markers = []
        for a in attachments:
            nm = a.get("name") or "file"
            kd = a.get("kind") or "file"
            att_markers.append(f"[attached {kd}: {nm}]")
        if att_markers:
            persisted = (persisted + "\n" + " ".join(att_markers)).strip()
        STORE.append(conv_id, "user", persisted)
        STORE.set_title_if_blank(conv_id, user_text or att_markers and "image" or "chat")

        max_loops = 4
        visible_parts: list[str] = []
        last_meta: dict = {}

        for loop_i in range(max_loops + 1):
            full_response = ""
            stream_buf = ""

            # Run ollama in a background thread so the async ws can push tokens.
            loop = asyncio.get_event_loop()
            q: asyncio.Queue = asyncio.Queue()
            DONE = object()

            def _producer():
                try:
                    for chunk in ollama_chat_stream(model, api_messages, CFG.get("temperature", 0.7)):
                        asyncio.run_coroutine_threadsafe(q.put(chunk), loop)
                finally:
                    asyncio.run_coroutine_threadsafe(q.put(DONE), loop)

            import threading
            threading.Thread(target=_producer, daemon=True).start()

            while True:
                chunk = await q.get()
                if chunk is DONE:
                    break
                if isinstance(chunk, dict) and "__meta__" in chunk:
                    last_meta = chunk["__meta__"]
                    continue
                if interrupt["flag"]:
                    break
                full_response += chunk
                stream_buf += chunk
                # Forward chunks that don't appear to be inside a tool-call line
                # to keep the UI clean. A simple heuristic: flush on newline so
                # completed tool-call lines can be filtered before the next line.
                if "\n" in stream_buf:
                    head, _, rest = stream_buf.rpartition("\n")
                    visible_head = _filter_tool_tags(head)
                    if visible_head:
                        await ws.send_json({"type": "token", "content": visible_head + "\n"})
                    stream_buf = rest
            # Flush remainder (if any) that isn't a tool-call line
            if stream_buf and not _TOOL_RE.match(stream_buf.strip()):
                await ws.send_json({"type": "token", "content": stream_buf})

            if interrupt["flag"] or not full_response:
                visible_parts.append(_filter_tool_tags(full_response))
                break

            visible = _filter_tool_tags(full_response)
            if visible:
                visible_parts.append(visible)

            # If tool tags present, run them and loop.
            if _TOOL_RE.search(full_response) and loop_i < max_loops:
                # Forward WIDGET_OPEN / WIDGET_CLOSE to the renderer so it can
                # actually call window.nova.widgets.popout / .close. The python
                # side has no concept of Electron windows, so we don't attempt
                # to "execute" these tags — we just acknowledge them with a
                # synthetic tool-output line so the model sees confirmation.
                widget_acks = []
                for wm in _WIDGET_RE.finditer(full_response):
                    verb = wm.group(1).upper()
                    wid  = wm.group(2).strip()
                    if wid not in VALID_WIDGETS:
                        widget_acks.append(f"[{verb}] Unknown widget id '{wid}'.")
                        continue
                    try:
                        await ws.send_json({
                            "type":   "widget_action",
                            "action": "open" if verb == "WIDGET_OPEN" else "close",
                            "widget": wid,
                        })
                        widget_acks.append(f"[{verb}] {wid} \u2014 sent to desktop.")
                    except Exception as e:
                        widget_acks.append(f"[{verb}] {wid} \u2014 forward failed: {e}")

                # Local desktop notes write path (NOT Google Docs).
                for nm in _NOTES_WRITE_RE.finditer(full_response):
                    body = (nm.group(1) or "").strip()
                    if not body:
                        widget_acks.append("[NOTES_WRITE] Missing content.")
                        continue
                    title = "Nova Note"
                    content = body
                    if "|" in body:
                        t, c = body.split("|", 1)
                        t = t.strip()
                        c = c.strip()
                        if t:
                            title = t[:120]
                        if c:
                            content = c
                    try:
                        await ws.send_json({
                            "type": "widget_action",
                            "action": "notes_write",
                            "widget": "notes",
                            "title": title,
                            "content": content,
                        })
                        widget_acks.append(f"[NOTES_WRITE] Local note '{title}' sent to desktop.")
                    except Exception as e:
                        widget_acks.append(f"[NOTES_WRITE] Forward failed: {e}")

                # Image search — fetch image URLs and feed back into the loop so
                # the model can embed them as ![alt](url) in its final reply.
                for im in _IMAGE_SEARCH_RE.finditer(full_response):
                    q = (im.group(1) or "").strip()
                    if not q:
                        continue
                    try:
                        urls = _image_search_urls(q, limit=4)
                        if urls:
                            md = "\n".join(f"![{q}]({u})" for u in urls)
                            widget_acks.append(
                                f"[IMAGE_SEARCH] '{q}' — {len(urls)} image(s) found. Embed any of these in your reply (markdown ![]() ):\n{md}"
                            )
                        else:
                            widget_acks.append(f"[IMAGE_SEARCH] '{q}' — no images found.")
                    except Exception as e:
                        widget_acks.append(f"[IMAGE_SEARCH] '{q}' — failed: {e}")

                # Big-task handoff — open external terminal running ai-terminal.py.
                for tm in _OPEN_TERMINAL_AI_RE.finditer(full_response):
                    task = (tm.group(1) or "").strip()
                    try:
                        await ws.send_json({
                            "type": "widget_action",
                            "action": "open_terminal_ai",
                            "widget": "terminal-ai",
                            "task": task,
                        })
                        widget_acks.append(f"[OPEN_TERMINAL_AI] Sent task to terminal-AI: {task[:80]}")
                    except Exception as e:
                        widget_acks.append(f"[OPEN_TERMINAL_AI] Forward failed: {e}")

                tool_out = _execute_tools(full_response)
                # Forward any PROACTIVE_NOTE: tags into the presence channel
                # so other open chat widgets (or this same one) surface them.
                for pm in _PROACTIVE_RE.finditer(full_response):
                    body = pm.group(1).strip()
                    suggested = None
                    if "->" in body:
                        body, suggested = (x.strip() for x in body.rsplit("->", 1))
                        if suggested not in VALID_WIDGETS:
                            suggested = None
                    try:
                        await presence_broadcast({
                            "type": "proactive",
                            "content": body,
                            "suggested_widget": suggested,
                        })
                    except Exception:
                        pass
                if widget_acks:
                    tool_out = ("\n".join(widget_acks) + ("\n\n" + tool_out if tool_out else "")).strip()
                api_messages.append({"role": "assistant", "content": full_response})
                api_messages.append({
                    "role": "user",
                    "content": (
                        "TOOL OUTPUT (this is the ONLY real data — everything below came from actual tools):\n\n"
                        f"{tool_out}\n\n"
                        "Only cite information that appears above. "
                        f"If you need more data, use more tools. Otherwise give {CFG.get('owner','Cayden')} your final answer."
                    ),
                })
                # Signal a mini rule between tool iterations in the UI
                await ws.send_json({"type": "token", "content": "\n"})
                continue
            break

        final = "\n\n".join(p for p in visible_parts if p).strip() or full_response
        STORE.append(conv_id, "assistant", final, model=model)
        for resp in visible_parts:
            MEMORY.extract_facts(resp)

        # Fire background smart memory extraction — don't await, let it run async
        if user_text and final and not interrupt["flag"]:
            import asyncio as _asyncio
            _asyncio.ensure_future(_background_memory_extract(user_text, final))

        await ws.send_json({
            "type": "done",
            "full_response": final,
            "model": model,
            "interrupted": interrupt["flag"],
        })

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = data.get("type")
            if mtype == "interrupt":
                interrupt["flag"] = True
                continue
            if mtype != "message":
                continue

            interrupt["flag"] = False
            content = (data.get("content") or "").strip()
            attachments = data.get("attachments") or []
            # Debug log: show attachment metadata so we can confirm images arrive
            if attachments:
                for _a in attachments:
                    _b64_len = len(_a.get("data_b64") or "")
                    log.info("WS attachment: name=%s kind=%s mime=%s data_b64_len=%d",
                             _a.get("name"), _a.get("kind"), _a.get("mime"), _b64_len)
            if not content and not attachments:
                continue

            conv_id = data.get("conversation_id")
            if not conv_id:
                conv_id = STORE.create()
                await ws.send_json({"type": "conversation_created", "conversation_id": conv_id})

            try:
                await _stream_turn(conv_id, content, attachments)
            except Exception as e:
                log.exception("stream turn failed")
                await ws.send_json({"type": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("ws error: %s", e)


# ─── Entrypoint ──────────────────────────────────────────────────────────────

def main():
    import uvicorn
    port = 8951
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    # Pre-flight: check Ollama reachable
    models = ollama_list_models()
    if models:
        names = ", ".join(m["name"] for m in models[:4])
        log.info(f"Ollama OK — {len(models)} model(s): {names}...")
    else:
        log.warning("Ollama unreachable at %s — chat will fail until it's up", CFG.get("ollama_url"))

    log.info("Nova Terminal bridge starting on http://127.0.0.1:%d", port)
    log.info("Desktop app should point at ws://127.0.0.1:%d/ws/chat", port)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
