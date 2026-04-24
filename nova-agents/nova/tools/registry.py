"""Tool registry + base classes. Tools are the ONLY way agents touch the world."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal


PermissionLevel = Literal["read", "write", "exec"]


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    permission: PermissionLevel
    func: Callable[..., Any]

    def invoke(self, **kwargs: Any) -> Any:
        return self.func(**kwargs)


@dataclass
class ToolRegistry:
    tools: dict[str, Tool] = field(default_factory=dict)

    def register(self, tool: Tool) -> None:
        if tool.name in self.tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        self.tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        if name not in self.tools:
            raise KeyError(f"Unknown tool: {name}")
        return self.tools[name]

    def allowed(self, names: list[str]) -> list[Tool]:
        return [self.tools[n] for n in names if n in self.tools]

    def describe(self, names: list[str]) -> str:
        lines: list[str] = []
        for n in names:
            t = self.tools.get(n)
            if not t:
                continue
            lines.append(
                f"- {t.name} ({t.permission}): {t.description}\n"
                f"  input: {t.input_schema}"
            )
        return "\n".join(lines) if lines else "(no tools available)"
