"""
Nova — Tool System
====================
The tool system is how Nova ACTS on the world, not just talks.

Nova can output structured tool calls mid-response. The engine
intercepts these, executes them, and feeds results back so Nova
can continue naturally.

Tools:
  - run_command: Execute shell commands (sandboxed)
  - read_file / write_file: File operations
  - spawn_process: Start a background process
  - kill_process: Kill a managed process
  - list_processes: See running processes
  - web_search: Search the web
  - open_url: Open a URL in browser
  - set_reminder: Schedule a future reminder
  - set_timer: Countdown timer
  - system_info: CPU/RAM/GPU/disk status
  - smart_home: Govee lights control
  - goal_create / goal_update: Manage goals
  - learn_skill: Save a reusable procedure
"""

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Pattern to extract tool calls from Nova's response
# Format: <tool name="tool_name">{"arg": "value"}</tool>
_TOOL_PATTERN = re.compile(
    r'<tool\s+name="(\w+)">\s*(\{[\s\S]*?\})\s*</tool>',
    re.IGNORECASE,
)

# Also support fenced JSON blocks with a "tool" field
_JSON_TOOL_PATTERN = re.compile(
    r'```(?:json)?\s*(\{[\s\S]*?"tool"\s*:\s*"[\s\S]*?\})\s*```',
    re.IGNORECASE,
)

# Freeform format the model sometimes uses:
#   tool: browser_type
#   args: {"text": "..."}    or    args: text="..."
_FREEFORM_TOOL_PATTERN = re.compile(
    r'(?:^|\n)\s*tool:\s*(\w+)\s*\n\s*args:\s*(\{[\s\S]*?\}|[^\n]+)',
    re.IGNORECASE | re.MULTILINE,
)

# Catch any remaining bare "tool: ..." / "args: ..." lines that slip through
# Only match lines that look exactly like tool/args declarations (not prose)
_BARE_TOOL_LINE_PATTERN = re.compile(
    r'^\s*(?:tool|args)\s*:[ \t]+\S.*$',
    re.IGNORECASE | re.MULTILINE,
)


class ToolCall:
    """A parsed tool invocation."""
    def __init__(self, name: str, args: dict):
        self.name = name
        self.args = args

    def to_dict(self) -> dict:
        return {"tool": self.name, "args": self.args}


class ToolResult:
    """Result of executing a tool."""
    def __init__(self, tool_name: str, success: bool, output: Any = None, error: str = ""):
        self.tool_name = tool_name
        self.success = success
        self.output = output
        self.error = error

    def to_dict(self) -> dict:
        return {
            "tool": self.tool_name,
            "success": self.success,
            "output": self.output,
            "error": self.error,
        }

    def to_context_string(self) -> str:
        """Format for injection back into the conversation."""
        if self.success:
            out = str(self.output) if self.output is not None else "Done"
            # Trim huge outputs
            if len(out) > 2000:
                out = out[:2000] + f"\n... (truncated, {len(str(self.output))} chars total)"
            return f"[Tool '{self.tool_name}' succeeded: {out}]"
        return f"[Tool '{self.tool_name}' failed: {self.error}]"


class ToolRegistry:
    """
    Registry of available tools.
    Each tool has a name, description, parameter schema, and executor function.
    """

    def __init__(self):
        self._tools: dict[str, dict] = {}

    def register(self, name: str, description: str, params: dict, handler):
        """Register a tool with its handler function."""
        self._tools[name] = {
            "name": name,
            "description": description,
            "params": params,
            "handler": handler,
        }

    def get(self, name: str) -> dict | None:
        return self._tools.get(name)

    def list_tools(self) -> list[dict]:
        return [
            {"name": t["name"], "description": t["description"], "params": t["params"]}
            for t in self._tools.values()
        ]

    def get_prompt_description(self) -> str:
        """Generate the tool description block for the system prompt."""
        lines = ["## Available Tools\n"]
        lines.append("When you need to PERFORM AN ACTION, use a tool call. Format:\n")
        lines.append('<tool name="tool_name">{"param": "value"}</tool>\n')
        lines.append("You can include multiple tool calls in a single response.")
        lines.append("After each tool call, you'll receive the result and can continue.\n")
        lines.append("Tools:\n")
        for t in self._tools.values():
            params_desc = ", ".join(
                f"{k}: {v}" for k, v in t["params"].items()
            ) if t["params"] else "none"
            lines.append(f"  • **{t['name']}** — {t['description']}")
            lines.append(f"    Parameters: {params_desc}")
        return "\n".join(lines)


