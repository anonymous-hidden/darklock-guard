"""Specialist agent classes. Each binds a pydantic output schema."""
from __future__ import annotations

from ..schemas.models import (
    CodeResult,
    FinalAnswer,
    MemoryOp,
    Plan,
    ResearchResult,
    SecurityReview,
)
from .base import Agent


class SupervisorAgent(Agent):
    """Plans/decides. Uses the Plan schema."""
    output_schema = Plan


class PlannerAgent(Agent):
    output_schema = Plan


class ResearcherAgent(Agent):
    output_schema = ResearchResult


class CoderAgent(Agent):
    output_schema = CodeResult


class SecurityAgent(Agent):
    output_schema = SecurityReview


class MemoryAgent(Agent):
    output_schema = MemoryOp


class SummarizerAgent(Agent):
    output_schema = FinalAnswer
