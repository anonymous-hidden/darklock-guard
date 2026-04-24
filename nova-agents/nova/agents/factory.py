"""Agent factory: materializes agents from config files."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..core.ollama_client import OllamaClient
from ..tools.registry import ToolRegistry
from .base import Agent, AgentConfig, load_prompt
from .specialists import (
    CoderAgent,
    MemoryAgent,
    PlannerAgent,
    ResearcherAgent,
    SecurityAgent,
    SummarizerAgent,
    SupervisorAgent,
)


_AGENT_CLASSES: dict[str, type[Agent]] = {
    "supervisor": SupervisorAgent,
    "planner": PlannerAgent,
    "researcher": ResearcherAgent,
    "coder": CoderAgent,
    "security": SecurityAgent,
    "memory": MemoryAgent,
    "summarizer": SummarizerAgent,
}


def build_agents(
    cfg,
    agents_cfg,
    client: OllamaClient,
    registry: ToolRegistry,
    logger,
    prompts_dir: Path,
) -> dict[str, Agent]:
    default_model = cfg.get("ollama.default_model", "llama3.1:8b")
    base_options: dict[str, Any] = dict(cfg.get("ollama.options", {}) or {})

    agents: dict[str, Agent] = {}
    for name, cls in _AGENT_CLASSES.items():
        spec = agents_cfg.get(name, {}) or {}
        model = spec.get("model") or default_model
        temp = float(spec.get("temperature", base_options.get("temperature", 0.2)))
        prompt_file = spec.get("prompt_file", f"{name}.txt")
        tools = list(spec.get("tools") or [])
        prompt_text = load_prompt(prompts_dir, prompt_file)

        agent_cfg = AgentConfig(
            name=name,
            model=model,
            temperature=temp,
            system_prompt=prompt_text,
            tools=tools,
            options={k: v for k, v in base_options.items() if k != "temperature"},
        )
        agents[name] = cls(agent_cfg, client, registry, logger)
    return agents
