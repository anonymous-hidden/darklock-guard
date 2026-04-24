"""Human-in-the-loop approval helper for risky actions."""
from __future__ import annotations

import sys
from typing import Callable


class ApprovalGate:
    """Wraps interactive y/N prompts. In non-interactive contexts, denies by default."""

    def __init__(self, prompt_fn: Callable[[str], str] | None = None, auto_deny: bool = False) -> None:
        self._prompt = prompt_fn or self._default_prompt
        self.auto_deny = auto_deny

    @staticmethod
    def _default_prompt(msg: str) -> str:
        if not sys.stdin.isatty():
            return "n"
        try:
            return input(msg)
        except EOFError:
            return "n"

    def confirm(self, description: str) -> bool:
        if self.auto_deny:
            return False
        ans = self._prompt(f"\n[APPROVAL REQUIRED] {description}\n  allow? [y/N]: ").strip().lower()
        return ans in ("y", "yes")
