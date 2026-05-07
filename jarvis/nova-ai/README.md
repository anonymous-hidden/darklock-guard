# Nova AI — Desktop

Electron + React desktop app with direct Ollama integration (qwen2.5:32b default, llama3.1:8b fast fallback), live widget builder, and embedded Monaco coding workspace.

## Stack

- **Electron 33** — main process, IPC, popout windows
- **React 19 + Vite 6** — renderer
- **Tailwind 3** — styling (no global CSS files except `src/styles/index.css`)
- **Zustand 5** — state (`aiStore`, `widgetStore`, `appStore`)
- **Monaco Editor** — Coding tab
- **Ollama** — direct HTTP at `http://localhost:11434`

## Run

```bash
npm install
npm run dev          # vite + electron
```

Requires Ollama running locally:
```bash
ollama serve
ollama pull qwen2.5:32b
ollama pull llama3.1:8b
```

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
