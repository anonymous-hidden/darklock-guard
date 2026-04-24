"""Interactive approval manager — y/N prompts with audit logging."""
from __future__ import annotations
import sys
from dataclasses import dataclass
from typing import Callable, Optional

try:
    from rich.console import Console
    from rich.panel import Panel
    _console = Console()
except Exception:
    _console = None


@dataclass
class ApprovalRequest:
    what: str
    category: str           # safe | elevated | destructive | external_write
    purpose: str = ""
    risk_note: str = ""
    dry_run_preview: str = ""


class ApprovalManager:
    def __init__(self, auto_deny: bool = False, auto_approve_categories: Optional[list[str]] = None,
                 logger=None, prompt: Callable[[str], str] | None = None):
        self.auto_deny = auto_deny
        self.auto_approve = set(auto_approve_categories or [])
        self.logger = logger
        self._prompt = prompt or input

    def confirm(self, req: ApprovalRequest) -> tuple[bool, str]:
        if req.category in self.auto_approve:
            self._audit(req, True, "auto-approved by policy")
            return True, "auto-approved"
        if self.auto_deny or not sys.stdin.isatty():
            self._audit(req, False, "auto-denied (non-interactive or --deny-approvals)")
            return False, "auto-denied"

        self._render(req)
        try:
            ans = self._prompt("Approve? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            self._audit(req, False, "interrupted")
            return False, "interrupted"
        ok = ans in ("y", "yes")
        self._audit(req, ok, ans or "n")
        return ok, ans or "n"

    def _render(self, req: ApprovalRequest) -> None:
        text = (f"[bold]Action:[/] {req.what}\n"
                f"[bold]Category:[/] {req.category}\n"
                f"[bold]Purpose:[/] {req.purpose or '-'}\n"
                f"[bold]Risk:[/] {req.risk_note or '-'}")
        if req.dry_run_preview:
            text += f"\n[bold]Dry-run preview:[/]\n{req.dry_run_preview[:1500]}"
        if _console:
            style = {"destructive": "red", "elevated": "yellow",
                     "external_write": "magenta"}.get(req.category, "cyan")
            _console.print(Panel(text, title="Approval required", border_style=style))
        else:
            print(text)

    def _audit(self, req: ApprovalRequest, granted: bool, reason: str) -> None:
        if self.logger:
            self.logger.info("approval.decision",
                             what=req.what, category=req.category,
                             granted=granted, reason=reason)
