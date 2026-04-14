# Cayden's Stack — Startup & Build Guide

> Complete reference for starting, building, and running every app and backend server in this workspace.

---

## Port Map

| Port  | Service                     | Notes                                        |
|-------|-----------------------------|----------------------------------------------|
| 1420  | Darklock Notes Desktop Vite | Dev server for the Notes Tauri debug binary  |
| 3001  | Discord Bot                 | Web dashboard / health endpoint              |
| 3002  | Darklock Platform           | Admin panel                                  |
| 3003  | Darklock Notes Server       | Encrypted notes backend (Express)            |
| 4200  | DarkLock App Server         | E2EE messaging backend (Express + WebSocket) |
| 5174  | Nova Calendar Vite          | Dev server for Calendar Electron app         |
| 8950  | JARVIS Nova AI              | FastAPI REST + WebSocket                     |
| 11434 | Ollama                      | Local LLM (required by Nova)                 |

---

## 1. One-Command Starts

### Start everything (Bot + Darklock + Guard)
```bash
./start-all.sh
```

### Stop everything
```bash
./stop-all.sh
```

### Start only the Discord bot (validates env first)
```bash
./startup.sh
```

### Start bot + Pico LED bridge (portable / Pi setup)
```bash
npm run start:portable
```

### Docker (bot + Darklock in containers)
```bash
docker-compose up --build
```

---

## 2. Discord Bot

**Location:** root directory  
**Port:** 3001  
**Language:** Node.js

### First-time setup
```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in your env file
cp .env.example .env
# Edit .env — minimum required vars:
#   DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
#   SESSION_SECRET, JWT_SECRET, BACKUP_ENCRYPTION_KEY

# 3. Generate tamper-detection baseline
node file-protection/index.js baseline
```

### Start (dev)
```bash
npm start
```

### Start (production / with nodemon auto-restart)
```bash
npm run dev
```

---

## 3. Darklock Platform (Admin Dashboard)

**Location:** `darklock/`  
**Port:** 3002  
**Language:** Node.js / Express

### First-time setup
```bash
# Uses the root npm install — no separate install needed
# Needs DARKLOCK_PORT=3002 in .env (already default)
```

### Start
```bash
node darklock/start.js
```

Or it starts automatically as part of `start-all.sh`.

---

## 4. JARVIS Nova AI

**Location:** `jarvis/`  
**Port:** 8950  
**Language:** Python 3.12  
**Requires:** Ollama running on port 11434

### Prerequisites

#### Install Ollama (if not installed)
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1:8b
```

#### Python virtual environment
```bash
cd jarvis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

#### Environment file
```bash
cp .env.example .env
# Edit jarvis/.env — key vars:
#   OPENWEATHER_API_KEY   — weather in morning briefings
#   GOVEE_API_KEY         — smart lights
#   GITHUB_TOKEN          — GitHub integration
#   ANTHROPIC_API_KEY     — Claude fallback (optional)
```

#### Google Calendar OAuth (optional — needed for calendar sync)
```bash
# Put your credentials.json from Google Cloud Console at:
#   jarvis/data/google_credentials.json
# Then run the auth flow:
source .venv/bin/activate
python -m integrations.google_auth
# Follow the browser prompt to authorize
```

### Start Nova
```bash
cd jarvis
.venv/bin/python main.py
```

Nova prints a startup banner and greets you when ready:
```
╔══════════════════════════════════════╗
║       Nova  v2.1.0                  ║
║  Backend:    http://0.0.0.0:8950    ║
║  Model:      llama3.1:8b            ║
╚══════════════════════════════════════╝
Morning, Cayden! Good to have you back.
```

### Nova API endpoints
| Method | Path                         | Description                          |
|--------|------------------------------|--------------------------------------|
| GET    | /api/health                  | Health check                         |
| POST   | /api/chat                    | Send message, get AI response        |
| WS     | /ws/chat                     | Streaming WebSocket chat             |
| GET    | /api/calendar/today          | Today's Google Calendar events       |
| GET    | /api/calendar/tomorrow       | Tomorrow's events                    |
| GET    | /api/calendar/upcoming       | Next N days of events                |
| GET    | /api/calendar/range          | Events between two ISO dates         |
| POST   | /api/calendar/create         | Quick-add event (natural language)   |
| POST   | /api/calendar/create-detailed| Structured event creation            |
| PUT    | /api/calendar/{id}           | Update an event                      |
| DELETE | /api/calendar/{id}           | Delete an event                      |
| GET    | /api/weather                 | Current weather                      |

---

## 5. Nova Calendar Desktop App

**Location:** `jarvis/calendar-app/`  
**Type:** Electron + React + Vite  
**Requires:** Node.js 18+  
**Connects to:** Nova AI at `http://127.0.0.1:8950`

### First-time setup
```bash
cd jarvis/calendar-app
npm install
```

### Start (development — opens Electron window automatically)
```bash
cd jarvis/calendar-app
    
```

Start Nova AI **first** so the calendar can sync with Google Calendar on launch.

### Build for distribution
```bash
cd jarvis/calendar-app
npm run build        # builds Vite renderer only
npm run build        # full Electron build → dist/
```

### What it does on launch
1. Opens a 1280×800 Electron window
2. Connects to Nova at port 8950
3. Syncs the next 30 days of Google Calendar events into local storage
4. Shows week view by default

