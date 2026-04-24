"""Pydantic schemas for structured agent outputs and task state."""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------- Agent structured outputs ----------

class PlanStep(BaseModel):
    id: int
    description: str
    agent: Literal["researcher", "coder", "security", "memory", "summarizer"]
    inputs: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[int] = Field(default_factory=list)


class Plan(BaseModel):
    direct_answer: str | None = None
    reasoning: str = ""
    steps: list[PlanStep] = Field(default_factory=list)


class ResearchFinding(BaseModel):
    source: str
    summary: str
    confidence: float = 0.5


class ResearchResult(BaseModel):
    question: str
    findings: list[ResearchFinding]
    notes: str = ""


class CodePatch(BaseModel):
    path: str
    action: Literal["create", "modify", "delete"]
    # For create/modify, the full replacement content.
    content: str | None = None
    rationale: str = ""


class CodeResult(BaseModel):
    patches: list[CodePatch]
    explanation: str


class SecurityFinding(BaseModel):
    severity: Literal["info", "low", "medium", "high", "critical"]
    category: str
    message: str
    location: str | None = None


class SecurityReview(BaseModel):
    findings: list[SecurityFinding]
    approved: bool
    summary: str


class MemoryOp(BaseModel):
    action: Literal["store", "recall", "none"]
    key: str | None = None
    value: str | None = None
    query: str | None = None
    tags: list[str] = Field(default_factory=list)


class FinalAnswer(BaseModel):
    answer: str
    highlights: list[str] = Field(default_factory=list)


# ---------- Task state ----------

class TaskStatus(str, Enum):
    PENDING = "pending"
    PLANNING = "planning"
    RUNNING = "running"
    VALIDATING = "validating"
    RETRYING = "retrying"
    DONE = "done"
    FAILED = "failed"


class StepRecord(BaseModel):
    step_id: int
    agent: str
    status: Literal["pending", "running", "ok", "failed"] = "pending"
    output: Any = None
    error: str | None = None
    attempts: int = 0
    started_at: float | None = None
    finished_at: float | None = None


class Task(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: float = Field(default_factory=time.time)
    user_input: str
    plan: Plan | None = None
    steps: list[StepRecord] = Field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    iterations: int = 0
    final: FinalAnswer | None = None
    error: str | None = None

    def record_step(self, step_id: int, agent: str) -> StepRecord:
        rec = StepRecord(step_id=step_id, agent=agent)
        self.steps.append(rec)
        return rec
