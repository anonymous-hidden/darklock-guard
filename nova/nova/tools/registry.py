"""Tool registry — tools are local, synchronous functions."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Tool:
    name: str
    description: str
    permission: str           # read | write | exec
    handler: Callable[..., Any]
    modes: list[str] = field(default_factory=lambda: ["normal", "agent"])


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def describe(self) -> list[dict]:
        return [{"name": t.name, "description": t.description,
                 "permission": t.permission, "modes": t.modes}
                for t in self._tools.values()]

    def call(self, name: str, /, **kwargs) -> Any:
        tool = self.get(name)
        if not tool:
            raise KeyError(f"Unknown tool: {name}")
        return tool.handler(**kwargs)
