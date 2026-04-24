"""Command executor — runs shell commands through policy + approval."""
from __future__ import annotations
import shlex
import subprocess
from dataclasses import dataclass
from typing import Optional

from .classifier import CommandClassifier, Classification
from .approval import ApprovalManager, ApprovalRequest


@dataclass
class ExecutionResult:
    cmd: str
    category: str
    approved: bool
    executed: bool
    exit_code: Optional[int]
    stdout: str
    stderr: str
    dry_run: bool
    error: str = ""


class CommandExecutor:
    def __init__(self, classifier: CommandClassifier, approval: ApprovalManager,
                 auto_categories: list[str], *, mode: str, shell_allowed: bool,
                 timeout_s: int = 60, output_truncate: int = 12000, logger=None):
        self.classifier = classifier
        self.approval = approval
        self.auto_categories = set(auto_categories)
        self.mode = mode
        self.shell_allowed = shell_allowed
        self.timeout_s = timeout_s
        self.output_truncate = output_truncate
        self.logger = logger

    def run(self, cmd: str, purpose: str = "", dry_run: bool = False) -> ExecutionResult:
        cmd = cmd.strip()
        cls: Classification = self.classifier.classify(cmd)

        if self.logger:
            self.logger.info("cmd.classify", cmd=cmd, category=cls.category,
                             matched=cls.matched, reason=cls.reason, mode=self.mode)

        if not self.shell_allowed:
            return ExecutionResult(cmd, cls.category, False, False, None, "", "",
                                   dry_run, "shell disabled in current mode")

        if cls.category == "denied":
            return ExecutionResult(cmd, cls.category, False, False, None, "", "",
                                   dry_run, f"hard-deny: {cls.matched}")

        # auto-run eligibility
        needs_approval = cls.category not in self.auto_categories
        approved = not needs_approval
        if needs_approval:
            req = ApprovalRequest(
                what=cmd, category=cls.category, purpose=purpose,
                risk_note=cls.reason,
                dry_run_preview=f"(dry-run) would execute: {cmd}" if dry_run else "",
            )
            approved, _ = self.approval.confirm(req)

        if not approved:
            return ExecutionResult(cmd, cls.category, False, False, None, "", "",
                                   dry_run, "approval denied")

        if dry_run:
            return ExecutionResult(cmd, cls.category, True, False, None,
                                   f"(dry-run) {cmd}", "", True)

        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=self.timeout_s,
            )
            stdout = proc.stdout[-self.output_truncate:]
            stderr = proc.stderr[-self.output_truncate:]
            res = ExecutionResult(cmd, cls.category, True, True, proc.returncode,
                                  stdout, stderr, False)
        except subprocess.TimeoutExpired:
            res = ExecutionResult(cmd, cls.category, True, True, -1, "", "",
                                  False, "timeout")
        except Exception as e:
            res = ExecutionResult(cmd, cls.category, True, True, -1, "", "",
                                  False, f"exec error: {e}")

        if self.logger:
            self.logger.info("cmd.run", cmd=cmd, category=cls.category,
                             exit_code=res.exit_code, error=res.error)
        return res
