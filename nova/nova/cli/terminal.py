"""NOVA terminal UX — argparse CLI + interactive mode."""
from __future__ import annotations
import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..utils.config import load_all
from ..utils.logging import JsonlLogger
from ..utils.secrets import status as secret_status
from ..memory.store import MemoryStore
from ..core.ollama_client import OllamaClient
from ..core.mode import ModeManager
from ..core.policy import AccessPolicy
from ..core.approval import ApprovalManager
from ..core.classifier import CommandClassifier
from ..core.executor import CommandExecutor
from ..core.orchestrator import Orchestrator
from ..core.presets import PresetLoader
from ..tools.fs_tools import FsPolicy
from ..tools import build_registry
from ..connectors import build_connectors
from ..agents.factory import build_agents


@dataclass
class Stack:
    config: object
    policy: AccessPolicy
    mode: ModeManager
    presets: PresetLoader
    logger: JsonlLogger
    client: OllamaClient
    memory: MemoryStore
    tools: object
    connectors: object
    executor: CommandExecutor
    orchestrator: Orchestrator
    approval: ApprovalManager
    project_root: Path


def build_stack(*, config_dir: Path | None = None, mode: str | None = None,
                auto_deny_approvals: bool = False,
                dry_run_default: bool = False) -> Stack:
    project_root = Path(__file__).resolve().parents[2]
    config_dir = Path(config_dir) if config_dir else (project_root / "config")

    cfgs = load_all(config_dir)
    main_cfg, agents_cfg = cfgs["main"], cfgs["agents"]
    policy_cfg, connectors_cfg = cfgs["policy"], cfgs["connectors"]

    logger = JsonlLogger(
        path=project_root / main_cfg.get("logging.path", "logs/nova.jsonl"),
        level=main_cfg.get("logging.level", "info"),
        pretty_console=bool(main_cfg.get("logging.pretty_console", True)),
    )
    memory = MemoryStore(project_root / main_cfg.get("memory.path", "data/memory.sqlite"))

    policy = AccessPolicy(policy_cfg)
    mm = ModeManager(
        default=mode or main_cfg.get("mode.default", "normal"),
        allow_switch=bool(main_cfg.get("mode.allow_runtime_switch", True)),
    )
    approval = ApprovalManager(auto_deny=auto_deny_approvals, logger=logger)
    classifier = CommandClassifier(policy)
    fs_policy = FsPolicy(policy.fs_allowed_roots(), policy.fs_denied())
    presets = PresetLoader(config_dir / "presets")

    client = OllamaClient(
        host=main_cfg.get("ollama.host", "http://localhost:11434"),
        timeout=float(main_cfg.get("ollama.request_timeout_s", 180)),
        keep_alive=main_cfg.get("ollama.keep_alive", "10m"),
    )

    executor = CommandExecutor(
        classifier, approval,
        auto_categories=policy.shell_auto_categories(mm.mode),
        mode=mm.mode,
        shell_allowed=policy.shell_allowed(mm.mode),
        timeout_s=int(main_cfg.get("safety.shell_timeout_s", 60)),
        output_truncate=int(main_cfg.get("safety.output_truncate_chars", 12000)),
        logger=logger,
    )

    connectors = build_connectors(connectors_cfg, fs_policy=fs_policy,
                                  executor=executor, logger=logger)
    tools = build_registry(fs_policy=fs_policy, memory_store=memory, logger=logger,
                           executor=executor, connectors=connectors)
    agents = build_agents(agents_cfg, main_cfg, client, project_root, logger=logger)

    orchestrator = Orchestrator(
        agents=agents, policy=policy, mode_manager=mm, presets=presets,
        approval=approval, logger=logger, connectors=connectors,
        memory_store=memory,
        max_iterations=int(main_cfg.get("orchestrator.max_iterations", 8)),
        max_validation_retries=int(main_cfg.get("orchestrator.max_validation_retries", 2)),
        show_plan=bool(main_cfg.get("orchestrator.show_plan", True)),
    )

    return Stack(config=main_cfg, policy=policy, mode=mm, presets=presets,
                 logger=logger, client=client, memory=memory, tools=tools,
                 connectors=connectors, executor=executor,
                 orchestrator=orchestrator, approval=approval,
                 project_root=project_root)


# ---------- rendering ----------
def _banner(console: Console, stack: Stack) -> None:
    mode = stack.mode.mode
    color = "green" if mode == "normal" else "magenta"
    console.print(Panel(
        f"[bold]NOVA v2[/] — mode=[{color}]{mode}[/{color}]  "
        f"model=[cyan]{stack.config.get('ollama.default_model')}[/]  "
        f"presets=[cyan]{len(stack.presets.names())}[/]  "
        f"connectors=[cyan]{len(stack.connectors.enabled_names())}[/]",
        border_style=color, title="NOVA"))


def _render_task(console: Console, task) -> None:
    if task.plan:
        t = Table(title="Plan", show_lines=False)
        t.add_column("#"); t.add_column("Agent"); t.add_column("Task"); t.add_column("Deps")
        for s in task.plan.steps:
            t.add_row(s.id, s.agent, (s.task[:80] + "…") if len(s.task) > 80 else s.task,
                      ", ".join(s.depends_on))
        console.print(t)
    if task.steps:
        t = Table(title="Execution")
        t.add_column("#"); t.add_column("Agent"); t.add_column("Status"); t.add_column("Error")
        for s in task.steps:
            color = {"done": "green", "failed": "red", "running": "yellow"}.get(s.status, "white")
            t.add_row(s.id, s.agent, f"[{color}]{s.status}[/]", s.error[:60])
        console.print(t)
    if task.final:
        console.print(Panel(task.final.answer, title="Final", border_style="cyan"))
        if task.final.bullets:
            console.print("[bold]Key points:[/]")
            for b in task.final.bullets:
                console.print(f"  • {b}")


