"""Secret resolution — thin wrapper over env vars with reporting."""
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass
class SecretStatus:
    name: str
    present: bool
    preview: str


def require_env(name: str) -> str:
    v = os.environ.get(name, "")
    return v


def status(names: list[str]) -> list[SecretStatus]:
    out: list[SecretStatus] = []
    for n in names:
        v = os.environ.get(n, "")
        out.append(SecretStatus(n, bool(v), (v[:4] + "…") if v else ""))
    return out
