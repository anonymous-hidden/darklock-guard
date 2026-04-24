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

# ─── Trim the terminal's TOOL_INSTRUCTIONS down to what the desktop exposes ───
# User explicitly chose only Web search + browse for the desktop wiring.

_DESKTOP_TOOL_INSTRUCTIONS = (
    "You have access to web browsing tools. To use a tool, output the EXACT command "
    "on its own line. You can use MULTIPLE tools in a single response — each on its own line.\n"
    "After each tool runs, you'll receive the results and can use more tools or give a final answer.\n\n"
    "WEB BROWSING:\n"
    "  SEARCH: <query>           — search the web, returns numbered results\n"
    "  BROWSE: <url>             — go to a URL, read the page content and links\n"
    "  CLICK: <number or text>   — click a numbered link from the current page\n"
    "  READ_MORE:                — read more content from the current page\n\n"
    "WORKFLOW FOR RESEARCH:\n"
    "  1. SEARCH: <query> — get results with real URLs\n"
    "  2. CLICK: <number> — visit a result, read the actual page content\n"
    "  3. Repeat CLICK or SEARCH until you have REAL data\n"
    "  4. Give your recommendation citing THE ACTUAL DATA you read\n\n"
    "ABSOLUTE RULES:\n"
    "- NEVER wrap tool calls in backticks or code blocks. Plain text on its own line.\n"
    "- NEVER invent prices, URLs, reviews, product names, or stats.\n"
    "- ONLY state facts that came from actual tool output.\n"
    "- If tool output says 'No results' or is empty, say that honestly — do NOT guess."
)
# Monkey-patch: build_system_prompt() reads TOOL_INSTRUCTIONS from the module globals.
aiterm.TOOL_INSTRUCTIONS = _DESKTOP_TOOL_INSTRUCTIONS

# Only these tool tags will be intercepted from AI responses.
_TOOL_RE = re.compile(
    r'^`{0,3}(SEARCH|BROWSE|CLICK|READ_MORE):\s*(.*)$',
    re.MULTILINE,
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

# Mode switch driven by POST /api/models/mode — mirrors desktop app:
#   "auto"  — pick_model() chooses per-message
#   "fast"  — force CFG.fast_model
#   "heavy" — force CFG.default_model
STATE = {"mode": "auto"}


def _resolve_model(user_text: str) -> str:
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


def _run_tool(name: str, arg: str) -> str:
    name = name.upper()
    arg = (arg or "").strip()
    try:
        if name == "SEARCH":
            return WEB.search(arg)
        if name == "BROWSE":
            url = arg if arg.startswith(("http://", "https://")) else f"https://{arg}"
            return WEB.fetch(url)
        if name == "CLICK":
            return WEB.click(arg)
        if name == "READ_MORE":
            return WEB.read_more()
    except Exception as e:
        return f"[{name} error] {e}"
    return f"[unknown tool] {name}"


def _execute_tools(response: str) -> str:
    """Run every tool tag in a response; return joined labelled output."""
    chunks = []
    for m in _TOOL_RE.finditer(response):
        name = m.group(1).upper()
        arg = m.group(2).strip()
        log.info("tool → %s: %s", name, arg[:80])
        out = _run_tool(name, arg)
        tag = {
            "SEARCH": "[SEARCH RESULTS]",
            "BROWSE": "[PAGE CONTENT]",
            "CLICK":  "[PAGE CONTENT]",
            "READ_MORE": "[PAGE CONTENT]",
        }.get(name, f"[{name}]")
        chunks.append(f"{tag}\n{out}")
    return "\n\n".join(chunks)


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    # Per-connection interrupt flag (user typed while streaming)
    interrupt = {"flag": False}

    async def _stream_turn(conv_id: int, user_text: str):
        """Run the AI + tool loop for one user turn, streaming tokens over ws."""
        model = _resolve_model(user_text)
        MEMORY.extract_facts(user_text)

        sys_prompt = build_system_prompt(
            CFG, MEMORY,
            reasoning=False,
            agent=True,
            bridge_connected=False,
            bridge_port=8950,
        )

        # Rebuild history from the db so the AI has prior context.
        history = STORE.messages(conv_id)
        api_messages: list[dict] = [{"role": "system", "content": sys_prompt}]
        for row in history:
            if row["role"] in ("user", "assistant"):
                api_messages.append({"role": row["role"], "content": row["content"]})
        api_messages.append({"role": "user", "content": user_text})

        # Persist the user message
        STORE.append(conv_id, "user", user_text)
        STORE.set_title_if_blank(conv_id, user_text)

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
                tool_out = _execute_tools(full_response)
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
            if not content:
                continue

            conv_id = data.get("conversation_id")
            if not conv_id:
                conv_id = STORE.create()
                await ws.send_json({"type": "conversation_created", "conversation_id": conv_id})

            try:
                await _stream_turn(conv_id, content)
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
    port = 8950
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
