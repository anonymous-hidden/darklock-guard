# Nova Terminal v2 — Complete Reference

Nova is a local AI assistant that runs entirely on your machine via Ollama. It's a single Python file (`ai-terminal.py`) with persistent memory, a real web browser, smart home control, reminders/timers, live weather, and a Chrome extension bridge — all accessible through a clean terminal UI or through the Jarvis Nova desktop app.

---

## Quick Start

```bash
cd "/home/cayden/discord bot/discord bot"

python3 ai-terminal.py              # Default model (qwen2.5:32b)
python3 ai-terminal.py llama3.1:8b  # Fast model
python3 ai-terminal.py llama3.2:3b  # Lightweight
```

**Prerequisites:**
- Ollama running: `ollama serve`
- Models pulled: `ollama pull qwen2.5:32b` and `ollama pull llama3.1:8b`
- Python packages: `rich`, `prompt_toolkit`, `requests`, `beautifulsoup4`, `httpx`, `websockets`

---

## Architecture Overview

```
ai-terminal.py
├── MemoryDB          — SQLite persistent memory (~/.ai-terminal/memory.db)
├── WebBrowser        — Real HTTP page fetching + Mojeek search
├── BrowserBridgeServer — WebSocket server for Chrome extension (port 8950/8951)
├── ReminderManager   — Background thread for reminders & countdown timers
├── GoveeController   — Async Govee smart light API wrapper
├── ProactiveVoice    — Background thread that occasionally speaks first
├── AITerminal        — Main class: prompt session, tool loop, slash commands
└── build_system_prompt — Dynamic system prompt assembled fresh each message
```

The AI runs a **tool loop**: it responds, tools execute, results feed back in, and the AI continues — up to 6 rounds per message.

---

## Models & Routing

| Model | Role | Used When |
|-------|------|-----------|
| `qwen2.5:32b` | Deep / default | Complex tasks, weather, research, code |
| `llama3.1:8b` | Fast | Simple questions, greetings |
| `llama3.2:3b` | Lightweight | Available as fallback |

**Auto-routing** is on by default. Simple one-liners go to `llama3.1:8b`; anything involving weather, storms, research, code, analysis, or long messages routes to `qwen2.5:32b`. Toggle with `/auto`.

---

## Slash Commands

### Core

| Command | What it does |
|---------|-------------|
| `/model <name>` | Switch to a specific model |
| `/models` | List all models Ollama has installed |
| `/auto` | Toggle auto model routing on/off |
| `/clear` | Clear the current conversation |
| `/temp <0-2>` | Set temperature (default 0.7) |

### Modes

| Command | What it does |
|---------|-------------|
| `/think` | Toggle reasoning mode — AI wraps thinking in `<thinking>` tags, silently buffered |
| `/agent` | Toggle agent tool loop on/off |
| `/orchestrate <req>` | Delegate to NOVA multi-agent orchestrator (if configured) |
| `/nova <req>` | Alias for `/orchestrate` |

### Memory

| Command | What it does |
|---------|-------------|
| `/remember <key> = <value>` | Save a fact to persistent memory |
| `/recall <query>` | Search memories |
| `/memories` | Show all stored memories |
| `/forget <key>` | Delete a memory entry |
| `/profile` | Show user profile facts |

### Tools

| Command | What it does |
|---------|-------------|
| `/time` | Current date & time with timezone |
| `/weather` | Current conditions for Kansas City |
| `/sys` | CPU, RAM, disk usage |
| `/search <query>` | Search the web via Mojeek |
| `/browse <url>` | Fetch and read a web page |
| `/links` | Show numbered links from the last fetched page |
| `/browser` | Show Chrome extension bridge status |
| `/remind <time> \| <label>` | Set a reminder (e.g. `/remind in 5 minutes \| check oven`) |
| `/reminders` | List all pending reminders and timers |
| `/timers` | Alias for `/reminders` |
| `/lights [on\|off\|<color>\|bright <n>]` | Control all Govee lights |

### Session

| Command | What it does |
|---------|-------------|
| `/persona <casual\|formal\|concise>` | Change personality mode |
| `/config` | Show current config values |
| `/copy` | Copy last AI response to clipboard |
| `/save` | Save the conversation to `~/ai-conversations/` |
| `/stats` | Show token count and speed stats |
| `/exit` | Quit |

---

## Agent Tools (AI uses these automatically)

When the AI needs live data it emits a tool command on its own line. The tool runs, results are fed back, and the AI continues. Up to 6 tool rounds per message.

### Web Browsing (independent — no Chrome needed)

| Tool | Syntax | What it does |
|------|--------|-------------|
| `SEARCH` | `SEARCH: <query>` | Searches Mojeek, returns 10 numbered results with URLs |
| `BROWSE` | `BROWSE: <url>` | Fetches the page, extracts readable text + numbered links |
| `CLICK` | `CLICK: <number or text>` | Follows a numbered link from the current page |
| `READ_MORE` | `READ_MORE:` | Gets the next 4000 chars of the current page |

