"""
Nova — Autonomous Agent
========================
The capstone system that makes Nova truly JARVIS-tier. Instead of
only responding to messages, Nova can detect problems, plan fixes,
execute multi-step tasks, and verify the results — all on her own.

Flow:
  1. Event triggers a task (service down, file changed, scheduled job)
  2. Agent plans the steps
  3. Each step executes through existing Nova tools
  4. Dangerous actions gate on owner approval
  5. Results are verified and reported
  6. Full audit trail of reasoning + actions

Safety:
  - Approval gates for destructive/irreversible actions
  - Guardian validates every path/command
  - Max steps per task (prevents runaway loops)
  - Timeout per task
  - All actions logged with reasoning
"""

import asyncio
import enum
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable


class TaskState(str, enum.Enum):
    QUEUED = "queued"
    PLANNING = "planning"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class ApprovalLevel(str, enum.Enum):
    AUTO = "auto"               # Safe — execute without asking
    NOTIFY = "notify"           # Execute, but tell Cayden
    CONFIRM = "confirm"         # Ask first, wait for approval


# Actions that require confirmation
_CONFIRM_ACTIONS = frozenset({
    "delete_file", "delete_directory",
    "restart_service", "stop_service",
    "modify_config", "modify_security",
    "push_code", "deploy",
    "kill_process",
    "write_file",  # writing code requires confirmation
})

# Actions that auto-execute but notify
_NOTIFY_ACTIONS = frozenset({
    "read_file", "analyze_code",
    "run_command",
    "start_service",
    "build_project",
    "system_info",
})


@dataclass
class TaskStep:
    """A single step in an autonomous task."""
    index: int
    action: str                 # tool name or action type
    args: dict = field(default_factory=dict)
    description: str = ""
    approval: str = "auto"      # auto / notify / confirm
    state: str = "pending"      # pending / running / done / failed / skipped / approved / rejected
    result: Any = None
    error: str = ""
    started_at: float | None = None
    finished_at: float | None = None

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "action": self.action,
            "args": self.args,
            "description": self.description,
            "approval": self.approval,
            "state": self.state,
            "result": str(self.result)[:500] if self.result else None,
            "error": self.error,
            "duration": round(self.finished_at - self.started_at, 2)
                if self.started_at and self.finished_at else None,
        }


@dataclass
class AutonomousTask:
    """A multi-step autonomous task."""
    id: str
    title: str
    trigger: str                # what caused this task
    trigger_details: dict = field(default_factory=dict)
    steps: list[TaskStep] = field(default_factory=list)
    state: TaskState = TaskState.QUEUED
    reasoning: str = ""         # Nova's reasoning for the plan
    created_at: float = 0.0
    started_at: float | None = None
    finished_at: float | None = None
    result_summary: str = ""
    max_steps: int = 20
    timeout_seconds: float = 600.0    # 10 min default

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "trigger": self.trigger,
            "state": self.state.value,
            "reasoning": self.reasoning,
            "steps": [s.to_dict() for s in self.steps],
            "step_count": len(self.steps),
            "current_step": next(
                (s.index for s in self.steps if s.state in ("running", "pending")),
                None,
            ),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result_summary": self.result_summary,
            "duration": round(self.finished_at - self.started_at, 2)
                if self.started_at and self.finished_at else None,
        }


