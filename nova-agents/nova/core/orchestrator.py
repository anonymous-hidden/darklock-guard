"""Supervisor loop: plan -> delegate -> validate -> finalize."""
from __future__ import annotations

import json
import time
from typing import Any

from ..agents.base import Agent
from ..schemas.models import (
    FinalAnswer,
    Plan,
    PlanStep,
    Task,
    TaskStatus,
)
from .router import Router


class Orchestrator:
    def __init__(
        self,
        agents: dict[str, Agent],
        logger,
        max_iterations: int = 6,
        max_validation_retries: int = 2,
        allow_direct_answer: bool = True,
    ) -> None:
        self.agents = agents
        self.router = Router(agents)
        self.logger = logger
        self.max_iterations = max_iterations
        self.max_validation_retries = max_validation_retries
        self.allow_direct_answer = allow_direct_answer

    # ---------- public entrypoint ----------
    def run(self, user_input: str) -> Task:
        task = Task(user_input=user_input)
        self.logger.info("task.start", task_id=task.id, input=user_input)

        try:
            # 1) Supervisor plans.
            task.status = TaskStatus.PLANNING
            plan = self._plan(user_input)
            task.plan = plan
            self.logger.info(
                "task.plan",
                task_id=task.id,
                direct=bool(plan.direct_answer),
                steps=len(plan.steps),
                reasoning=plan.reasoning,
            )

            # 2) Direct answer short-circuit.
            if self.allow_direct_answer and plan.direct_answer and not plan.steps:
                task.final = FinalAnswer(answer=plan.direct_answer, highlights=[])
                task.status = TaskStatus.DONE
                self.logger.info("task.done", task_id=task.id, mode="direct")
                return task

            # 3) Execute steps.
            task.status = TaskStatus.RUNNING
            step_outputs: dict[int, Any] = {}
            for step in plan.steps:
                task.iterations += 1
                if task.iterations > self.max_iterations:
                    raise RuntimeError(f"max_iterations ({self.max_iterations}) exceeded")
                self._execute_step(task, step, step_outputs)

            # 4) Ensure there is a FinalAnswer.
            if task.final is None:
                # If no summarizer step produced one, synthesize via summarizer.
                task.final = self._force_summarize(user_input, step_outputs)
            task.status = TaskStatus.DONE
            self.logger.info("task.done", task_id=task.id, mode="delegated")
            return task

        except Exception as exc:
            task.status = TaskStatus.FAILED
            task.error = f"{type(exc).__name__}: {exc}"
            self.logger.error("task.failed", task_id=task.id, error=task.error)
            return task

    # ---------- internals ----------
    def _plan(self, user_input: str) -> Plan:
        supervisor = self.agents["supervisor"]
        obj = supervisor.invoke_structured(
            user_message=f"User request:\n{user_input}",
            schema=Plan,
            max_retries=self.max_validation_retries,
        )
        assert isinstance(obj, Plan)
        return obj

    def _execute_step(self, task: Task, step: PlanStep, outputs: dict[int, Any]) -> None:
        rec = task.record_step(step.id, step.agent)
        rec.status = "running"
        rec.started_at = time.time()
        agent = self.router.resolve(step)

        # Build the step prompt with dependency context.
        context_blocks: list[str] = []
        for dep in step.depends_on:
            if dep in outputs:
                context_blocks.append(
                    f"[step {dep} output]\n{_safe_json(outputs[dep])}"
                )
        context = "\n\n".join(context_blocks) if context_blocks else "(no prior step context)"
        message = (
            f"Task: {step.description}\n"
            f"Inputs: {_safe_json(step.inputs)}\n\n"
            f"Prior context:\n{context}\n\n"
            f"Respond with the JSON structure required by your role."
        )

        schema = type(agent).output_schema
        try:
            if schema is None:
                # Fallback: plain text.
                raw = agent.invoke_text(message)
                output: Any = {"text": raw}
            else:
                rec.attempts += 1
                output = agent.invoke_structured(
                    message,
                    schema=schema,
                    max_retries=self.max_validation_retries,
                )
                # Convert pydantic to dict for downstream steps.
                output = output.model_dump() if hasattr(output, "model_dump") else output
        except Exception as exc:
            rec.status = "failed"
            rec.error = f"{type(exc).__name__}: {exc}"
            rec.finished_at = time.time()
            self.logger.error(
                "step.failed",
                task_id=task.id,
                step=step.id,
                agent=step.agent,
                error=rec.error,
            )
            raise

        rec.status = "ok"
        rec.output = output
        rec.finished_at = time.time()
        outputs[step.id] = output
        self.logger.info(
            "step.done",
            task_id=task.id,
            step=step.id,
            agent=step.agent,
            ms=int((rec.finished_at - (rec.started_at or rec.finished_at)) * 1000),
        )

        # If summarizer produced a FinalAnswer, capture it on the task.
        if step.agent == "summarizer" and isinstance(output, dict) and "answer" in output:
            task.final = FinalAnswer(**output)

    def _force_summarize(self, user_input: str, outputs: dict[int, Any]) -> FinalAnswer:
        summarizer = self.agents["summarizer"]
        msg = (
            f"User request:\n{user_input}\n\n"
            f"Collected step outputs:\n{_safe_json(outputs)}\n\n"
            "Produce the final answer JSON."
        )
        obj = summarizer.invoke_structured(msg, schema=FinalAnswer, max_retries=self.max_validation_retries)
        assert isinstance(obj, FinalAnswer)
        return obj


def _safe_json(obj: Any, limit: int = 4000) -> str:
    try:
        s = json.dumps(obj, default=str, ensure_ascii=False, indent=2)
    except Exception:
        s = str(obj)
    return s if len(s) <= limit else s[:limit] + "\n...[truncated]"
