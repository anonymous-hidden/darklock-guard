"""Command classifier — categorizes shell commands by risk."""
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Literal

Category = Literal["safe", "elevated", "destructive", "denied"]


@dataclass
class Classification:
    category: Category
    reason: str
    matched: str = ""


class CommandClassifier:
    def __init__(self, policy):
        self.safe = policy.shell_safe_allowlist()
        self.elevated = [re.compile(p) for p in policy.shell_elevated()]
        self.destructive = [re.compile(p) for p in policy.shell_destructive()]
        self.hard_deny = [re.compile(p) for p in policy.shell_hard_deny()]

    def classify(self, cmd: str) -> Classification:
        c = cmd.strip()
        for pat in self.hard_deny:
            if pat.search(c):
                return Classification("denied", "hard-deny pattern", pat.pattern)
        for pat in self.destructive:
            if pat.search(c):
                return Classification("destructive", "destructive pattern", pat.pattern)
        for pat in self.elevated:
            if pat.search(c):
                return Classification("elevated", "elevated pattern", pat.pattern)
        for entry in self.safe:
            if c == entry or c.startswith(entry + " ") or c.startswith(entry):
                return Classification("safe", f"matches allowlist '{entry}'", entry)
        return Classification("elevated", "unknown command — default elevated")