class ToolExecutor:
    """
    Extracts tool calls from Nova's responses, executes them,
    and returns results for injection back into the conversation.
    """

    def __init__(self, registry: ToolRegistry, audit, activity_tracker):
        self._registry = registry
        self._audit = audit
        self._activity = activity_tracker

    def extract_tool_calls(self, text: str) -> list[ToolCall]:
        """Extract all tool calls from a response text."""
        calls = []

        # Try <tool> tag format
        for match in _TOOL_PATTERN.finditer(text):
            name = match.group(1)
            try:
                args = json.loads(match.group(2))
                calls.append(ToolCall(name, args))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse tool args for {name}")

        # Try fenced JSON format
        if not calls:
            for match in _JSON_TOOL_PATTERN.finditer(text):
                try:
                    obj = json.loads(match.group(1))
                    name = obj.pop("tool", None)
                    if name:
                        calls.append(ToolCall(name, obj.get("args", obj)))
                except json.JSONDecodeError:
                    continue

        # Try freeform "tool: name\nargs: {...}" format
        if not calls:
            for match in _FREEFORM_TOOL_PATTERN.finditer(text):
                name = match.group(1).strip()
                raw_args = match.group(2).strip()
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    # args might be key=value style — treat as {text: value}
                    args = {"text": raw_args.strip('"')}
                calls.append(ToolCall(name, args))

        return calls

    def strip_tool_calls(self, text: str) -> str:
        """Remove tool call markup from visible text."""
        text = _TOOL_PATTERN.sub("", text)
        text = _JSON_TOOL_PATTERN.sub("", text)
        text = _FREEFORM_TOOL_PATTERN.sub("", text)
        text = _BARE_TOOL_LINE_PATTERN.sub("", text)
        # Clean up multiple blank lines left behind
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    async def execute(self, call: ToolCall) -> ToolResult:
        """Execute a single tool call."""
        tool = self._registry.get(call.name)
        if not tool:
            self._audit.log("tools", "unknown_tool", {"name": call.name})
            return ToolResult(call.name, False, error=f"Unknown tool: {call.name}")

        self._audit.log("tools", "executing", {
            "tool": call.name, "args": call.args,
        })
        self._activity.system_event(
            f"Tool call: {call.name}",
            details={"args": call.args},
        )

        try:
            handler = tool["handler"]
            if asyncio.iscoroutinefunction(handler):
                result = await handler(call.args)
            else:
                result = handler(call.args)

            self._audit.log("tools", "completed", {
                "tool": call.name, "success": True,
            })
            return ToolResult(call.name, True, output=result)

        except Exception as e:
            self._audit.log("tools", "error", {
                "tool": call.name, "error": str(e),
            })
            return ToolResult(call.name, False, error=str(e))

    async def execute_all(self, calls: list[ToolCall]) -> list[ToolResult]:
        """Execute all tool calls in sequence."""
        results = []
        for call in calls:
            result = await self.execute(call)
            results.append(result)
        return results


