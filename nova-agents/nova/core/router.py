"""Routes a plan step to the correct specialist agent."""
from __future__ import annotations

from ..agents.base import Agent
from ..schemas.models import PlanStep


class Router:
    def __init__(self, agents: dict[str, Agent]) -> None:
        self.agents = agents

    def resolve(self, step: PlanStep) -> Agent:
        if step.agent not in self.agents:
            raise KeyError(f"No agent registered for role: {step.agent}")
        return self.agents[step.agent]