### Keyboard shortcuts
| Key     | Action               |
|---------|----------------------|
| `c` / `n` | New event          |
| `t`     | Jump to today        |
| `1`     | Day view             |
| `2`     | Week view            |
| `3`     | Month view           |
| `4`     | Year view            |

---

## 6. Darklock Notes (Encrypted Notes Platform)

**Location:** `darklock-notes/`  
**Type:** npm monorepo (apps: web, server, desktop)

### First-time setup
```bash
cd darklock-notes
npm install          # installs all workspaces
```

### Start web app (React + Vite)
```bash
cd darklock-notes
npm run dev:web      # http://localhost:5173
```

### Start backend server (Express + TypeScript)
```bash
cd darklock-notes
npm run dev:server   # watches with tsx
```

### Start desktop app (Electron)
```bash
cd darklock-notes
npm run dev:desktop
```

### Build everything
```bash
cd darklock-notes
npm run build:all    # builds crypto → ui → server → web in order
```

### Start production server
```bash
cd darklock-notes
npm run build:server
npm start
```

---

## 7. Guard Service (Tamper Protection)

**Location:** `guard-v2/`  
**Language:** Rust + Tauri  
**Started automatically by:** `start-all.sh`

### Build
```bash
cd guard-v2
cargo build --release
```

### Start manually
```bash
# Daemon
./target/release/guard-service run

# Desktop UI — use the RELEASE binary (embeds its own frontend)
cd guard-v2
./target/release/darklock-guard-ui
```

> **Important:** Do NOT run the debug binary (`target/debug/darklock-guard-ui`) by itself. The debug binary loads its frontend from `localhost:5174` which conflicts with the Nova Calendar Vite dev server. Use the release binary, which has the Guard UI embedded.

### Required env var
```bash
export GUARD_VAULT_PASSWORD="your-secure-password"
```

---

## 8. DarkLock App (Encrypted Messaging)

**Location:** `darklock-app/`  
**Port:** 4200  
**Language:** Node.js (server) + Electron + React (desktop)  
**Requires:** Nothing external

### First-time setup
```bash
cd darklock-app
npm install
cp .env.example .env
# Edit .env — set JWT_SECRET and JWT_REFRESH_SECRET
```

### Start server
```bash
cd darklock-app
npm run server
```

### Start desktop app (dev)
```bash
cd darklock-app
npm run dev
```

### Build for distribution
```bash
cd darklock-app
npm run build
```

---

## 9. Pico LED Bridge

**Location:** `pico-bridge.js` (root)  
**Language:** Node.js  
**Requires:** Raspberry Pi Pico connected via USB

### Start
```bash
npm run start:bridge
```

Or as part of `npm run start:portable` (starts bot + bridge together).

The bridge auto-detects the Pico on `/dev/ttyACM*` and sends status signals (`OK`, `DEGRADED`, `FAIL`) based on `data/bot_status.json`.

---

## 10. Cloudflare Worker

**Location:** `cloudflare-worker/`  
**Deploy tool:** Wrangler

### Deploy to Cloudflare
```bash
cd cloudflare-worker
npx wrangler deploy
```

Edit `wrangler.toml` to set your Cloudflare account ID and domain (darklock.net).

---

## Recommended Full-Stack Start Order

```
1. ollama serve
     ↳ LLM backend for Nova AI (port 11434)

2. cd jarvis && .venv/bin/python main.py
     ↳ Nova AI (port 8950)

3. ./start-all.sh
     ↳ Discord bot (3001) + Darklock platform (3002)

4. node darklock-notes/apps/server/dist/index.js
     ↳ Darklock Notes server (port 3003)

5. cd darklock-app && npm run server
     ↳ DarkLock App server (port 4200)

6. Desktop apps:
   cd jarvis/calendar-app && npm run dev
     ↳ Nova Calendar Electron (Vite on 5174)

   cd jarvis/desktop && npm start
     ↳ Nova AI Desktop Electron

   cd darklock-notes/apps/desktop && npx vite --port 1420
   # then in a new terminal:
   darklock-notes/apps/desktop/src-tauri/target/debug/darklock-notes
     ↳ Darklock Notes Desktop (Tauri)

   cd guard-v2 && ./target/release/darklock-guard-ui
     ↳ Darklock Guard Desktop (Tauri release binary)

   cd darklock-app && npm run dev
     ↳ DarkLock Encrypted Messenger (Electron)
```

---

## Environment Files Checklist

| File                        | Copy from                   | Required for          |
|-----------------------------|-----------------------------|-----------------------|
| `.env`                      | `.env.example`              | Bot + Darklock        |
| `jarvis/.env`               | `jarvis/.env.example`       | Nova AI               |
| `jarvis/data/google_credentials.json` | Google Cloud Console | Calendar sync   |

---

## Troubleshooting

**Nova won't start**
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags
# If not, start it:
ollama serve
```

**Calendar app won't sync**  
Check that Nova is running and accessible at `http://127.0.0.1:8950/api/health`.

**Bot crashes on startup**  
Run `node scripts/validate-env.sh` to check for missing env vars.

**Darklock platform shows blank page**  
Check `DARKLOCK_PORT=3002` is set in `.env` and port 3002 is not already in use:
```bash
lsof -i :3002
```

**Pico not detected**  
```bash
ls /dev/ttyACM*
# Grant access if needed:
sudo chmod a+rw /dev/ttyACM0
```
