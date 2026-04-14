"""
Home AI Assistant - Orchestrator
=================================
Central coordinator that ties all modules together.
Handles the full message lifecycle:
  1. Receive user input
  2. Send to AI
  3. Parse commands from AI response
  4. Check permissions
  5. Execute approved commands
  6. Return results

This is the ONLY module that connects AI output to execution.
All safety checks happen here.
"""

import asyncio
from typing import Any, Optional

from ai_interface import AIInterface
from command_parser import CommandParser, ParsedCommand
from executor import CommandExecutor
from learning import LearningEngine
from logger import HomeAILogger
from permissions import PermissionManager
from ssh_module import SSHModule


class Orchestrator:
    """
    Central coordinator — the single gateway between AI and execution.
    """

    def __init__(
        self,
        config: dict,
        logger: HomeAILogger,
        ai: AIInterface,
        parser: CommandParser,
        permissions: PermissionManager,
        executor: CommandExecutor,
        ssh: SSHModule,
        learning: Optional[LearningEngine] = None,
    ):
        self._config = config
        self._logger = logger
        self._ai = ai
        self._parser = parser
        self._permissions = permissions
        self._executor = executor
        self._ssh = ssh
        self._learning = learning

        self._logger.info("orchestrator", "Orchestrator initialized", {
            "learning_enabled": learning is not None,
        })

    async def process_message(self, message: str, source: str = "text") -> dict:
        """
        Full message lifecycle:
        1. Inject learned context  →  2. Send to AI  →  3. Parse commands
        4. Check permissions  →  5. Execute  →  6. Learn from interaction
        7. Return results
        """
        self._logger.log_user_input(message, source)

        # Step 1: Inject learned context into the AI's prompt
        if self._learning:
            context = self._learning.build_context()
            self._ai.update_learned_context(context)

        # Step 2: Get AI response
        ai_response = await self._ai.send_message(message)

        # Step 3: Parse commands from AI response
        commands = self._parser.parse(ai_response)

        execution_results = []
        if commands:
            # Step 4 & 5: Permission check + execution for each command
            for cmd in commands:
                result = await self._process_command(cmd)
                execution_results.append(result)

        # Step 6: Feed interaction to learning engine
        if self._learning:
            self._learning.observe_interaction(
                user_message=message,
                ai_response=ai_response,
                commands=[
                    {"name": c.name, "risk": c.risk.value, "approved": c.approved}
                    for c in commands
                ],
                results=execution_results,
            )

        return {
            "reply": ai_response,
            "commands": [
                {"name": c.name, "risk": c.risk.value, "approved": c.approved}
                for c in commands
            ],
            "execution_results": execution_results,
        }

    async def _process_command(self, command: ParsedCommand) -> dict:
        """Permission check → execute a single command."""
        # Step 3: Permission check
        approved = await self._permissions.check_permission(command)

        if not approved:
            return {
                "command": command.name,
                "approved": False,
                "result": None,
                "error": "Permission denied",
            }

        # Step 4: Execute
        if command.name == "ssh_command":
            result = await self._ssh.execute(command)
        else:
            result = await self._executor.execute(command)

        return {
            "command": command.name,
            "approved": True,
            "result": result.get("result"),
            "error": result.get("error"),
            "success": result.get("success", False),
        }

    async def execute_direct_command(self, command_name: str,
                                     params: dict) -> dict:
        """
        Execute a command directly (from API), still through full validation.
        Constructs a synthetic AI-like JSON and runs through the parser.
        """
        import json
        synthetic = json.dumps({
            "command": command_name,
            "params": params,
            "reasoning": "Direct API request",
        })

        commands = self._parser.parse(f"```json\n{synthetic}\n```")
        if not commands:
            return {
                "success": False,
                "error": f"Command '{command_name}' failed validation",
                "result": None,
            }

        cmd = commands[0]
        result = await self._process_command(cmd)
        return result

    def list_commands(self) -> list[dict]:
        """Return available commands."""
        return self._parser.list_commands()

    def clear_history(self):
        """Clear AI conversation history."""
        # Save session summary before clearing
        if self._learning:
            self._learning.save_session_summary()
        self._ai.clear_history()

    def get_history_length(self) -> int:
        return self._ai.get_history_length()

    # ── Learning / Feedback ─────────────────────────────────

    def record_feedback(self, message_id: str, rating: int,
                        user_message: str, ai_response: str,
                        correction: str = ""):
        """Record user feedback on an AI response."""
        if self._learning:
            self._learning.record_feedback(
                message_id, rating, user_message, ai_response, correction
            )

    def learn_fact(self, key: str, value: str, category: str = "fact"):
        """User explicitly teaches the AI a fact."""
        if self._learning:
            self._learning.learn_fact(key, value, category)

    def get_learning_stats(self) -> dict:
        """Get learning system statistics."""
        if self._learning:
            return self._learning.get_stats()
        return {"enabled": False}

    def get_learned_memories(self, category: Optional[str] = None) -> list[dict]:
        """Get all learned memories for owner review."""
        if self._learning:
            return self._learning._db.get_memories(category)
        return []

    def delete_memory(self, memory_id: int):
        """Owner deletes a specific memory."""
        if self._learning:
            self._learning._db.delete_memory(memory_id)
            self._logger.info("orchestrator", "Memory deleted by owner", {
                "memory_id": memory_id,
            })

    def wipe_learning(self):
        """Owner wipes all learning data."""
        if self._learning:
            self._learning.wipe()

    def pause_learning(self):
        if self._learning:
            self._learning.pause()

    def resume_learning(self):
        if self._learning:
            self._learning.resume()

    def export_learning(self) -> dict:
        """Export all learning data for owner review."""
        if self._learning:
            return self._learning._db.export_all()
        return {}
        self._ai.clear_history()

    def get_history_length(self) -> int:
        return self._ai.get_history_length()