def _help_text() -> str:
    return (
        "[bold]Commands[/]\n"
        "  /mode normal|agent   Switch mode\n"
        "  /presets             List presets (mode-filtered)\n"
        "  /connectors          Show connector capabilities\n"
        "  /health              Run connector health checks\n"
        "  /secrets             Show secret presence\n"
        "  /memory [query]      Recent or matching notes\n"
        "  /dryrun on|off       Toggle dry-run default\n"
        "  /deny on|off         Auto-deny approvals (non-interactive style)\n"
        "  /exit                Quit\n"
    )


# ---------- commands inside interactive loop ----------
def _handle_slash(console: Console, stack: Stack, line: str) -> bool:
    parts = line.strip().split()
    cmd = parts[0]
    args = parts[1:]
    if cmd == "/exit":
        return False
    if cmd == "/help":
        console.print(_help_text())
    elif cmd == "/mode" and args:
        try:
            stack.mode.set(args[0])
            stack.executor.mode = stack.mode.mode
            stack.executor.shell_allowed = stack.policy.shell_allowed(stack.mode.mode)
            stack.executor.auto_categories = set(stack.policy.shell_auto_categories(stack.mode.mode))
            _banner(console, stack)
        except Exception as e:
            console.print(f"[red]mode error:[/] {e}")
    elif cmd == "/presets":
        for p in stack.presets.for_mode(stack.mode.mode):
            console.print(f"  [cyan]{p.name}[/] — risk={p.risk} "
                          f"approval={p.approval_required} — {p.description}")
    elif cmd == "/connectors":
        for c in stack.connectors.capabilities():
            state = "[green]on[/]" if c["enabled"] else "[dim]off[/]"
            cfg = "[green]configured[/]" if c["configured"] else "[yellow]unconfigured[/]"
            console.print(f"  {c['name']:<18} {state}  {cfg}  risk={c['risk']}  "
                          f"actions={len(c['actions'])}")
    elif cmd == "/health":
        console.print(json.dumps(stack.connectors.health_check_all(), indent=2, default=str))
    elif cmd == "/secrets":
        names = ["GITHUB_TOKEN", "OPENWEATHER_API_KEY", "DISCORD_WEBHOOK_URL",
                 "DISCORD_BOT_TOKEN", "EMAIL_SMTP_USER", "SEARXNG_URL"]
        for s in secret_status(names):
            color = "green" if s.present else "yellow"
            console.print(f"  {s.name:<24} [{color}]{'set' if s.present else 'missing'}[/]  {s.preview}")
    elif cmd == "/memory":
        q = " ".join(args)
        notes = stack.memory.search(q) if q else stack.memory.recent(20)
        for n in notes:
            console.print(f"  [dim]{n.get('created_at'):.0f}[/] [cyan]{n['key']}[/] "
                          f"— {n['value'][:120]}")
    elif cmd == "/dryrun" and args:
        console.print(f"[yellow]note:[/] dry-run currently set per-call; toggle via --dry-run CLI flag.")
    elif cmd == "/deny" and args:
        stack.approval.auto_deny = args[0] == "on"
        console.print(f"auto-deny = {stack.approval.auto_deny}")
    else:
        console.print("[yellow]unknown command. /help[/]")
    return True


# ---------- entry points ----------
def run_one_shot(stack: Stack, prompt: str, *, dry_run: bool = False, verbose: bool = False) -> None:
    console = Console()
    _banner(console, stack)
    if dry_run:
        console.print("[yellow]dry-run mode:[/] executor will preview but not run.")
    task = stack.orchestrator.run(prompt)
    _render_task(console, task)
    if verbose:
        console.print(Panel(json.dumps(task.model_dump(), indent=2, default=str)[:8000],
                             title="task.json"))


def interactive_loop(stack: Stack) -> None:
    console = Console()
    _banner(console, stack)
    console.print("Type /help for commands. /exit to quit.\n")
    while True:
        try:
            line = input(f"nova[{stack.mode.mode}]> ").strip()
        except (EOFError, KeyboardInterrupt):
            console.print()
            break
        if not line:
            continue
        if line.startswith("/"):
            if not _handle_slash(console, stack, line):
                break
            continue
        task = stack.orchestrator.run(line)
        _render_task(console, task)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="nova", description="NOVA local multi-agent assistant")
    p.add_argument("prompt", nargs="*", help="one-shot prompt")
    p.add_argument("--mode", choices=["normal", "agent"], default=None)
    p.add_argument("--interactive", action="store_true")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--deny-approvals", action="store_true")
    p.add_argument("--config-dir", default=None)
    args = p.parse_args(argv)

    stack = build_stack(
        config_dir=Path(args.config_dir) if args.config_dir else None,
        mode=args.mode,
        auto_deny_approvals=args.deny_approvals,
        dry_run_default=args.dry_run,
    )

    # Ollama health
    if not stack.client.health():
        Console().print("[red]Ollama not reachable at "
                        f"{stack.config.get('ollama.host')}[/]. "
                        "Start it with `ollama serve`.")

    if args.interactive or not args.prompt:
        interactive_loop(stack)
        return 0
    run_one_shot(stack, " ".join(args.prompt),
                 dry_run=args.dry_run, verbose=args.verbose)
    return 0


if __name__ == "__main__":
    sys.exit(main())