### Live Chrome Browser (requires extension)

| Tool | Syntax | What it does |
|------|--------|-------------|
| `BROWSER_PAGE` | `BROWSER_PAGE:` | Reads the text of the tab currently open in Chrome |
| `BROWSER_TABS` | `BROWSER_TABS:` | Lists all open tabs |
| `BROWSER_READ_SELECTION` | `BROWSER_READ_SELECTION:` | Reads text the user has highlighted |
| `BROWSER_NAVIGATE` | `BROWSER_NAVIGATE: <url>` | Navigates Chrome to a URL |
| `BROWSER_CLICK` | `BROWSER_CLICK: <selector>` | Clicks an element by CSS selector or text |
| `BROWSER_FOCUS` | `BROWSER_FOCUS: <selector>` | Focuses an input/textarea |
| `BROWSER_TYPE` | `BROWSER_TYPE: <text>` | Types text at the cursor |
| `BROWSER_KEY` | `BROWSER_KEY: <key> [ctrl\|shift\|alt]` | Presses a key (Enter, Tab, etc.) |
| `BROWSER_SELECT_ALL` | `BROWSER_SELECT_ALL:` | Ctrl+A in the browser |
| `BROWSER_JS` | `BROWSER_JS: <code>` | Executes JavaScript in the page |

### Weather (live NWS data — no API key needed)

| Tool | What it does |
|------|-------------|
| `WEATHER:` | Current conditions for Kansas City (temp, wind, short forecast) |
| `WEATHER_FORECAST:` | Full 7-day / 14-period NWS forecast |
| `WEATHER_ALERTS:` | Active alerts for your **exact GPS coordinates** (not state-wide) |

**Important:** Nova always calls these tools before answering any weather question. It never answers from training data (which would be stale past events).

### Memory

| Tool | Syntax | What it does |
|------|--------|-------------|
| `REMEMBER` | `REMEMBER: <key> = <value>` | Saves a fact to SQLite |
| `RECALL` | `RECALL: <query>` | Fuzzy-searches stored memories |

### Reminders & Timers

| Tool | Syntax | Examples |
|------|--------|---------|
| `SET_REMINDER` | `SET_REMINDER: <time> \| <label>` | `SET_REMINDER: at 3:30pm \| dentist appointment` |
| `SET_TIMER` | `SET_TIMER: <duration> \| <label>` | `SET_TIMER: 20 minutes \| pasta` |
| `LIST_REMINDERS` | `LIST_REMINDERS:` | Shows all pending reminders with IDs |
| `CANCEL_REMINDER` | `CANCEL_REMINDER: <id>` | Cancels a reminder by its ID number |

**Supported time formats:** `in 5 minutes`, `30s`, `2h`, `at 3:30pm`, `at 15:00`, `tomorrow at 9am`

When a reminder fires, a Rich panel notification appears in the terminal.

### Govee Smart Lights

| Tool | Syntax | Examples |
|------|--------|---------|
| `LIGHTS_ON` | `LIGHTS_ON: [device name]` | `LIGHTS_ON:` (all) or `LIGHTS_ON: Cayden's room` |
| `LIGHTS_OFF` | `LIGHTS_OFF: [device name]` | `LIGHTS_OFF:` or `LIGHTS_OFF: Halloween light` |
| `LIGHTS_COLOR` | `LIGHTS_COLOR: <color> [\| device]` | `LIGHTS_COLOR: purple` or `LIGHTS_COLOR: blue \| desk` |
| `LIGHTS_BRIGHTNESS` | `LIGHTS_BRIGHTNESS: <0-100> [\| device]` | `LIGHTS_BRIGHTNESS: 50` or `LIGHTS_BRIGHTNESS: 80 \| Cayden's room` |
| `LIGHTS_LIST` | `LIGHTS_LIST:` | Lists all Govee devices on the account |

**Named colors:** red, orange, yellow, green, cyan, blue, purple, pink, magenta, white, warm white, cool white, sky blue, mint, lavender, coral, gold, teal, lime, rose, amber.

You can also use hex (`#ff00ff`) or RGB (`255,0,255`).

**API key:** Automatically resolved from `GOVEE_API_KEY` env var → main `.env` → `jarvis/.env`.

### Other Tools

| Tool | Syntax | What it does |
|------|--------|-------------|
| `OPEN_URL` | `OPEN_URL: <url>` | Opens a URL in your default browser |
| `RUN_CMD` | `RUN_CMD: <command>` | Runs a shell command (you confirm first) |
| `SYSTEM_INFO` | `SYSTEM_INFO:` | CPU, RAM, disk stats |
| `LOCATION` | `LOCATION:` | Resolves fresh location from ip-api.com |

---

## Persistent Memory

Memory is stored in SQLite at `~/.ai-terminal/memory.db`. It survives across sessions.

