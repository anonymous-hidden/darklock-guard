"""Specialist agents — each binds a pydantic output schema."""
from __future__ import annotations
from .base import Agent
from ..schemas.models import (Plan, SupervisorDecision, ResearchResult, CodeResult,
                              SecurityReport, MemoryOp, FinalAnswer,
                              ConnectorRouterResult, ExecutionPlan)


class SupervisorAgent(Agent):
    output_schema = SupervisorDecision


class PlannerAgent(Agent):
    output_schema = Plan


class ResearcherAgent(Agent):
    output_schema = ResearchResult


class CoderAgent(Agent):
    output_schema = CodeResult


class SecurityAgent(Agent):
    output_schema = SecurityReport


class MemoryAgent(Agent):
    output_schema = MemoryOp


class SummarizerAgent(Agent):
    output_schema = FinalAnswer


class ConnectorRouterAgent(Agent):
    output_schema = ConnectorRouterResult


class ExecutionAgent(Agent):
    output_schema = ExecutionPlan
