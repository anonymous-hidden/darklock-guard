"""Base Agent. An agent = prompt + model + allowed tools + structured output schema."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Type

from pydantic import BaseModel

from ..core.ollama_client import OllamaClient
from ..core.validator import parse_structured
from ..tools.registry import Tool, ToolRegistry


@dataclass
class AgentConfig:
    name: str
    model: str
    temperature: float
    system_prompt: str
    tools: list[str] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)


class Agent:
    """Generic agent. Subclasses set `output_schema` for structured outputs."""

    output_schema: Type[BaseModel] | None = None

    def __init__(
        self,
        cfg: AgentConfig,
        client: OllamaClient,
        registry: ToolRegistry,
        logger,
    ) -> None:
        self.cfg = cfg
        self.client = client
        self.registry = registry
        self.logger = logger

    # ---- low-level call ----
    def _call(self, user_message: str, json_mode: bool) -> str:
        options = dict(self.cfg.options)
        options["temperature"] = self.cfg.temperature
        sys_prompt = self.cfg.system_prompt
        if self.cfg.tools:
            sys_prompt += "\n\n" + "AVAILABLE TOOLS (invoke by asking the orchestrator to call them on your behalf):\n"
            sys_prompt += self.registry.describe(self.cfg.tools)
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_message},
        ]
        self.logger.debug("agent.call", agent=self.cfg.name, model=self.cfg.model, json_mode=json_mode)
        return self.client.chat(self.cfg.model, messages, options=options, json_mode=json_mode)

    # ---- structured invocation with retries ----
    def invoke_structured(self, user_message: str, schema: Type[BaseModel], max_retries: int = 2) -> BaseModel:
        last_err: str | None = None
        for attempt in range(max_retries + 1):
            try:
                raw = self._call(user_message, json_mode=True)
            except Exception as exc:
                last_err = f"ollama error: {exc}"
                self.logger.warn("agent.ollama_error", agent=self.cfg.name, attempt=attempt, error=last_err)
                continue
            obj, err = parse_structured(raw, schema)
            if obj is not None:
                return obj
            last_err = err
            self.logger.warn(
                "agent.invalid_output",
                agent=self.cfg.name,
                attempt=attempt,
                error=err,
                preview=raw[:400],
            )
            user_message = (
                f"{user_message}\n\n"
                f"Your previous response could not be parsed ({err}). "
                f"Reply with a SINGLE valid JSON object that matches the required schema. "
                f"No prose, no markdown fences."
            )
        raise ValueError(f"{self.cfg.name}: failed to produce valid output: {last_err}")

    def invoke_text(self, user_message: str) -> str:
        return self._call(user_message, json_mode=False)

    # ---- tool helpers ----
    def available_tools(self) -> list[Tool]:
        return self.registry.allowed(self.cfg.tools)


def load_prompt(prompts_dir: Path, filename: str) -> str:
    return (prompts_dir / filename).read_text(encoding="utf-8")
