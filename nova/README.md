# NOVA v2 — Local Multi-Mode AI Platform

A local-first, Ollama-powered assistant with two real operating modes, a
supervisor-driven multi-agent orchestrator, a tool + connector system, a
policy-gated command executor with y/N approvals, SQLite memory, and
structured JSONL logs.

## Modes

| | Normal Mode | Agent Mode |
|---|---|---|
| Purpose | daily Q&A, quick lookups, safe utilities | multi-step workflows, automations, integrations |
| Tools | read-only local tools | all tools, including `write_file`, `run_shell_command` |
| Connectors | `local_files` (read), `web_search` | all enabled connectors |
| Shell | disabled | `safe` runs auto, `elevated`/`destructive` need y/N |
| Presets | low-risk presets only | all presets |
| Autonomy | one-shot answers + short chains | supervisor + full plan-execute-summarize loop |

Switch at runtime with `/mode agent` or start with `--mode agent`.

## Architecture

```
nova/
  main.py                     # entrypoint
  requirements.txt
  .env.example
  config/
    config.yaml               # ollama, orchestrator, safety, memory, logging
    agents.yaml               # per-agent model + prompt file + tool allowlist
    policy.yaml               # fs sandbox, shell allow/elevate/destruct/deny, mode matrix
    connectors.yaml           # enabled flags + env var references
    presets/                  # 20 YAML preset action packs
  prompts/                    # 9 system prompts (one per agent role)
  nova/
    __init__.py
    core/
      mode.py                 # ModeManager (normal ⇄ agent)
      policy.py               # AccessPolicy — per-mode matrix, fs/shell lists
      classifier.py           # CommandClassifier — safe/elevated/destructive/denied
      approval.py             # ApprovalManager — y/N with rich panel + audit log
      executor.py             # CommandExecutor — policy + approval + subprocess
      validator.py            # JSON extractor + pydantic validator
      presets.py              # PresetLoader — reads config/presets/*.yaml
      orchestrator.py         # supervisor → preset|ad-hoc plan → execute → summarize
      ollama_client.py        # httpx client with JSON mode + keep-alive
    agents/
      base.py                 # Agent.invoke_text / invoke_structured w/ retries
      specialists.py          # 9 specialist classes bound to pydantic schemas
      factory.py              # build_agents() from agents.yaml
    tools/
      registry.py             # ToolRegistry with permissions + modes
      fs_tools.py             # FsPolicy + read/write/list/search/inspect
      shell_tool.py           # wraps CommandExecutor
      memory_tools.py         # append/retrieve/log
      util_tools.py           # parse_json, validate_output, run_local_analysis
      __init__.py             # build_registry() wires everything
    connectors/
      base.py                 # BaseConnector + ConnectorAction + ConnectorResult
      registry.py             # ConnectorRegistry + build_connectors()
      local_files.py
      shell.py
      web_search.py           # DuckDuckGo HTML or SearxNG JSON + fetch
      github.py               # REST v3 issues/PRs/repo/user
      email.py                # SMTP send + local draft
      calendar.py             # ICS parser + briefing
      notes.py                # markdown folder notes
      weather.py              # OpenWeather current + forecast
      discord.py              # webhook + bot channel post
      generic_rest_api.py     # GET/POST/PUT/DELETE
      contacts.py             # JSON address book
      task_manager.py         # REST tasks CRUD
      cloud_storage.py        # mount-folder pluggable
      server_monitor.py       # endpoint ping + latency
    memory/
      store.py                # SQLite notes + task_summaries
    schemas/
      models.py               # Plan, Task, StepRecord, FinalAnswer, …
    utils/
      config.py               # YAML + env-var interpolation
      logging.py               # JSONL + rich pretty-console
      secrets.py              # env status reporter
    cli/
      terminal.py             # build_stack, main, interactive_loop
  logs/                       # nova.jsonl
  data/                       # memory.sqlite
```

### Request lifecycle

1. CLI loads configs, wires logger, memory, policy, approval, classifier,
   executor, connectors, tools, and 9 agents.
2. `ModeManager` selects `normal` (default) or `agent`.
3. `Orchestrator.run(user_input)` asks the **supervisor** to decide
   `direct` vs `delegate`. If `delegate`, it picks a preset (mode-filtered)
   or falls back to the planner for an ad-hoc plan.
4. Each plan step is dispatched to the specialist agent with pydantic-backed
   structured output and automatic retries on schema failure.
5. Shell/connector writes run through `CommandExecutor` / connector
   approval flags → `elevated` / `destructive` / `external_write` prompt y/N.
6. The summarizer produces a `FinalAnswer`; the task summary is stored in
   `memory.sqlite`, and every event is appended to `logs/nova.jsonl`.

## Setup

```bash
cd nova
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill only connectors you use

# Ollama (one-time)
ollama serve &
ollama pull llama3.1:8b
```

## Example usage

