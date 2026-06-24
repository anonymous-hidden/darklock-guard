# Nova AI — Desktop

Electron + React desktop app with provider-based AI (OpenAI ChatGPT + Ollama fallback), live widget builder, and embedded Monaco coding workspace.

## Stack

- **Electron 33** — main process, IPC, popout windows
- **React 19 + Vite 6** — renderer
- **Tailwind 3** — styling (no global CSS files except `src/styles/index.css`)
- **Zustand 5** — state (`aiStore`, `widgetStore`, `appStore`)
- **Monaco Editor** — Coding tab
- **OpenAI + Ollama** — OpenAI via main-process IPC, Ollama at `http://localhost:11434`

## Run

```bash
npm install
npm run dev          # vite + electron
```

If you want ChatGPT as the primary brain, set an OpenAI API key:

```bash
# preferred
echo "OPENAI_API_KEY=sk-..." >> .env
```

Nova resolves `OPENAI_API_KEY` in this order:

1. Environment variable `OPENAI_API_KEY`
2. `jarvis/nova-ai/.env`
3. `jarvis/.env`
4. workspace root `.env`

Ollama remains available as a fallback/secondary provider. If you want local models too, run:

```bash
ollama serve
ollama pull qwen2.5:32b
ollama pull llama3.1:8b
```

## Nova Agent Behavior

The desktop chat bridge now routes common action requests through a deterministic
agent layer before falling back to the model. Nova classifies requests such as
YouTube video finding, movie search, current-site navigation, tab switching,
desktop app launching, light control, and comparison/research tasks, then shows
a short status/progress bar, performs paced browser actions, and ends with a
task report.

Useful debug prompt:

```text
debug agent
```

Example prompts:

```text
Open YouTube and find a different video about this topic
Search Amazon for a good gaming mouse under $50
Open a movie site and find a good comedy movie
Turn off my lights
Switch back to the YouTube tab
Open Brave
Summarize what you found
```

The browser bridge supports reading the current page, opening new tabs,
switching tabs, and navigating without closing tabs unless you explicitly ask.
The browser extension can be loaded in Chrome or Brave and must be connected to:

```text
ws://localhost:8950/browser-bridge
```

## Govee Lights Setup

Nova looks for `GOVEE_API_KEY` in this order:

1. Environment variable `GOVEE_API_KEY`
2. Project root `.env`
3. `jarvis/.env`
4. `jarvis/nova-ai/.env`

Add:

```bash
GOVEE_API_KEY=your-key
```

If the key is missing, Nova logs a clear warning and keeps running. Light
requests will report the missing key instead of crashing the assistant.

Supported light modes include:

- `movie mode` -> dim blue scene
- `focus mode` -> bright white scene
- `normal mode` or `lights on` -> turn lights on
- `lights off` -> turn lights off
- custom colors/brightness, for example `turn lights blue` or `brightness 40`

## Layout

```
nova-ai/
├── electron/                # main process + IPC handlers
├── src/
│   ├── core/ai/             # OllamaClient, ConversationManager, PromptEngine,
│   │                        # WidgetBuilder, CodeExtractor
│   ├── components/          # chat, command-center, widget-studio, coding-tab, shared
│   ├── tabs/                # 4 tab roots
│   ├── store/               # zustand stores
│   ├── hooks/               # useOllama, useWidgetBuilder, useStreaming
│   ├── App.jsx, main.jsx
│   └── styles/index.css
├── widgets/                 # generated widgets + registry.json
└── archive/                 # legacy desktop kept for reference
```