def build_tool_registry(modules: dict) -> ToolRegistry:
    """
    Construct the full tool registry with all available tools.
    Called once during boot with all module references.
    """
    import asyncio
    import os
    import platform
    from pathlib import Path

    registry = ToolRegistry()
    executor = modules.get("executor")
    process_mgr = modules.get("process_manager")
    memory = modules.get("memory")
    scheduler = modules.get("scheduler")
    goal_tracker = modules.get("goal_tracker")
    skill_memory = modules.get("skill_memory")
    system_monitor = modules.get("system_monitor")
    service_overseer = modules.get("service_overseer")
    code_workshop = modules.get("code_workshop")
    activity_ledger = modules.get("activity_ledger")
    autonomous_agent = modules.get("autonomous_agent")

    # ── run_command ────────────────────────────────
    async def tool_run_command(args):
        cmd = args.get("command", "")
        if not cmd:
            return "No command specified"
        result = await executor.execute({
            "action": "run_command",
            "args": {"command": cmd},
        })
        if result.get("success"):
            return result.get("result", "Done")
        return f"Error: {result.get('error', 'unknown')}"

    registry.register("run_command", "Run a shell command and get the output", {
        "command": "The shell command to execute (string)",
    }, tool_run_command)

    # ── read_file ─────────────────────────────────
    async def tool_read_file(args):
        path = args.get("path", "")
        result = await executor.execute({
            "action": "file_read",
            "args": {"path": path},
        })
        if result.get("success"):
            return result.get("result", "")
        return f"Error: {result.get('error', 'unknown')}"

    registry.register("read_file", "Read the contents of a file", {
        "path": "Absolute or ~ path to the file",
    }, tool_read_file)

    # ── write_file ────────────────────────────────
    async def tool_write_file(args):
        path = args.get("path", "")
        content = args.get("content", "")
        result = await executor.execute({
            "action": "file_write",
            "args": {"path": path, "content": content},
        })
        if result.get("success"):
            return f"Written to {path}"
        return f"Error: {result.get('error', 'unknown')}"

    registry.register("write_file", "Write content to a file (creates or overwrites)", {
        "path": "Absolute or ~ path", "content": "The text to write",
    }, tool_write_file)

    # ── spawn_process ─────────────────────────────
    if process_mgr:
        async def tool_spawn(args):
            proc = await process_mgr.spawn(
                command=args.get("command", ""),
                name=args.get("name", ""),
                cwd=args.get("cwd"),
                timeout=args.get("timeout", 0),
            )
            return proc.to_dict()

        registry.register("spawn_process", "Start a long-running background process (server, build, etc)", {
            "command": "Shell command to run",
            "name": "Friendly name for tracking",
            "cwd": "(optional) Working directory",
            "timeout": "(optional) Max seconds before auto-kill, 0=no limit",
        }, tool_spawn)

    # ── kill_process ──────────────────────────────
    if process_mgr:
        async def tool_kill(args):
            proc_id = args.get("id", "")
            name = args.get("name", "")
            if proc_id:
                ok = await process_mgr.kill(proc_id)
                return f"Killed process {proc_id}" if ok else f"Process {proc_id} not found"
            elif name:
                killed = await process_mgr.kill_by_name(name)
                return f"Killed {len(killed)} process(es) matching '{name}'" if killed else f"No running processes matching '{name}'"
            return "Specify either 'id' or 'name'"

        registry.register("kill_process", "Kill a running process by ID or name", {
            "id": "(optional) Process ID",
            "name": "(optional) Name pattern to match",
        }, tool_kill)

    # ── list_processes ────────────────────────────
    if process_mgr:
        async def tool_list_procs(args):
            include_dead = args.get("include_dead", False)
            procs = process_mgr.list_processes(include_dead=include_dead)
            if not procs:
                return "No running processes"
            lines = []
            for p in procs:
                lines.append(f"[{p['state']}] {p['name']} (id:{p['id']}, pid:{p['pid']}) — {p['runtime_seconds']}s")
            return "\n".join(lines)

        registry.register("list_processes", "List all managed processes", {
            "include_dead": "(optional) Include completed/killed processes (bool)",
        }, tool_list_procs)

    # ── get_process_output ────────────────────────
    if process_mgr:
        async def tool_proc_output(args):
            proc_id = args.get("id", "")
            tail = args.get("tail", 50)
            out = process_mgr.get_output(proc_id, tail=tail)
            if not out:
                return f"Process {proc_id} not found"
            lines = out["stdout"][-tail:]
            return "\n".join(lines) if lines else "(no output yet)"

        registry.register("get_process_output", "Get recent output from a running process", {
            "id": "Process ID",
            "tail": "(optional) Number of lines, default 50",
        }, tool_proc_output)

    # ── web_search ────────────────────────────────
    async def tool_web_search(args):
        query = args.get("query", "")
        result = await executor.execute({
            "action": "browser",
            "command": "search",
            "query": query,
        })
        if result.get("success"):
            return result.get("result", "No results")
        return f"Search failed: {result.get('error', '')}"

    registry.register("web_search", "Search the web for information", {
        "query": "Search query string",
    }, tool_web_search)

    # ── open_url ──────────────────────────────────
    async def tool_open_url(args):
        url = args.get("url", "")
        result = await executor.execute({
            "action": "open_url",
            "args": {"url": url},
        })
        return "Opened" if result.get("success") else f"Failed: {result.get('error', '')}"

    registry.register("open_url", "Open a URL in the default browser", {
        "url": "The URL to open",
    }, tool_open_url)

    # ── set_reminder ──────────────────────────────
    if scheduler:
        def tool_reminder(args):
            name = args.get("name", "Reminder")
            minutes = args.get("minutes", 0)
            at_time = args.get("at_time", "")
            message = args.get("message", name)
            tid = scheduler.schedule_reminder(name, minutes_from_now=minutes, at_time=at_time, message=message)
            return f"Reminder set (id:{tid}): {name}"

        registry.register("set_reminder", "Set a reminder for the future", {
            "name": "Reminder title",
            "minutes": "(optional) Minutes from now",
            "at_time": "(optional) Specific time in ISO format",
            "message": "(optional) Message to show",
        }, tool_reminder)

    # ── system_info ───────────────────────────────
    if system_monitor:
        def tool_sysinfo(args):
            return system_monitor.get_snapshot()
    else:
        def tool_sysinfo(args):
            import psutil
            import shutil
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = shutil.disk_usage("/")
            info = {
                "cpu_percent": cpu,
                "ram_total_gb": round(mem.total / 1e9, 1),
                "ram_used_gb": round(mem.used / 1e9, 1),
                "ram_percent": mem.percent,
                "disk_total_gb": round(disk.total / 1e9, 1),
                "disk_used_gb": round(disk.used / 1e9, 1),
                "disk_percent": round(disk.used / disk.total * 100, 1),
                "platform": platform.platform(),
            }
            # GPU info
            try:
                import subprocess
                result = subprocess.run(
                    ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,temperature.gpu,utilization.gpu",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    parts = result.stdout.strip().split(", ")
                    if len(parts) >= 5:
                        info["gpu_name"] = parts[0]
                        info["gpu_vram_total_mb"] = int(parts[1])
                        info["gpu_vram_used_mb"] = int(parts[2])
                        info["gpu_temp_c"] = int(parts[3])
                        info["gpu_utilization"] = int(parts[4])
            except Exception:
                pass
            return info

    registry.register("system_info", "Get current system resource usage (CPU, RAM, GPU, disk)", {}, tool_sysinfo)

    # ── smart_home (Govee) ────────────────────────
    async def tool_smart_home(args):
        action = args.get("action", "")
        device = args.get("device", "")
        cmd = {"action": f"govee_{action}", "args": {}}
        if device:
            cmd["args"]["device"] = device
        if "color" in args:
            cmd["args"]["color"] = args["color"]
        if "brightness" in args:
            cmd["args"]["brightness"] = args["brightness"]
        result = await executor.execute(cmd)
        if result.get("success"):
            return result.get("result", "Done")
        return f"Error: {result.get('error', '')}"

    registry.register("smart_home", "Control smart home devices (lights on/off, color, brightness)", {
        "action": "on, off, color, brightness, status, list",
        "device": "(optional) Device name",
        "color": "(optional) Color name or hex",
        "brightness": "(optional) 0-100",
    }, tool_smart_home)

    # ── goal_create ───────────────────────────────
    if goal_tracker:
        def tool_goal_create(args):
            goal = goal_tracker.create_goal(
                title=args.get("title", ""),
                description=args.get("description", ""),
                steps=args.get("steps", []),
            )
            return goal

        registry.register("goal_create", "Create a new multi-step goal with subtasks", {
            "title": "Goal title",
            "description": "(optional) Goal description",
            "steps": "(optional) List of step strings",
        }, tool_goal_create)

    # ── goal_update ───────────────────────────────
    if goal_tracker:
        def tool_goal_update(args):
            return goal_tracker.update_step(
                goal_id=args.get("goal_id", 0),
                step_index=args.get("step_index", 0),
                status=args.get("status", "done"),
                note=args.get("note", ""),
            )

        registry.register("goal_update", "Update a goal step status", {
            "goal_id": "Goal ID",
            "step_index": "Step index (0-based)",
            "status": "done, failed, or skipped",
            "note": "(optional) Note about the step",
        }, tool_goal_update)

    # ── learn_skill ───────────────────────────────
    if skill_memory:
        def tool_learn_skill(args):
            return skill_memory.save_skill(
                name=args.get("name", ""),
                description=args.get("description", ""),
                steps=args.get("steps", []),
                tags=args.get("tags", []),
            )

        registry.register("learn_skill", "Save a reusable procedure/skill for future use", {
            "name": "Skill name",
            "description": "What this skill does",
            "steps": "List of step strings (the procedure)",
            "tags": "(optional) Tags for finding this skill later",
        }, tool_learn_skill)

    # ── Service Overseer Tools ────────────────────
    if service_overseer:
        async def tool_service_list(args):
            return service_overseer.get_status()

        registry.register("list_services", "List all managed services and their health status", {},
                           tool_service_list)

        async def tool_service_start(args):
            name = args.get("name", "")
            if not name:
                return "Specify service name"
            ok = await service_overseer.start_service(name)
            return f"Started {name}" if ok else f"Failed to start {name}"

        registry.register("start_service", "Start a managed service by name", {
            "name": "Service name",
        }, tool_service_start)

        async def tool_service_stop(args):
            name = args.get("name", "")
            if not name:
                return "Specify service name"
            ok = await service_overseer.stop_service(name, reason="Nova tool call")
            return f"Stopped {name}" if ok else f"Failed to stop {name}"

        registry.register("stop_service", "Stop a managed service by name", {
            "name": "Service name",
        }, tool_service_stop)

        async def tool_service_restart(args):
            name = args.get("name", "")
            if not name:
                return "Specify service name"
            ok = await service_overseer.restart_service(name, reason="Nova tool call")
            return f"Restarted {name}" if ok else f"Failed to restart {name}"

        registry.register("restart_service", "Restart a managed service (stop then start)", {
            "name": "Service name",
        }, tool_service_restart)

    # ── Code Workshop Tools ───────────────────────
    if code_workshop:
        def tool_analyze_code(args):
            path = args.get("path", "")
            if not path:
                return "Specify file path"
            analysis = code_workshop.analyze_file(path)
            return analysis.to_dict()

        registry.register("analyze_code", "Analyze a source file — get its structure (functions, classes, imports)", {
            "path": "Path to the source file",
        }, tool_analyze_code)

        def tool_find_function(args):
            path = args.get("path", "")
            name = args.get("name", "")
            block = code_workshop.find_block(path, name)
            if not block:
                return f"Block '{name}' not found in {path}"
            return {
                "name": block.name,
                "type": block.block_type,
                "start_line": block.start_line,
                "end_line": block.end_line,
                "source": block.source,
            }

        registry.register("find_function", "Find a function/class/method by name and return its source code", {
            "path": "Path to the source file",
            "name": "Function, class, or method name (use Class.method for methods)",
        }, tool_find_function)

        def tool_edit_code(args):
            patch = code_workshop.edit_file(
                file_path=args.get("path", ""),
                old_text=args.get("old_text", ""),
                new_text=args.get("new_text", ""),
                description=args.get("description", ""),
            )
            if not patch:
                return "Edit failed — text not found or access denied"
            return {"diff": patch.diff, "description": patch.description}

        registry.register("edit_code", "Find-and-replace edit in a source file with diff preview", {
            "path": "File path",
            "old_text": "Exact text to find",
            "new_text": "Replacement text",
            "description": "(optional) Description of the change",
        }, tool_edit_code)

        def tool_create_source_file(args):
            ok = code_workshop.create_file(
                file_path=args.get("path", ""),
                content=args.get("content", ""),
                description=args.get("description", ""),
            )
            return f"Created {args.get('path', '')}" if ok else "Create failed"

        registry.register("create_source_file", "Create a new source code file (validates Python syntax)", {
            "path": "File path to create",
            "content": "File content",
            "description": "(optional) Description",
        }, tool_create_source_file)

        def tool_build_project(args):
            result = code_workshop.build_project(
                project_path=args.get("path", ""),
                force_type=args.get("type", ""),
            )
            return result.to_dict()

        registry.register("build_project", "Run build pipeline for a project (install deps, build, test)", {
            "path": "Project directory path",
            "type": "(optional) Force project type: python, node, rust, go, docker",
        }, tool_build_project)

        def tool_scaffold_project(args):
            return code_workshop.scaffold_project(
                base_path=args.get("base_path", ""),
                project_name=args.get("name", ""),
                project_type=args.get("type", "python"),
                features=args.get("features", []),
            )

        registry.register("scaffold_project", "Create a new project directory with boilerplate code", {
            "base_path": "Parent directory",
            "name": "Project name",
            "type": "Project type: python, node, fastapi",
            "features": "(optional) List of features like 'auth'",
        }, tool_scaffold_project)

    # ── Activity Ledger Tools ─────────────────────
    if activity_ledger:
        def tool_recent_activity(args):
            count = args.get("count", 20)
            category = args.get("category")
            severity = args.get("severity")
            return activity_ledger.get_events(
                count=count, category=category, severity=severity,
            )

        registry.register("recent_activity", "Get recent system activity events with optional filters", {
            "count": "(optional) Number of events, default 20",
            "category": "(optional) Filter: file, process, service, security, command, system",
            "severity": "(optional) Filter: routine, notable, suspicious, critical",
        }, tool_recent_activity)

        def tool_activity_summary(args):
            minutes = args.get("minutes", 60)
            return activity_ledger.get_summary(minutes=minutes)

        registry.register("activity_summary", "Get summary of recent system activity (event counts by type)", {
            "minutes": "(optional) Time window in minutes, default 60",
        }, tool_activity_summary)

    # ── Autonomous Agent Tools ────────────────────
    if autonomous_agent:
        def tool_create_task(args):
            task = autonomous_agent.create_task(
                title=args.get("title", ""),
                trigger="nova_tool_call",
                steps=args.get("steps", []),
                reasoning=args.get("reasoning", ""),
                timeout=args.get("timeout", 600),
            )
            return task.to_dict()

        registry.register("create_task", "Create an autonomous multi-step task that Nova executes herself", {
            "title": "Task title",
            "steps": 'List of steps: [{"action": "tool_name", "args": {...}, "description": "..."}]',
            "reasoning": "(optional) Reasoning for why this task is needed",
            "timeout": "(optional) Max seconds, default 600",
        }, tool_create_task)

        def tool_task_status(args):
            task_id = args.get("task_id")
            if task_id:
                return autonomous_agent.get_task(task_id) or "Task not found"
            return autonomous_agent.get_status()

        registry.register("task_status", "Check the status of autonomous tasks", {
            "task_id": "(optional) Specific task ID, or omit for overall agent status",
        }, tool_task_status)

    # ── Live Browser Bridge Tools ─────────────────
    async def tool_browser_read_page(args):
        result = await executor.execute({"action": "browser_live_read", "args": {
            "max_chars": args.get("max_chars", 15000),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_read_page", "Read the content of the currently open browser page (live)", {
        "max_chars": "(optional) Max characters to read, default 15000",
    }, tool_browser_read_page)

    async def tool_browser_type(args):
        result = await executor.execute({"action": "browser_live_type", "args": {
            "text": args.get("text", ""),
            "selector": args.get("selector", ""),
            "clear": args.get("clear", False),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_type", "Type text into the browser (current input or by CSS selector)", {
        "text": "The text to type",
        "selector": "(optional) CSS selector of the input element",
        "clear": "(optional) Clear the field first, default false",
    }, tool_browser_type)

    async def tool_browser_click(args):
        a = {}
        if args.get("selector"):
            a["selector"] = args["selector"]
        if args.get("text"):
            a["text"] = args["text"]
        if args.get("x") is not None and args.get("y") is not None:
            a["x"] = args["x"]
            a["y"] = args["y"]
        result = await executor.execute({"action": "browser_live_click", "args": a})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_click", "Click an element in the browser by selector, text, or coordinates", {
        "selector": "(optional) CSS selector",
        "text": "(optional) Visible text of the element to click",
        "x": "(optional) X coordinate",
        "y": "(optional) Y coordinate",
    }, tool_browser_click)

    async def tool_browser_scroll(args):
        result = await executor.execute({"action": "browser_live_scroll", "args": {
            "direction": args.get("direction", "down"),
            "amount": args.get("amount", 500),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_scroll", "Scroll the browser page", {
        "direction": "up, down, top, or bottom",
        "amount": "(optional) Pixels to scroll, default 500",
    }, tool_browser_scroll)

    async def tool_browser_inputs(args):
        result = await executor.execute({"action": "browser_live_inputs", "args": {}})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_inputs", "List all input fields on the current browser page", {}, tool_browser_inputs)

    async def tool_browser_fill(args):
        result = await executor.execute({"action": "browser_live_fill", "args": {
            "fields": args.get("fields", []),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_fill", "Fill a form in the browser with multiple fields at once", {
        "fields": 'List of fields: [{"selector": "...", "value": "..."}, {"name": "...", "value": "..."}]',
    }, tool_browser_fill)

    async def tool_browser_navigate(args):
        result = await executor.execute({"action": "browser_live_navigate", "args": {
            "url": args.get("url", ""),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_navigate", "Navigate the browser to a URL", {
        "url": "The URL to navigate to",
    }, tool_browser_navigate)

    async def tool_browser_tabs(args):
        result = await executor.execute({"action": "browser_live_tabs", "args": {}})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_tabs", "List all open browser tabs", {}, tool_browser_tabs)

    async def tool_browser_selected(args):
        result = await executor.execute({"action": "browser_live_selected", "args": {}})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_selected_text", "Get the currently selected/highlighted text in the browser", {}, tool_browser_selected)

    async def tool_browser_key(args):
        result = await executor.execute({"action": "browser_live_key", "args": {
            "key": args.get("key", ""),
            "modifiers": args.get("modifiers", []),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_key", "Press a key in the browser (Enter, Tab, Escape, etc.)", {
        "key": "Key name (Enter, Tab, Escape, Backspace, a, b, etc.)",
        "modifiers": '(optional) List of modifiers: ["ctrl", "shift", "alt"]',
    }, tool_browser_key)

    async def tool_browser_links(args):
        result = await executor.execute({"action": "browser_live_links", "args": {
            "max": args.get("max", 30),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("browser_links", "Get all links from the current browser page", {
        "max": "(optional) Max links to return, default 30",
    }, tool_browser_links)

    # ── Google Sheets Tools ───────────────────────
    async def tool_sheet_read(args):
        result = await executor.execute({"action": "sheet_read", "args": {
            "sheet_id": args.get("sheet_id", ""),
            "range": args.get("range", ""),
            "sheet_name": args.get("sheet_name", "Sheet1"),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("sheet_read", "Read data from a Google Sheet", {
        "sheet_id": "Spreadsheet ID or URL",
        "range": "(optional) Cell range like A1:D10",
        "sheet_name": "(optional) Sheet tab name, default Sheet1",
    }, tool_sheet_read)

    async def tool_sheet_write(args):
        result = await executor.execute({"action": "sheet_write_cell", "args": {
            "sheet_id": args.get("sheet_id", ""),
            "cell": args.get("cell", ""),
            "value": args.get("value", ""),
            "sheet_name": args.get("sheet_name", "Sheet1"),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("sheet_write", "Write a value to a Google Sheet cell", {
        "sheet_id": "Spreadsheet ID or URL",
        "cell": "Cell reference like A1, B5",
        "value": "Value to write",
        "sheet_name": "(optional) Sheet tab name, default Sheet1",
    }, tool_sheet_write)

    async def tool_sheet_append(args):
        result = await executor.execute({"action": "sheet_append_row", "args": {
            "sheet_id": args.get("sheet_id", ""),
            "values": args.get("values", []),
            "sheet_name": args.get("sheet_name", "Sheet1"),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("sheet_append", "Append a row to the bottom of a Google Sheet", {
        "sheet_id": "Spreadsheet ID or URL",
        "values": "List of values for the row",
        "sheet_name": "(optional) Sheet tab name, default Sheet1",
    }, tool_sheet_append)

    async def tool_doc_insert(args):
        result = await executor.execute({"action": "doc_insert", "args": {
            "doc_id": args.get("doc_id", ""),
            "text": args.get("text", ""),
            "index": args.get("index", 1),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("doc_insert", "Insert text at a position in a Google Doc", {
        "doc_id": "Document ID or URL",
        "text": "Text to insert",
        "index": "Character index to insert at (1 = beginning)",
    }, tool_doc_insert)

    async def tool_doc_replace(args):
        result = await executor.execute({"action": "doc_replace", "args": {
            "doc_id": args.get("doc_id", ""),
            "find": args.get("find", ""),
            "replace": args.get("replace", ""),
        }})
        return result.get("result", result.get("error", "Failed"))

    registry.register("doc_replace", "Find and replace text in a Google Doc", {
        "doc_id": "Document ID or URL",
        "find": "Text to find",
        "replace": "Replacement text",
    }, tool_doc_replace)

    return registry


import asyncio
