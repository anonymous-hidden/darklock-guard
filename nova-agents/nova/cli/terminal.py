"""Terminal UI for NOVA. Run: python -m nova.cli.terminal  (or use main.py)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..agents import build_agents
from ..core.ollama_client import OllamaClient
from ..core.orchestrator import Orchestrator
from ..memory.store import MemoryStore
from ..schemas.models import Task
from ..tools import build_registry
from ..utils.approval import ApprovalGate
from ..utils.config import load_config
from ..utils.logging import JsonlLogger


console = Console()


def _banner() -> None:
    console.print(Panel.fit(
        "[bold cyan]NOVA[/bold cyan]  local multi-agent orchestrator\n"
        "[dim]supervisor ▸ planner ▸ researcher ▸ coder ▸ security ▸ memory ▸ summarizer[/dim]",
        border_style="cyan",
    ))


def _render_plan(task: Task) -> None:
    if not task.plan:
        return
    if task.plan.direct_answer and not task.plan.steps:
        console.print("[dim]plan: direct answer (no specialists)[/dim]")
        return
    t = Table(title="plan", header_style="bold")
    t.add_column("#", justify="right")
    t.add_column("agent", style="magenta")
    t.add_column("description")
    t.add_column("deps", justify="right")
    for s in task.plan.steps:
        t.add_row(str(s.id), s.agent, s.description, ",".join(map(str, s.depends_on)) or "-")
    console.print(t)


def _render_steps(task: Task, verbose: bool) -> None:
    if not task.steps:
        return
    t = Table(title="execution", header_style="bold")
    t.add_column("#", justify="right")
    t.add_column("agent", style="magenta")
    t.add_column("status")
    t.add_column("ms", justify="right")
    for s in task.steps:
        ms = ""
        if s.started_at and s.finished_at:
            ms = str(int((s.finished_at - s.started_at) * 1000))
        color = {"ok": "green", "failed": "red", "running": "yellow"}.get(s.status, "white")
        t.add_row(str(s.step_id), s.agent, f"[{color}]{s.status}[/{color}]", ms)
    console.print(t)
    if verbose:
        for s in task.steps:
            console.print(Panel(str(s.output)[:2000], title=f"step {s.step_id} / {s.agent}", border_style="dim"))


def _render_final(task: Task) -> None:
    if task.error:
        console.print(Panel(f"[red]{task.error}[/red]", title="error", border_style="red"))
        return
    if task.final:
        body = task.final.answer
        if task.final.highlights:
            body += "\n\n[bold]highlights[/bold]\n- " + "\n- ".join(task.final.highlights)
        console.print(Panel(body, title="nova", border_style="cyan"))


def interactive_loop(orch: Orchestrator, verbose: bool, show_plan: bool) -> None:
    _banner()
    console.print("[dim]type /help for commands, /exit to quit[/dim]\n")
    while True:
        try:
            line = console.input("[bold green]you ›[/bold green] ").strip()
        except (EOFError, KeyboardInterrupt):
            console.print()
            return
        if not line:
            continue
        if line in ("/exit", "/quit"):
            return
        if line == "/help":
            console.print(
                "[bold]commands[/bold]\n"
                "  /exit, /quit       leave\n"
                "  /verbose           toggle step output dump\n"
                "  /plan              toggle plan table\n"
                "  anything else      submit as a request to NOVA\n"
            )
            continue
        if line == "/verbose":
            verbose = not verbose
            console.print(f"verbose = {verbose}")
            continue
        if line == "/plan":
            show_plan = not show_plan
            console.print(f"show_plan = {show_plan}")
            continue

        task = orch.run(line)
        if show_plan:
            _render_plan(task)
        _render_steps(task, verbose)
        _render_final(task)


def build_stack(config_dir: Path | None = None, auto_deny_approvals: bool = False):
    cfg, agents_cfg, _tools_cfg = load_config(config_dir)
    project_root = cfg.root

    log_path = cfg.resolve_path(cfg.get("logging.path", "./logs/nova.jsonl"))
    logger = JsonlLogger(
        path=log_path,
        level=cfg.get("logging.level", "INFO"),
        console=bool(cfg.get("logging.console", True)),
    )

    memory = MemoryStore(cfg.resolve_path(cfg.get("memory.path", "./data/memory.sqlite")))

    approval = ApprovalGate(auto_deny=auto_deny_approvals)
    registry = build_registry(cfg, memory, logger, approval, project_root)

    client = OllamaClient(
        host=cfg.get("ollama.host", "http://localhost:11434"),
        timeout=float(cfg.get("ollama.timeout_seconds", 180)),
    )

    prompts_dir = project_root / "nova" / "prompts"
    agents = build_agents(cfg, agents_cfg, client, registry, logger, prompts_dir)

    orch = Orchestrator(
        agents=agents,
        logger=logger,
        max_iterations=int(cfg.get("orchestrator.max_iterations", 6)),
        max_validation_retries=int(cfg.get("orchestrator.max_validation_retries", 2)),
        allow_direct_answer=bool(cfg.get("orchestrator.allow_direct_answer", True)),
    )

    return cfg, orch, client


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nova", description="NOVA local multi-agent CLI")
    parser.add_argument("prompt", nargs="*", help="one-shot request; omit for interactive mode")
    parser.add_argument("--verbose", action="store_true", help="dump every step's output")
    parser.add_argument("--no-plan", action="store_true", help="hide plan table")
    parser.add_argument("--deny-approvals", action="store_true", help="auto-deny every approval prompt")
    parser.add_argument("--config-dir", type=Path, default=None)
    args = parser.parse_args(argv)

    cfg, orch, client = build_stack(args.config_dir, auto_deny_approvals=args.deny_approvals)

    if not client.health():
        console.print("[yellow]warning:[/yellow] Ollama does not appear reachable at "
                      f"{cfg.get('ollama.host')} — start it with `ollama serve`.")

    verbose = args.verbose or bool(cfg.get("terminal.verbose", False))
    show_plan = (not args.no_plan) and bool(cfg.get("terminal.show_plan", True))

    if args.prompt:
        task = orch.run(" ".join(args.prompt))
        if show_plan:
            _render_plan(task)
        _render_steps(task, verbose)
        _render_final(task)
        return 0 if task.error is None else 1

    interactive_loop(orch, verbose=verbose, show_plan=show_plan)
    return 0


if __name__ == "__main__":
    sys.exit(main())
