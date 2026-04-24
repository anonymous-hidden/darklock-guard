"""Base Agent — pluggable structured/text invocation with retries."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Type

from pydantic import BaseModel

from ..core.ollama_client import OllamaClient
from ..core.validator import parse_structured


@dataclass
class AgentConfig:
    name: str
    model: str
    temperature: float = 0.2
    prompt_file: str = ""
    tools: list[str] | None = None


class Agent:
    output_schema: Optional[Type[BaseModel]] = None
    default_prompt_hint: str = ""

    def __init__(self, cfg: AgentConfig, client: OllamaClient,
                 project_root: Path, logger=None):
        self.cfg = cfg
        self.client = client
        self.project_root = Path(project_root)
        self.logger = logger
        self._system = self._load_prompt()

    def _load_prompt(self) -> str:
        if not self.cfg.prompt_file:
            return self.default_prompt_hint
        p = self.project_root / self.cfg.prompt_file
        if p.exists():
            return p.read_text(encoding="utf-8")
        return self.default_prompt_hint

    def format_system(self, **ctx: Any) -> str:
        try:
            return self._system.format(**ctx)
        except Exception:
            return self._system

    def invoke_text(self, user: str, *, system_ctx: dict[str, Any] | None = None,
                    temperature: float | None = None) -> str:
        sys = self.format_system(**(system_ctx or {}))
        return self.client.chat(
            model=self.cfg.model,
            messages=[{"role": "system", "content": sys},
                      {"role": "user", "content": user}],
            temperature=temperature if temperature is not None else self.cfg.temperature,
            json_mode=False,
        )

    def invoke_structured(self, user: str, *, schema: Type[BaseModel] | None = None,
                          system_ctx: dict[str, Any] | None = None,
                          retries: int = 2, temperature: float | None = None
                          ) -> tuple[BaseModel | None, str]:
        schema = schema or self.output_schema
        if schema is None:
            raise ValueError(f"{self.cfg.name}: no output schema bound")
        sys = self.format_system(**(system_ctx or {}))
        last_err = ""
        u = user
        for attempt in range(retries + 1):
            raw = self.client.chat(
                model=self.cfg.model,
                messages=[{"role": "system", "content": sys},
                          {"role": "user", "content": u}],
                temperature=temperature if temperature is not None else self.cfg.temperature,
                json_mode=True,
            )
            obj, err = parse_structured(raw, schema)
            if obj is not None:
                return obj, ""
            last_err = err
            if self.logger:
                self.logger.warn("agent.validation_retry", agent=self.cfg.name,
                                 attempt=attempt, error=err)
            u = (f"{user}\n\nPREVIOUS_OUTPUT_INVALID: {err}\n"
                 f"Return ONLY valid JSON matching the schema.")
        return None, last_err
