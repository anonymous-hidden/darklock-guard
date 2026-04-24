"""Orchestrator — supervisor-driven loop honouring mode + presets + approvals."""
from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Any

from ..schemas.models import (Task, StepRecord, Plan, SupervisorDecision,
                              FinalAnswer, ApprovalRecord)
from .presets import Preset, PresetLoader
from .approval import ApprovalManager, ApprovalRequest

# Agents that benefit from file-grounding before LLM inference
_FILE_GROUNDED_AGENTS = {"researcher", "coder", "security"}


class Orchestrator:
    def __init__(self, *, agents: dict, policy, mode_manager, presets: PresetLoader,
                 approval: ApprovalManager, logger, connectors, memory_store,
                 max_iterations: int = 8, max_validation_retries: int = 2,
                 show_plan: bool = True):
        self.agents = agents
        self.policy = policy
        self.mm = mode_manager
        self.presets = presets
        self.approval = approval
        self.logger = logger
        self.connectors = connectors
        self.memory = memory_store
        self.max_iter = max_iterations
        self.max_retries = max_validation_retries
        self.show_plan = show_plan

    # ---- helpers ----
    def _agent_list(self) -> list[str]:
        return list(self.agents.keys())

    def _available_presets(self, mode: str) -> list[str]:
        names = self.policy.filtered(mode, [p.name for p in self.presets.for_mode(mode)],
                                     "preset")
        return names

    def _ctx(self, mode: str) -> dict[str, Any]:
        return {
            "mode": mode,
            "agents": ", ".join(self._agent_list()),
            "presets": ", ".join(self._available_presets(mode)) or "(none)",
            "connectors": ", ".join(self.policy.filtered(
                mode, self.connectors.enabled_names(), "connector")) or "(none)",
        }

    # ---- main entry ----
    def run(self, user_input: str) -> Task:
        mode = self.mm.mode
        task = Task(user_input=user_input, mode=mode)
        self.logger.info("task.start", task_id=task.id, mode=mode, input=user_input)

        # 1) supervisor decision
        sup = self.agents["supervisor"]
        decision, err = sup.invoke_structured(
            user_input, system_ctx=self._ctx(mode), retries=self.max_retries,
        )
        if decision is None:
            self.logger.error("supervisor.failed", task_id=task.id, error=err)
            task.final = FinalAnswer(answer=f"(supervisor failed: {err})")
            task.status = "failed"
            return task

        self.logger.info("supervisor.decision", task_id=task.id,
                         strategy=decision.strategy, preset=decision.preset,
                         reason=decision.reason)

        # 2) direct short-circuit
        if decision.strategy == "direct" and decision.direct_answer:
            task.final = FinalAnswer(answer=decision.direct_answer)
            task.status = "done"
            self.logger.info("task.done", task_id=task.id, direct=True)
            return task

        # 3) preset path vs ad-hoc planner
        preset: Preset | None = None
        if decision.preset and self.policy.can_run_preset(mode, decision.preset):
            preset = self.presets.get(decision.preset)
        if preset:
            task.preset = preset.name
            self.logger.info("preset.selected", task_id=task.id, preset=preset.name)
            plan = self._plan_from_preset(preset, user_input)
            if preset.approval_required:
                ok, _ = self.approval.confirm(ApprovalRequest(
                    what=f"Run preset '{preset.name}'", category="elevated",
                    purpose=preset.description, risk_note=f"risk={preset.risk}"))
                task.approvals.append(ApprovalRecord(
                    what=f"preset:{preset.name}", category="elevated", granted=ok))
                if not ok:
                    task.final = FinalAnswer(answer="(preset approval denied)")
                    task.status = "failed"
                    return task
        else:
            plan = self._plan_adhoc(user_input, mode)

        if plan is None:
            task.final = FinalAnswer(answer="(planner failed to produce a plan)")
            task.status = "failed"
            return task

        task.plan = plan

        # 4) execute steps
        self._execute_plan(task)

        # 5) summarize
        if not task.final:
            self._final_summarize(task)

        # 6) persist summary
        try:
            if task.final:
                self.memory.save_task(task.id, mode, task.final.answer[:2000],
                                      preset=task.preset)
        except Exception:
            pass

        task.status = "done" if task.final else "failed"
        self.logger.info("task.done", task_id=task.id,
                         steps=len(task.steps), preset=task.preset)
        return task

    # ---- planning ----
    def _plan_from_preset(self, preset: Preset, user_input: str) -> Plan:
        steps = []
        for i, s in enumerate(preset.steps):
            steps.append({
                "id": f"s{i+1}",
                "agent": s.get("agent", "researcher"),
                "task": (s.get("task") or "").replace("{input}", user_input),
                "depends_on": s.get("depends_on", []),
            })
        return Plan.model_validate({"steps": steps})

    def _plan_adhoc(self, user_input: str, mode: str) -> Plan | None:
        planner = self.agents["planner"]
        plan, err = planner.invoke_structured(
            user_input, system_ctx=self._ctx(mode), retries=self.max_retries,
        )
        if plan is None:
            self.logger.error("planner.failed", error=err)
        return plan

    # ---- filesystem grounding ----
    def _ground_with_fs(self, user_input: str, task_text: str) -> str:
        """Detect path references in the task/input and inject real file content."""
        combined = user_input + " " + task_text
        # Find path-like tokens (e.g. nova/, nova/nova/core/, path/to/file.py)
        candidates = re.findall(r'[\w./\-]+(?:/[\w./\-]*)+', combined)
        injections: list[str] = []
        seen: set[str] = set()
        project_root = Path(__file__).resolve().parents[3]  # workspace root

        for raw in candidates:
            raw = raw.strip("/. ")
            if not raw or raw in seen:
                continue
            seen.add(raw)
            # Try relative to project_root and cwd
            for base in (project_root, Path.cwd()):
                p = (base / raw).resolve()
                if p.is_dir():
                    try:
                        py_files = sorted(p.rglob("*.py"))[:40]
                        if py_files:
                            listing = "\n".join(
                                str(f.relative_to(base)) for f in py_files
                            )
                            injections.append(
                                f"[FS:dir:{raw}]\n{listing}\n[/FS]"
                            )
                            # Read small Python files (<=4 KB each, max 10 files total)
                            for f in py_files[:10]:
                                try:
                                    if f.stat().st_size <= 4096:
                                        content = f.read_text(errors="replace")
                                        injections.append(
                                            f"[FS:file:{f.relative_to(base)}]\n{content}\n[/FS]"
                                        )
                                except Exception:
                                    pass
                    except Exception:
                        pass
                    break
                elif p.is_file() and p.suffix in (".py", ".yaml", ".yml", ".json", ".txt", ".md"):
                    try:
                        if p.stat().st_size <= 32768:
                            content = p.read_text(errors="replace")
                            injections.append(
                                f"[FS:file:{raw}]\n{content}\n[/FS]"
                            )
                    except Exception:
                        pass
                    break

        if not injections:
            return ""
        # Sanitize: strip characters that break JSON string encoding inside LLM output
        combined = "\n\n".join(injections)
        # Replace backslashes and control chars that cause JSON parse failures
        combined = combined.replace("\\", "/").replace("\r", "")
        return "\n\n=== REAL FILESYSTEM CONTEXT (use this, do not guess) ===\n" + combined

    # ---- execution ----
    def _execute_plan(self, task: Task) -> None:
        assert task.plan is not None
        outputs: dict[str, Any] = {}
        for step in task.plan.steps[: self.max_iter]:
            rec = StepRecord(id=step.id, agent=step.agent, task=step.task)
            task.steps.append(rec)
            agent = self.agents.get(step.agent)
            if not agent:
                # Remap unknown agent names to researcher as a safe fallback
                fallback = self.agents.get("researcher")
                if fallback:
                    self.logger.warning("step.agent_remapped",
                                        original=step.agent, remapped="researcher")
                    agent = fallback
                    rec.agent = "researcher"
                else:
                    rec.status = "failed"
                    rec.error = f"unknown agent {step.agent}"
                    self.logger.error("step.unknown_agent", agent=step.agent)
                    continue
            deps_ctx = ""
            for dep in step.depends_on:
                if dep in outputs:
                    deps_ctx += f"\n\n[{dep}]\n{str(outputs[dep])[:8000]}"
            user = f"TASK: {step.task}\nUSER_INPUT: {task.user_input}{deps_ctx}"
            # Inject real filesystem content for grounded agents
            if step.agent in _FILE_GROUNDED_AGENTS:
                fs_ctx = self._ground_with_fs(task.user_input, step.task)
                if fs_ctx:
                    user += fs_ctx
            rec.status = "running"
            try:
                if agent.output_schema is None:
                    out_text = agent.invoke_text(user, system_ctx=self._ctx(task.mode))
                    outputs[step.id] = out_text
                    rec.output = {"text": out_text[:4000]}
                    rec.status = "done"
                else:
                    obj, err = agent.invoke_structured(
                        user, system_ctx=self._ctx(task.mode),
                        retries=self.max_retries,
                    )
                    if obj is None:
                        rec.status = "failed"
                        rec.error = err
                        continue
                    outputs[step.id] = obj.model_dump()
                    rec.output = obj.model_dump()
                    rec.status = "done"
                    # capture final answer if summarizer ran
                    if step.agent == "summarizer" and isinstance(obj, FinalAnswer):
                        task.final = obj
            except Exception as e:
                rec.status = "failed"
                rec.error = f"{type(e).__name__}: {e}"
                self.logger.error("step.error", step=step.id, error=rec.error)

    def _final_summarize(self, task: Task) -> None:
        payload = []
        for s in task.steps:
            payload.append({"step": s.id, "agent": s.agent, "status": s.status,
                            "output": s.output, "error": s.error})
        summarizer = self.agents["summarizer"]
        obj, err = summarizer.invoke_structured(
            f"USER_INPUT: {task.user_input}\n\nSTEP_RESULTS: {payload}",
            system_ctx=self._ctx(task.mode), retries=self.max_retries,
        )
        if isinstance(obj, FinalAnswer):
            task.final = obj
        else:
            task.final = FinalAnswer(answer=f"(summarizer failed: {err})")
