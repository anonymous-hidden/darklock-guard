"""Pydantic schemas for structured agent outputs + task/plan state."""
from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field
import time
import uuid


class PlanStep(BaseModel):
    id: str
    agent: str
    task: str
    depends_on: list[str] = Field(default_factory=list)


class Plan(BaseModel):
    steps: list[PlanStep]


class SupervisorDecision(BaseModel):
    strategy: Literal["direct", "delegate"]
    direct_answer: str = ""
    preset: str = ""
    reason: str = ""


class ResearchFinding(BaseModel):
    source: str
    ref: str = ""
    summary: str


class ResearchResult(BaseModel):
    findings: list[ResearchFinding] = Field(default_factory=list)
    confidence: str = "low"
    notes: str = ""


class CodePatch(BaseModel):
    path: str
    description: str = ""
    diff: str = ""


class CodeResult(BaseModel):
    summary: str = ""
    patches: list[CodePatch] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SecurityFinding(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    title: str
    evidence: str = ""
    recommendation: str = ""


class SecurityReport(BaseModel):
    findings: list[SecurityFinding] = Field(default_factory=list)
    overall_risk: str = "low"


class MemoryNote(BaseModel):
    key: str
    value: str
    tags: list[str] = Field(default_factory=list)


class MemoryOp(BaseModel):
    operation: Literal["append", "retrieve", "merge", "none"] = "none"
    notes: list[MemoryNote] = Field(default_factory=list)
    query: str = ""


class FinalAnswer(BaseModel):
    answer: str
    bullets: list[str] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)


class ConnectorCall(BaseModel):
    connector: str
    action: str
    params: dict[str, Any] = Field(default_factory=dict)


class ConnectorRouterResult(BaseModel):
    calls: list[ConnectorCall] = Field(default_factory=list)
    reason: str = ""


class ExecutionCommand(BaseModel):
    cmd: str
    purpose: str = ""
    expected_risk: Literal["safe", "elevated", "destructive"] = "safe"


class ExecutionPlan(BaseModel):
    commands: list[ExecutionCommand] = Field(default_factory=list)
    dry_run_recommended: bool = True


class StepRecord(BaseModel):
    id: str
    agent: str
    task: str
    status: Literal["pending", "running", "done", "failed", "skipped"] = "pending"
    output: Optional[dict[str, Any]] = None
    error: str = ""
    retries: int = 0


class ApprovalRecord(BaseModel):
    what: str
    category: Literal["safe", "elevated", "destructive", "external_write"]
    granted: Optional[bool] = None
    reason: str = ""


class Task(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: float = Field(default_factory=time.time)
    user_input: str
    mode: Literal["normal", "agent"]
    preset: str = ""
    plan: Optional[Plan] = None
    steps: list[StepRecord] = Field(default_factory=list)
    approvals: list[ApprovalRecord] = Field(default_factory=list)
    final: Optional[FinalAnswer] = None
    status: Literal["running", "done", "failed"] = "running"
