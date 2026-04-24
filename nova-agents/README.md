# NOVA — Local Multi-Agent Orchestrator (Ollama)

A local-first multi-agent system where a **Supervisor** plans tasks and delegates
work to specialized agents (Planner, Researcher, Coder, Security Reviewer,
Memory, Summarizer) running on your local Ollama. Terminal-first, structured
JSON I/O, sandboxed tools, human-approval gating for risky actions.

---

## Setup

```bash
cd nova-agents
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# make sure ollama is up
ollama serve &
ollama pull llama3.1:8b          # default; or set any model in config/config.yaml
```

Run:

```bash
# interactive
python main.py

# one-shot
python main.py "summarize the layout of ./nova"
```

Flags:

| flag | effect |
|---|---|
| `--verbose` | dump every step's output |
| `--no-plan` | hide plan table |
| `--deny-approvals` | non-interactive: auto-deny every approval prompt |
| `--config-dir PATH` | use an alternate config directory |

---

## Configuration

Three YAML files under `config/`:

- `config.yaml` — ollama host/model, orchestrator limits, safety, memory/log paths, terminal UI.
- `agents.yaml` — per-agent model, temperature, prompt file, tool allowlist.
- `tools.yaml` — permission level (`read`/`write`/`exec`) per tool.

Per-agent models: set `agents.yaml > <agent>.model: "qwen2.5:32b"` to run a
heavier model for one role while others use the default. `null` = use
`ollama.default_model`.

---

## Shell safety modes

`config.yaml > safety.shell_mode`:

- `safe` — only commands whose binary is in `shell_allowlist` are allowed.
- `approval` — allowlisted commands run automatically; anything else prompts the user.
- `permissive` — no prompts (not recommended).

Denylist patterns always block (rm -rf, fork bombs, curl|sh, sudo, ...).
All shell attempts — allowed, denied, and approved — are logged to
`logs/nova.jsonl`.

---

## Memory

SQLite at `data/memory.sqlite`. Tools `append_memory_note` and
`retrieve_memory_notes` provide deterministic store/search by substring, key,
tags, or recency. Schema is intentionally small so a vector backend (e.g.
`sqlite-vec`, `chromadb`) can be swapped in without touching agents.

---

## Logs

JSONL at `logs/nova.jsonl`. One line per event: task lifecycle, agent calls,
validation failures, tool invocations, shell attempts/approvals. Tail it:

```bash
tail -f logs/nova.jsonl | jq .
```

---

## Folder layout

```
nova-agents/
├── main.py                      # entrypoint: python main.py [prompt...]
├── requirements.txt
├── config/
│   ├── config.yaml              # runtime config
│   ├── agents.yaml              # per-agent model/prompt/tools
│   └── tools.yaml               # per-tool permission levels
└── nova/
    ├── agents/
    │   ├── base.py              # Agent + AgentConfig, call loop, structured parse
    │   ├── factory.py           # builds all agents from config
    │   └── specialists.py       # SupervisorAgent, PlannerAgent, ...
    ├── core/
    │   ├── ollama_client.py     # /api/chat client with JSON-mode
    │   ├── orchestrator.py      # plan → delegate → validate → summarize
    │   ├── router.py            # maps PlanStep.agent → Agent instance
    │   └── validator.py         # robust JSON extraction + pydantic validation
    ├── memory/
    │   └── store.py             # SQLite notes store
    ├── prompts/
    │   ├── supervisor.txt
    │   ├── planner.txt
    │   ├── researcher.txt
    │   ├── coder.txt
    │   ├── security.txt
    │   ├── memory.txt
    │   └── summarizer.txt
    ├── schemas/
    │   └── models.py            # Pydantic: Plan, PlanStep, Task, CodeResult, ...
    ├── tools/
    │   ├── registry.py          # Tool + ToolRegistry
    │   ├── file_tools.py        # read/write/list/search with FS sandbox
    │   ├── shell_tool.py        # run_shell_command + ShellPolicy
    │   ├── memory_tools.py      # append/retrieve notes + log_event
    │   └── __init__.py          # wires registry from config
    ├── utils/
    │   ├── config.py            # YAML + dotted-path loader
    │   ├── logging.py           # JsonlLogger
    │   └── approval.py          # ApprovalGate (y/N)
    └── cli/
        └── terminal.py          # rich UI, interactive loop, build_stack()
```

---

## How it works (the orchestration loop)

1. User submits a request.
2. `Orchestrator.run()` creates a `Task` and calls the **Supervisor** agent
   (JSON mode). The supervisor returns a `Plan`:
   - `direct_answer` → short-circuit, task is done.
   - `steps[]` → ordered specialist steps with `depends_on` wiring.
