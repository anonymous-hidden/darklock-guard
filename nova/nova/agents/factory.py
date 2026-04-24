"""Factory — instantiate all specialist agents from agents.yaml."""
from __future__ import annotations
from pathlib import Path

from .base import AgentConfig
from .specialists import (SupervisorAgent, PlannerAgent, ResearcherAgent,
                          CoderAgent, SecurityAgent, MemoryAgent,
                          SummarizerAgent, ConnectorRouterAgent, ExecutionAgent)

_CLASSES = {
    "supervisor": SupervisorAgent,
    "planner": PlannerAgent,
    "researcher": ResearcherAgent,
    "coder": CoderAgent,
    "security": SecurityAgent,
    "memory": MemoryAgent,
    "summarizer": SummarizerAgent,
    "connector_router": ConnectorRouterAgent,
    "execution": ExecutionAgent,
}


def build_agents(agents_cfg, main_cfg, client, project_root: Path, logger=None) -> dict:
    default_model = main_cfg.get("ollama.default_model", "llama3.1:8b")
    out: dict = {}
    specs = agents_cfg.get("agents", {}) or {}
    for name, klass in _CLASSES.items():
        s = specs.get(name, {}) or {}
        cfg = AgentConfig(
            name=name,
            model=s.get("model") or default_model,
            temperature=float(s.get("temperature", 0.2)),
            prompt_file=s.get("prompt_file", f"prompts/{name}.txt"),
            tools=s.get("tools") or [],
        )
        out[name] = klass(cfg, client, project_root, logger=logger)
    return out