- **Auto-extraction:** Nova automatically extracts facts from messages (name mentions, preferences, projects, locations).
- **Manual:** Use `/remember key = value` or say "remember that..." and the AI will call `REMEMBER:`.
- **Profile:** Key facts (name, location, role) stored separately and injected into every system prompt.
- **Context injection:** Top 10 most important/accessed memories are included in every system prompt so Nova always knows them.
- **Conversation history:** Last 3 conversation summaries are also injected as context.

---

## Chrome Extension Bridge

The bridge runs a WebSocket server on port 8950 (falls back to 8951 if busy).

When the Nova Chrome extension is connected, Nova can:
- Read your currently open tab
- See all your tabs
- Navigate to URLs
- Click elements, type text, press keys
- Read your highlighted text
- Run JavaScript

**Extension setup:** Set the backend URL to `ws://localhost:8950/browser-bridge` in the extension settings.

**Google Docs workflow:** Nova won't re-navigate to a doc that's already open. It clicks into the editor and types directly.

---

## Personality Modes

| Mode | Behavior |
|------|---------|
| `casual` | Conversational, dry wit, uses contractions, calls you by name. Default. |
| `formal` | Precise and structured, still opinionated. |
| `concise` | Terse. One-liners. "CPU: 42%. Auth broken. Line 47." |

Switch with `/persona <mode>`.

---

## System Prompt

The system prompt is rebuilt fresh before every message and includes:
1. Current date/time (authoritative — Nova always knows the exact time)
2. Nova's identity and personality
3. Top 10 memories + last 3 conversation summaries
4. User profile facts
5. All tool instructions (when agent mode is on)
6. Chrome extension status
7. Current GPS location
8. System platform info
9. Final identity anchor

---

## Desktop App Mode

Nova Terminal can run as a FastAPI backend for the Jarvis Nova Electron desktop app.

```bash
cd "/home/cayden/discord bot/discord bot"
.venv/bin/python ai-terminal-server.py        # port 8950
```

This exposes the same Nova brain (prompt, memory, SEARCH/BROWSE tools, auto-routing) via the REST + WebSocket API the desktop app already speaks. The desktop app needs zero changes — it just talks to port 8950 as normal.

**Conversations** for the desktop are stored separately at `~/.ai-terminal/desktop-conversations.db`.

---

## Config

Stored at `~/.ai-terminal/config.json`. Editable with `/config` to view.

| Key | Default | Description |
|-----|---------|-------------|
| `default_model` | `qwen2.5:32b` | Model for complex/deep tasks |
| `fast_model` | `llama3.1:8b` | Model for simple/fast tasks |
| `auto_route` | `true` | Auto-select model per message |
| `temperature` | `0.7` | LLM temperature |
| `owner` | `Cayden` | Your name — used in the system prompt |
| `ai_name` | `Nova` | AI's name |
| `personality` | `casual` | Personality mode |
| `timezone` | `America/Chicago` | Timezone for date/time |
| `city` / `state` | `Kansas City` / `MO` | Location for weather |
| `lat` / `lon` | `39.0997` / `-94.5786` | GPS for precise weather alerts |
| `ollama_url` | `http://localhost:11434` | Ollama API endpoint |

`govee_api_key`, `nws_api_key`, and `weather_api_key` always load from environment variables — never from the saved JSON.

---

## Data & Files

| Path | What it is |
|------|-----------|
| `~/.ai-terminal/memory.db` | SQLite: memories, user profile, conversation summaries |
| `~/.ai-terminal/config.json` | Persisted config (non-sensitive keys) |
| `~/.ai-terminal/history` | Prompt-toolkit input history (arrow-up recall) |
| `~/.ai-terminal/desktop-conversations.db` | Conversations from the desktop app |
| `~/ai-conversations/` | Saved conversation exports (`/save` command) |

---

## Multi-line Input

End a line with `\` to continue on the next line. Or press `Alt+Enter` (Escape then Enter) for a literal newline in the prompt.

---

## Proactive Voice

Nova has a background thread that will occasionally speak first after a period of silence — for example to follow up on something mentioned earlier or surface a relevant thought. It respects a quiet period after you last sent a message.

---

## Tips

- Ask "how's the weather?" and Nova will call `WEATHER:`, `WEATHER_FORECAST:`, and `WEATHER_ALERTS:` automatically before answering — with live NWS data, not training data.
- Ask "turn the lights purple" and Nova calls `LIGHTS_COLOR: purple` — it covers all devices unless you specify one.
- Ask "remind me in 20 minutes to check my laundry" and Nova calls `SET_TIMER: 20 minutes | check laundry` — the timer fires even while you're in another conversation.
- Ask "search for the best mechanical keyboards under $100" and Nova will SEARCH, CLICK through results, and give you real prices.
- Say "remember that I prefer dark mode" and Nova saves it to memory and references it in future sessions.
- The Chrome extension lets Nova read what you're looking at and type into any page — useful for filling forms, writing in Google Docs, or navigating sites on your behalf.