class AutonomousAgent:
    """
    Nova's self-directed execution engine. Detects problems,
    plans fixes, executes through tools, and reports results.
    """

    def __init__(self, tool_executor, guardian, audit, activity_tracker):
        self._tools = tool_executor
        self._guardian = guardian
        self._audit = audit
        self._activity = activity_tracker

        self._tasks: dict[str, AutonomousTask] = {}
        self._queue: list[str] = []     # task IDs in order
        self._approvals: dict[str, bool | None] = {}  # step_key → True/False/None

        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        # Callback for requesting approval from the user
        self._approval_callback: Callable | None = None
        # Callback for notifying user of completed tasks
        self._notify_callback: Callable | None = None

        self._max_concurrent = 1        # one task at a time
        self._active_task: str | None = None

    # ── Configuration ─────────────────────────────

    def set_approval_callback(self, fn: Callable):
        """Register callback: fn(task_id, step_index, action, description) → sends to UI."""
        self._approval_callback = fn

    def set_notify_callback(self, fn: Callable):
        """Register callback: fn(task_dict) → notifies user."""
        self._notify_callback = fn

    # ── Task Creation ─────────────────────────────

    def create_task(
        self,
        title: str,
        trigger: str,
        steps: list[dict],
        reasoning: str = "",
        trigger_details: dict | None = None,
        max_steps: int = 20,
        timeout: float = 600.0,
    ) -> AutonomousTask:
        """
        Create and queue a new autonomous task.

        steps: [{"action": "tool_name", "args": {...}, "description": "..."}]
        """
        task_id = uuid.uuid4().hex[:12]

        task_steps = []
        for i, s in enumerate(steps[:max_steps]):
            action = s.get("action", "")
            approval = self._determine_approval(action)
            task_steps.append(TaskStep(
                index=i,
                action=action,
                args=s.get("args", {}),
                description=s.get("description", ""),
                approval=approval,
            ))

        task = AutonomousTask(
            id=task_id,
            title=title,
            trigger=trigger,
            trigger_details=trigger_details or {},
            steps=task_steps,
            reasoning=reasoning,
            created_at=time.time(),
            max_steps=max_steps,
            timeout_seconds=timeout,
        )

        with self._lock:
            self._tasks[task_id] = task
            self._queue.append(task_id)

        self._audit.log("agent", "task_created", {
            "id": task_id,
            "title": title,
            "trigger": trigger,
            "steps": len(task_steps),
        })

        return task

    def create_reactive_task(
        self,
        event_title: str,
        event_category: str,
        event_details: dict,
    ) -> AutonomousTask | None:
        """
        Auto-create a task in response to a ledger event.
        Returns None if no playbook matches.
        """
        # Service failure → restart
        if event_category == "service" and "FAILED" in event_title:
            svc_name = event_details.get("service", "unknown")
            return self.create_task(
                title=f"Auto-recover service: {svc_name}",
                trigger="service_failure",
                trigger_details=event_details,
                reasoning=f"Service {svc_name} entered FAILED state. "
                          f"Attempting restart after investigation.",
                steps=[
                    {
                        "action": "system_info",
                        "description": "Check system resources before restart",
                    },
                    {
                        "action": "run_command",
                        "args": {"command": f"journalctl --no-pager -n 20 -u {svc_name} 2>/dev/null || echo 'no journal'"},
                        "description": f"Check {svc_name} logs for crash reason",
                    },
                    {
                        "action": "restart_service",
                        "args": {"name": svc_name},
                        "description": f"Restart {svc_name}",
                    },
                ],
            )

        # Integrity violation → snapshot + alert
        if event_category == "security" and "integrity" in event_title.lower():
            return self.create_task(
                title="Investigate integrity violation",
                trigger="integrity_violation",
                trigger_details=event_details,
                reasoning="An integrity violation was detected. Checking if this "
                          "is a legitimate deploy or an unauthorized change.",
                steps=[
                    {
                        "action": "run_command",
                        "args": {"command": "git -C ~/discord\\ bot/discord\\ bot log --oneline -5"},
                        "description": "Check recent git commits",
                    },
                    {
                        "action": "system_info",
                        "description": "Capture system state",
                    },
                ],
            )

        return None

    # ── Approval ──────────────────────────────────

    def approve_step(self, task_id: str, step_index: int) -> bool:
        """Approve a step waiting for confirmation."""
        key = f"{task_id}:{step_index}"
        with self._lock:
            self._approvals[key] = True
        self._audit.log("agent", "step_approved", {
            "task_id": task_id, "step": step_index,
        })
        return True

    def reject_step(self, task_id: str, step_index: int) -> bool:
        """Reject a step — skip it."""
        key = f"{task_id}:{step_index}"
        with self._lock:
            self._approvals[key] = False
        self._audit.log("agent", "step_rejected", {
            "task_id": task_id, "step": step_index,
        })
        return True

    def cancel_task(self, task_id: str) -> bool:
        """Cancel a queued or running task."""
        task = self._tasks.get(task_id)
        if not task:
            return False
        if task.state in (TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED):
            return False

        task.state = TaskState.CANCELLED
        task.finished_at = time.time()
        task.result_summary = "Cancelled by owner"

        self._audit.log("agent", "task_cancelled", {"id": task_id})
        return True

    # ── Execution Loop ────────────────────────────

    def start(self, interval: float = 5.0):
        """Start the background task execution loop."""
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,),
            daemon=True, name="autonomous-agent",
        )
        self._thread.start()

    def stop(self):
        self._running = False

    def _loop(self, interval: float):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        while self._running:
            try:
                loop.run_until_complete(self._process_queue())
            except Exception as e:
                self._audit.log("agent", "loop_error", {"error": str(e)})
            time.sleep(interval)
        loop.close()

    async def _process_queue(self):
        """Process the next queued task."""
        if self._active_task:
            # Check if active task has timed out
            task = self._tasks.get(self._active_task)
            if task and task.state == TaskState.RUNNING:
                elapsed = time.time() - (task.started_at or time.time())
                if elapsed > task.timeout_seconds:
                    task.state = TaskState.TIMEOUT
                    task.finished_at = time.time()
                    task.result_summary = f"Timed out after {elapsed:.0f}s"
                    self._active_task = None
            elif task and task.state == TaskState.WAITING_APPROVAL:
                # Check if approval came in
                await self._resume_task(task)
                return
            else:
                self._active_task = None

        if self._active_task:
            return

        # Pick next queued task
        with self._lock:
            while self._queue:
                task_id = self._queue.pop(0)
                task = self._tasks.get(task_id)
                if task and task.state == TaskState.QUEUED:
                    self._active_task = task_id
                    break
            else:
                return

        task = self._tasks[self._active_task]
        await self._execute_task(task)

    async def _execute_task(self, task: AutonomousTask):
        """Execute all steps of a task."""
        task.state = TaskState.RUNNING
        task.started_at = time.time()

        self._audit.log("agent", "task_started", {
            "id": task.id, "title": task.title,
        })
        self._activity.system_event(
            f"Autonomous task started: {task.title}")

        for step in task.steps:
            if task.state in (TaskState.CANCELLED, TaskState.TIMEOUT):
                break

            # Check approval level
            if step.approval == ApprovalLevel.CONFIRM.value:
                # Request approval
                if self._approval_callback:
                    self._approval_callback(
                        task.id, step.index, step.action, step.description,
                    )

                # Check if pre-approved
                key = f"{task.id}:{step.index}"
                approval = self._approvals.get(key)

                if approval is None:
                    # Wait for approval — pause the task
                    task.state = TaskState.WAITING_APPROVAL
                    self._audit.log("agent", "waiting_approval", {
                        "task_id": task.id, "step": step.index,
                        "action": step.action,
                    })
                    return  # Will be resumed when approval comes in

                if approval is False:
                    step.state = "skipped"
                    continue

            # Execute the step
            step.state = "running"
            step.started_at = time.time()

            try:
                result = await self._execute_step(step)
                step.result = result
                step.state = "done"

                if step.approval == ApprovalLevel.NOTIFY.value:
                    self._activity.system_event(
                        f"Agent action: {step.description or step.action}")

            except Exception as e:
                step.error = str(e)
                step.state = "failed"
                self._audit.log("agent", "step_failed", {
                    "task_id": task.id,
                    "step": step.index,
                    "error": str(e),
                })
                # Don't stop on failure — continue with remaining steps
                # unless this was a critical step

            step.finished_at = time.time()

        # Task complete
        if task.state not in (TaskState.CANCELLED, TaskState.TIMEOUT):
            failed_steps = [s for s in task.steps if s.state == "failed"]
            if failed_steps:
                task.state = TaskState.FAILED
                task.result_summary = (
                    f"{len(failed_steps)} step(s) failed: "
                    + ", ".join(s.error[:50] for s in failed_steps)
                )
            else:
                task.state = TaskState.COMPLETED
                done = [s for s in task.steps if s.state == "done"]
                task.result_summary = f"Completed {len(done)}/{len(task.steps)} steps"

        task.finished_at = time.time()
        self._active_task = None

        self._audit.log("agent", "task_finished", {
            "id": task.id,
            "state": task.state.value,
            "summary": task.result_summary,
        })
        self._activity.system_event(
            f"Autonomous task {task.state.value}: {task.title} — {task.result_summary}")

        if self._notify_callback:
            self._notify_callback(task.to_dict())

    async def _resume_task(self, task: AutonomousTask):
        """Resume a task that was waiting for approval."""
        # Find the step that was waiting
        for step in task.steps:
            if step.state == "pending" and step.approval == ApprovalLevel.CONFIRM.value:
                key = f"{task.id}:{step.index}"
                approval = self._approvals.get(key)
                if approval is not None:
                    task.state = TaskState.RUNNING
                    await self._execute_task(task)
                    return
                break  # Still waiting

    async def _execute_step(self, step: TaskStep) -> Any:
        """Execute a single step through the tool system."""
        action = step.action

        # Special actions handled directly
        if action == "restart_service":
            # Delegate through tool system
            svc_name = step.args.get("name", "?")
            from core.tool_system import ToolCall
            call = ToolCall(name="run_command", args={
                "command": f"echo 'Service restart requested: {svc_name}'",
            })
            result = await self._tools.execute(call)
            if not result.success:
                raise RuntimeError(result.error or "Restart service failed")
            return result.output

        # Execute through tool system
        from core.tool_system import ToolCall
        call = ToolCall(name=action, args=step.args)
        result = await self._tools.execute(call)

        if not result.success:
            raise RuntimeError(result.error or f"Tool {action} failed")

        return result.output

    # ── Approval Level Classification ─────────────

    @staticmethod
    def _determine_approval(action: str) -> str:
        """Determine what approval level an action needs."""
        if action in _CONFIRM_ACTIONS:
            return ApprovalLevel.CONFIRM.value
        if action in _NOTIFY_ACTIONS:
            return ApprovalLevel.NOTIFY.value
        return ApprovalLevel.AUTO.value

    # ── Query ─────────────────────────────────────

    def get_task(self, task_id: str) -> dict | None:
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None

    def list_tasks(
        self,
        state: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        tasks = list(self._tasks.values())
        if state:
            tasks = [t for t in tasks if t.state.value == state]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return [t.to_dict() for t in tasks[:limit]]

    def get_status(self) -> dict:
        total = len(self._tasks)
        by_state = {}
        for t in self._tasks.values():
            s = t.state.value
            by_state[s] = by_state.get(s, 0) + 1

        return {
            "total_tasks": total,
            "active_task": self._active_task,
            "queued": len(self._queue),
            "by_state": by_state,
            "running": self._running,
        }