```bash
# Normal mode, one-shot
python main.py "summarize my notes on project x"

# Explicit mode
python main.py --mode normal "search this folder for .env files"

# Agent mode, multi-step
python main.py --mode agent "review this repo and propose safe improvements"

# Interactive
python main.py --mode agent --interactive

# Dry-run preview for a bigger task
python main.py --mode agent --dry-run "check system status and propose actions"

# Non-interactive (auto-deny approvals) for CI
python main.py --mode agent --deny-approvals "project_context_scan"
```

### Interactive commands

```
/mode normal|agent   switch mode
/presets             list presets available in current mode
/connectors          show capabilities + configured/unconfigured
/health              run all connector health checks
/secrets             show which env vars are set
/memory [q]          recent or matching memory notes
/deny on|off         toggle auto-deny of approvals
/help                show all commands
/exit
```

## Presets (20)

`research_and_summarize`, `code_review`, `secure_refactor`, `local_file_audit`,
`project_context_scan`, `github_issue_helper`, `email_draft_assistant`,
`calendar_briefing`, `system_status_check`, `memory_refresh`,
`task_breakdown`, `connector_health_check`, `repo_overview`,
`shell_diagnostics`, `multi_source_summary`, `notes_sync_assistant`,
`weather_plus_schedule_brief`, `discord_support_assistant`,
`server_status_overview`, `api_capability_scan`.

Each preset declares: `modes`, `risk`, `approval_required`, `tools`,
`connectors`, `steps[]`, `validation`, `retries`. Add a YAML to
`config/presets/` and it is picked up automatically.

## Safety rails

- **Filesystem** — `FsPolicy` resolves every path against `policy.yaml:fs.allowed_roots`
  and rejects matches of `fs.denied_patterns` (env files, ssh keys, …).
- **Shell** — every command classified as `safe | elevated | destructive | denied`.
  `safe` runs automatically only in Agent Mode. `elevated`/`destructive`
  require y/N. `denied` never runs.
- **Mode** — `policy.yaml:modes.{normal|agent}` is the single source of
  truth for tool/connector/preset access, enforced in code in
  `AccessPolicy` + `Orchestrator`, not merely in prompts.
- **Approvals** — `ApprovalManager` logs every decision to JSONL; runs with
  `--deny-approvals` auto-deny in non-interactive sessions.
- **Secrets** — only `.env` + env vars; nothing committed.

## Example flows

1. **Normal direct answer** — `python main.py "explain pydantic v2 validators"`
   → supervisor returns `strategy=direct`.
2. **Normal file lookup** — `python main.py "find TODOs in src/"` →
   supervisor picks `local_file_audit`, researcher uses `search_files`.
3. **Agent repo review** — `python main.py --mode agent "review this repo"`
   → `code_review` preset: researcher → coder → security → summarizer.
4. **Secure refactor** — `secure_refactor` preset; coder produces patches,
   security validates, write_file is gated by approval.
5. **GitHub issue helper** — `github_issue_helper` preset uses `github`
   connector `list_issues` + summarizer → optional `create_issue` (approval).
6. **Email draft** — `email_draft_assistant`; `email.draft` (no send) by
   default, `email.send` requires y/N.
7. **Calendar briefing** — `calendar_briefing` → ICS parse → summarizer.
8. **System diagnostics** — `shell_diagnostics` runs allowlisted read-only
   commands (`uptime`, `df -h`, `free -m`, `ps aux | head`) automatically;
   anything else asks for approval.
9. **Command with approval** — `python main.py --mode agent "install ripgrep"`
   → classifier flags `apt install ...` as destructive → y/N prompt.
10. **Dry-run preview** — add `--dry-run` to see the command that would run.
11. **Connector health** — `/health` or `connector_health_check` preset.
12. **Memory refresh** — `memory_refresh` preset consolidates recent notes.

## Recommended next upgrades

1. **Vector memory** — swap `MemoryStore.search` LIKE queries for FAISS or
   sqlite-vss embeddings; keep the public API.
2. **Streaming + partial UI** — stream Ollama tokens and render incrementally.
3. **Parallel step execution** — topo-sort `plan.steps` by `depends_on`
   and execute independent branches concurrently.
4. **Per-connector rate limiting** — add a token bucket in `BaseConnector`.
5. **Tool-calling protocol** — let agents emit `{"tool":..,"args":..}` and
   loop the registry inside a single agent turn (smarter than preset-only).
6. **Bridge to `ai-terminal.py`** — register an `ai_terminal_memory` tool
   that queries `~/.ai-terminal/memory.db` read-only (same pattern as the
   existing workspace bridge).
7. **GUI front-end** — reuse `darklock-app` Electron shell, point at
   `nova.cli.terminal.build_stack()`.
8. **Secret vault** — replace plain env with `keyring` / `sops` for shared
   machines.
9. **Test harness** — snapshot each agent’s JSON output against fixtures.
10. **Plugin auto-discovery** — scan `connectors/` + `presets/` at startup
    and surface unconfigured connectors as hints.
