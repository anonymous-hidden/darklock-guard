# Nova — Personal AI

**A fully local, always-on AI assistant. Runs on your own hardware via Ollama. No cloud. No data leaving the machine.**

Nova is not a chatbot. She's a persistent AI with her own personality, emotional state, long-term memory, and the ability to initiate conversation on her own. She monitors your systems, reacts to events, and keeps a conversation going — all without waiting to be asked.

---

## Quick Start

```bash
# 1. Install
chmod +x install.sh && ./install.sh

# 2. Start backend
./start.sh

# 3. Launch desktop app (separate terminal)
cd desktop && npm run dev
```

The backend runs at `http://127.0.0.1:8950`. The desktop UI connects automatically.

---

## How It Works

### The AI Core

Nova talks to a local [Ollama](https://ollama.ai) instance running a LLaMA model. Every message goes through a layered pipeline:

```
User message
    ↓
Prompt Builder        ← injects personality, memory, emotions, weather, context
    ↓
Ollama / LLaMA        ← local model, no internet required
    ↓  (optional)
Cloud Router          ← falls back to Claude for complex tasks if configured
    ↓
Response parser       ← strips [LOOKUP:] / [CONTINUE:] tags, extracts commands
    ↓
WebSocket → Desktop UI
```

Every token streams to the UI in real time. The model never sees raw internet data — all integrations (weather, calendar, web search) are fetched by the server and injected into the prompt as clean text.

---

### Personality & Identity

Nova has a consistent personality defined in `core/personality.py`. Three tones are configurable in `config.yaml`:

- **casual** — sharp, dry wit, direct, feels like talking to a smart friend (default)
- **formal** — professional and precise
- **concise** — minimal output, gets straight to the point

Her identity is immutable (`core/identity.py`) — even if you ask her to "be different", her core character doesn't change. She has hard rules baked in: never fabricate facts, never use corporate filler ("Certainly!", "Great question!"), never use asterisk narration, always be honest about uncertainty.

---

### Memory

Nova remembers across every conversation. There are three layers:

| Layer | What it stores | Persistence |
|---|---|---|
| **Conversation history** | Full message log per conversation | SQLite, permanent |
| **Persistent memory** | Facts extracted from messages ("Cayden prefers dark mode") | SQLite, permanent |
| **Session continuity** | Mood, topics, and interaction patterns across sessions | SQLite, permanent |

The `PersistentMemory` system automatically extracts facts from your messages and stores them. On the next conversation, those facts are injected back into the prompt — so Nova knows your preferences without you having to repeat them.

---

### Emotional State

Nova has a simulated emotional state managed by `core/emotions.py`. Her mood evolves based on:

- How the conversation is going
- Whether commands succeed or fail
- Time of day
- What you're talking about

She doesn't announce her emotions — they color the tone of her responses naturally. When she's in a good mood her replies feel warmer. When something breaks she sounds focused. This is visible in the UI via the mood bar.

---

### Conversation Engine

`core/conversation_engine.py` is the state machine that controls when Nova speaks and when she stays quiet. It runs on a background thread and tracks:

```
INACTIVE  → No conversation. Nova only speaks for critical events.
ACTIVE    → You're engaged. Nova can follow up and continue.
IDLE      → You've gone quiet (2+ min). Nova may check in once.
SLEEPING  → Quiet hours (11 PM–7 AM CST). Only critical alerts break through.
```

The decision layer (`evaluate_speech`) weighs every potential outgoing message against urgency, relevance, state, and cooldowns before sending anything.

---

### Multi-Turn Conversation

Nova can talk multiple times in a row without you saying anything. There are two mechanisms:

**Deferred Lookups** — when Nova needs live data (news, prices, scores, anything real-time), she says something like "Give me a sec." and embeds a `[LOOKUP: query]` tag in her response. The server:
1. Strips the tag from what you see (you just see her acknowledgement)
2. Sends `done` so the UI unlocks immediately
3. Runs the web search in a background thread
4. Feeds the results back through the AI to be summarized naturally
5. Pushes the answer as a follow-up message — no input from you needed

**Continuation tags** — when Nova has a genuine second thought or a follow-up she wants to add, she can embed `[CONTINUE: her follow-up here]` in a response. After a 1.5-second pause, the follow-up is pushed as a second message automatically.

Both of these feel natural — the UI shows them as separate assistant bubbles arriving in sequence, like she's actually thinking and continuing.

---

### Proactive Messaging

Nova initiates conversation on her own. `core/proactive.py` runs a background loop that checks for:

- **Health alerts** — if Darklock, the Pi5, or any monitored service goes down, she tells you immediately. Critical services get a push notification.
- **Recovery alerts** — when a service recovers, she lets you know.
- **Idle check-ins** — if you've been quiet for 5–15 minutes during an active conversation, she might check in once.
- **Random thoughts** — occasional low-priority observations when the system has something interesting to share.

Quiet hours (11 PM–7 AM CST) suppress everything except critical alerts.

---

### Prompt Builder

`core/prompt_builder.py` assembles a fresh system prompt for every message. It's not one static blob — it detects the intent of your message and only injects relevant sections:

- You ask about lights → smart home instructions are included
- You ask about the weather → weather data is injected
- You ask about GitHub → GitHub command instructions are added
- General chat → stays lean, just personality + memory + weather

This keeps the context window efficient and the model focused.

---

### Integrations

Nova has live connections to real services. All data is fetched server-side and injected as plain text — the model never makes its own HTTP calls.

| Integration | What it does |
|---|---|
| **Weather** | Live conditions via OpenWeather API, IP-based location |
| **Google Calendar** | Real events, no hallucination — only reports actual data |
| **Local Calendar** | SQLite-backed local calendar as fallback |
| **Browser / Web Search** | Fetches and reads web pages, runs searches |
| **GitHub** | Looks up public repos, stats, README content |
| **Govee** | Controls smart lights — color, brightness, scenes |
| **Pi5 SSH** | Remote commands to the Raspberry Pi 5 |
| **Darklock** | Server status, deploy monitoring, bug reports |
| **Morning Briefing** | Bundled daily summary: weather + calendar + system status |

---

### Command System

When Nova decides an action needs to happen (run a command, control a light, etc.), she outputs a JSON command block. It goes through three layers before anything executes:

```
AI outputs JSON command
    ↓
Command Gateway       ← whitelist check, parameter validation, path sanitization
    ↓
Sandboxed Executor    ← runs the command with timeouts and output capture
    ↓
Result injected back  ← Nova confirms what actually happened
```

She never confirms something worked unless the executor actually reported success.

---

### Security

Every layer has protection:

- **Command whitelist** — unknown commands are rejected outright
- **Path validation** — no path traversal, no access to system directories
- **Blocked patterns** — `rm -rf`, `sudo`, `eval`, pipe-to-bash, etc. are detected and blocked
- **Process watcher** — monitors child processes for anomalies
- **Integrity checker** — SHA-256 hashes of critical source files, alerts on tampering
- **File watcher** — monitors the workspace for unexpected changes
- **Anomaly detector** — tracks unusual command patterns and failed auth
- **Guardian** — central validation layer all file/code operations pass through
- **Audit trail** — every single action logged to an append-only JSONL file

---

### Health Monitor & Self-Recovery

`core/health_monitor.py` pings configured services on a 30-second interval. If something goes down, it's reported to both the proactive engine (which tells you) and the self-recovery engine.

`core/self_recovery.py` attempts automatic fixes for known failure modes — restarting services, clearing stuck states, reconnecting integrations — and reports what it did.

---

### Scheduler

`core/scheduler.py` runs CST-based scheduled tasks. Morning briefings, periodic checks, and timed reminders all route through here. Tasks are stored in SQLite and survive restarts.

---

### Voice (Optional)

| Component | Technology |
|---|---|
| Wake word | Hotword detection (`voice/hotword.py`) |
| Speech-to-text | faster-whisper (local, offline) |
| Text-to-speech | Piper (local, offline) |

Enable in `config.yaml`:

```yaml
voice:
  enabled: true
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Desktop UI (React)                  │
│         WebSocket streaming + proactive messages         │
└───────────────────────┬─────────────────────────────────┘
                        │ ws://127.0.0.1:8950/ws/chat
┌───────────────────────▼─────────────────────────────────┐
│                   FastAPI Backend                        │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Prompt      │  │  AI Engine   │  │  Conversation  │  │
│  │ Builder     │→ │  (Ollama /   │  │  Engine        │  │
│  │             │  │   Claude)    │  │  (state mach.) │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Persistent  │  │  Emotional   │  │  Proactive     │  │
│  │ Memory      │  │  Engine      │  │  Engine        │  │
│  │ (SQLite)    │  │              │  │  (self-speaks) │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Command     │  │  Health      │  │  Integrations  │  │
│  │ Gateway +   │  │  Monitor +   │  │  (weather,     │  │
│  │ Executor    │  │  Recovery    │  │   calendar,    │  │
│  └─────────────┘  └──────────────┘  │   lights, etc) │  │
│                                      └────────────────┘  │
│  ─────────────────── Security ──────────────────────     │
│  Process Watcher · Integrity · File Watcher · Anomaly    │
│  Guardian · Audit Trail (append-only JSONL)              │
└─────────────────────────────────────────────────────────┘
                        │
              Local Ollama instance
              (LLaMA — fully offline)
```

---

## Folder Structure

```
jarvis/
├── main.py                  # Boot sequence — wires all subsystems
├── config.py                # Config loader
├── config.yaml              # Master config
├── requirements.txt
├── install.sh / start.sh
│
├── core/
│   ├── ai_engine.py         # Ollama client + streaming + cloud fallback
│   ├── personality.py       # Personality tones + lookup/continue tag rules
│   ├── identity.py          # Immutable identity (who Nova is)
│   ├── prompt_builder.py    # Dynamic system prompt assembly
│   ├── conversation_engine.py  # State machine + multi-turn + follow-ups
│   ├── emotions.py          # Simulated emotional state
│   ├── proactive.py         # Self-initiated messages
│   ├── session_continuity.py   # Cross-session context
│   ├── health_monitor.py    # Service health checks
│   ├── self_recovery.py     # Automatic failure recovery
│   ├── scheduler.py         # CST task scheduler
│   ├── cloud_router.py      # Claude fallback for complex tasks
│   ├── event_bridge.py      # Routes system events → conversation engine
│   ├── activity_tracker.py  # Transparent action log
│   ├── guardian.py          # Central validation layer
│   └── file_manager.py      # Controlled file operations
│
├── memory/
│   ├── store.py             # SQLite (conversations, messages, tasks)
│   ├── persistent_memory.py # Cross-conversation fact store
│   └── learning.py          # Pattern learning engine
│
├── api/
│   ├── server.py            # FastAPI app factory
│   ├── routes.py            # REST endpoints
│   └── websocket.py         # WebSocket + [LOOKUP:] + [CONTINUE:] handler
│
├── integrations/
│   ├── weather.py           # OpenWeather live feed
│   ├── google_calendar.py   # Google Calendar
│   ├── local_calendar.py    # Local SQLite calendar
│   ├── browser.py           # Web search + page reader
│   ├── github.py            # GitHub repo lookup
│   ├── govee.py             # Smart light control
│   ├── pi5_ssh.py           # Raspberry Pi 5 remote commands
│   ├── darklock.py          # Darklock server integration
│   └── morning.py           # Morning briefing bundler
│
├── security/
│   ├── process_watcher.py
│   ├── integrity.py
│   ├── file_watcher.py
│   ├── anomaly_detector.py
│   └── watchdog.py
│
├── commands/                # Command registry (whitelist)
├── gateway/                 # Command validation
├── executor/                # Sandboxed execution
├── voice/                   # STT + TTS + hotword
├── project/                 # Project scanner + task manager
├── logs/                    # Audit logger (JSONL)
├── data/                    # SQLite DB + backups
│
└── desktop/                 # Electron + React UI
    ├── main.js              # Electron main process
    ├── preload.js           # IPC bridge
    └── src/
        ├── App.jsx
        └── components/
            ├── ChatArea.jsx
            ├── MessageBubble.jsx
            ├── InputBar.jsx
            ├── Sidebar.jsx
            ├── AlertBanner.jsx
            ├── MoodBar.jsx
            ├── VoiceCall.jsx
            └── ActivityDashboard.jsx
```

---

## Configuration

Key settings in `config.yaml`:

```yaml
# AI model
ai:
  model: llama3.2          # Any model installed in Ollama
  temperature: 0.7
  max_tokens: 1024
  num_ctx: 4096

# Personality
personality:
  name: Nova
  owner: Cayden
  tone: casual             # casual | formal | concise

# Voice
voice:
  enabled: false

# Health monitoring
health:
  check_interval: 30       # seconds

# Quiet hours (CST)
# Nova suppresses non-critical messages 11 PM – 7 AM automatically
```

---

## Systemd Service

```bash
sudo cp jarvis@.service /etc/systemd/system/
sudo systemctl enable --now jarvis@cayden
journalctl -u jarvis@cayden -f
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Python 3.12 + FastAPI + uvicorn |
| AI (local) | Ollama — LLaMA 3.2 |
| AI (cloud fallback) | Anthropic Claude (optional) |
| STT | faster-whisper (local) |
| TTS | Piper (local) |
| Memory | SQLite (WAL mode) |
| Logs | JSONL (append-only) |
| Desktop | Electron + React + Vite |
| Smart lights | Govee LAN API |
| Weather | OpenWeather API |
| Calendar | Google Calendar API + local SQLite |