3. For each step the orchestrator:
   - builds a prompt containing the step description, `inputs`, and the JSON
     outputs of its declared `depends_on` steps;
   - calls the target specialist with its pydantic schema;
   - on parse failure, re-asks the agent (`max_validation_retries`) with the
     error fed back in;
   - records the output in the task state.
4. The final `summarizer` step produces a `FinalAnswer`. If no summarizer was
   in the plan, one is forced at the end.
5. Everything emits structured JSONL log events.

Tools are **not** invoked freely by the LLM; they are invoked by agent code
that is explicitly wired to a tool (today: researcher/coder/memory/security
via their config). This is deliberate — it keeps the safety surface small and
auditable. A free-form tool-call loop can be layered on later without
changing the orchestrator.

---

## Example usage

```
$ python main.py
╭──────────────────────────────────────────────╮
│ NOVA  local multi-agent orchestrator         │
│ supervisor ▸ planner ▸ ... ▸ summarizer      │
╰──────────────────────────────────────────────╯
you › list the python files in ./nova and summarize what orchestrator.py does

                       plan
 # │ agent       │ description                      │ deps
───┼─────────────┼──────────────────────────────────┼─────
 1 │ researcher  │ list nova/ tree, read orch file  │  -
 2 │ summarizer  │ compose final answer             │  1

                   execution
 # │ agent      │ status │ ms
───┼────────────┼────────┼──────
 1 │ researcher │ ok     │ 2104
 2 │ summarizer │ ok     │  812

╭─ nova ──────────────────────────────────────────╮
│ nova/ contains ... orchestrator.py implements   │
│ the plan-delegate-validate loop described ...   │
│                                                 │
│ highlights                                      │
│ - supervisor produces a Plan in JSON mode       │
│ - validator retries malformed outputs           │
│ - final summarizer step is enforced             │
╰─────────────────────────────────────────────────╯
```

Direct-answer path (no delegation):

```
you › hi nova
(plan: direct answer)
╭─ nova ─────────────╮
│ Hey. What's up?    │
╰────────────────────╯
```

---

## Example multi-agent flow (research → code → security → summarize)

Request: *"Add a `__version__` string to `nova/__init__.py` and make sure it's safe."*

1. **Supervisor** plans 4 steps.
2. **Researcher** reads the file.
3. **Coder** emits a `CodeResult` with one `modify` patch.
4. **Security** reviews the patch (expected: `approved=true`).
5. **Summarizer** writes the user-facing reply including the proposed patch.

Patches are intentionally **not auto-applied**. Apply them yourself from the
summarizer output, or later extend `orchestrator.py` to call `write_file`
after security approval + human confirmation.

---

## Example memory note

```
you › /help
...
you › remember that this repo uses sqlite for memory
# supervisor plans a single "memory" step; memory agent returns:
# {"action":"store","key":"memory-backend","value":"sqlite",...}
# orchestrator's summarizer confirms: "Stored."
```

Inspect:

```bash
sqlite3 data/memory.sqlite "SELECT * FROM notes ORDER BY id DESC LIMIT 5;"
```

---

## Example structured log line

```json
{"ts":1745270000.123,"level":"INFO","event":"step.done","task_id":"a1b2c3","step":2,"agent":"coder","ms":1834}
```

---

## Recommended next upgrades

1. **Free tool-call loop** — let researcher/coder/security call tools mid-turn
   by parsing a `TOOL:` JSON directive from their output, executing it
   server-side, and feeding the result back in (second round). Cap at 3-5
   rounds per step.
2. **Vector memory** — swap `MemoryStore.search()` for an embedding search
   backed by `sqlite-vec` or `chromadb`. Keep the same API so no agent
   changes.
3. **Patch applier** — add an `applier` step that consumes a `CodeResult`,
   re-runs security on each patch, requires human approval for writes, and
   uses `write_file` under the sandbox.
4. **Parallel steps** — execute plan steps with non-overlapping `depends_on`
   concurrently (asyncio + `httpx.AsyncClient`).
5. **Model router** — choose between fast/deep models per step based on
   `step.description` length, keywords, or historical latency.
6. **Web tool** — add a `web_fetch` / `web_search` tool with an HTTP
   allowlist + per-host rate limit. Gate behind the same approval layer.
7. **Desktop / Web UI** — reuse `build_stack()` to back a FastAPI + SSE
   server; render plan/step tables live.
8. **Discord integration** — bridge to your existing bot by exposing
   `orch.run(prompt)` behind a slash command; enforce an auto-deny approval
   gate for non-owner users.
9. **Scheduler** — a cron-like loop that runs saved "recipes" (prompts) and
   writes results into memory with tags for later recall.
10. **Plugin system** — load extra tools from `nova/tools/plugins/*.py` via a
    simple `register(registry)` convention; same for extra agents.
