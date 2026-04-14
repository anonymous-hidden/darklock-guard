"""
Home AI Assistant - AI Interface
=================================
Communicates with a local Ollama (Llama) server to generate responses.
The AI is instructed to output structured JSON commands
that are then validated by the command parser.

SAFETY: This module only sends/receives text. It NEVER
executes commands, opens connections, or calls other APIs.
"""

import httpx

from logger import HomeAILogger

_OLLAMA_BASE = "http://127.0.0.1:11434"


class AIInterface:
    """Handles communication with the local Ollama (Llama) server."""

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("ai", {})
        self._logger = logger

        self._model = self._config.get("model", "llama3.2:3b")
        self._max_tokens = self._config.get("max_tokens", 4096)
        self._temperature = self._config.get("temperature", 0.7)

        # System prompt instructs the AI to output structured commands
        self._base_system_prompt = self._config.get("system_prompt", "") + self._command_instructions()
        self._system_prompt = self._base_system_prompt

        # Learned context injected by the learning engine
        self._learned_context: str = ""

        # Conversation history for context
        self._conversation: list[dict] = []
        self._max_history = 50  # Keep last N messages

        # Verify Ollama is reachable
        try:
            r = httpx.get(f"{_OLLAMA_BASE}/api/tags", timeout=5)
            r.raise_for_status()
        except Exception as e:
            self._logger.warning("ai_interface",
                f"Ollama server not reachable at startup: {e}. "
                "Make sure 'ollama serve' is running.")

        self._logger.info("ai_interface", "AI interface initialized", {
            "model": self._model,
            "backend": "ollama",
        })

    def _command_instructions(self) -> str:
        """Additional instructions appended to the system prompt."""
        return """

When the user asks you to perform an action (not just answer a question),
respond with BOTH a natural language explanation AND a JSON command block.

Format commands as:
```json
{
  "command": "command_name",
  "params": {"key": "value"},
  "reasoning": "Why this command is appropriate"
}
```

Available commands:
- get_system_status: Get CPU, memory, disk usage. Params: none
- get_time: Get current date/time. Params: none
- list_files: List files. Params: {"path": "/some/path"}
- read_file: Read a file. Params: {"path": "/some/path"}
- run_script: Run a pre-approved script. Params: {"script_name": "name"}
- ssh_command: Run command on remote host. Params: {"host": "name", "command": "cmd"}
- restart_service: Restart a service. Params: {"service": "name"}
- send_notification: Send a notification. Params: {"message": "text"}
- smart_home_control: Control devices. Params: {"device": "name", "action": "on/off"}

For normal conversation (greetings, questions, explanations), just respond naturally
without any command JSON.

IMPORTANT: You must NEVER suggest commands outside this list.
You must NEVER try to execute anything yourself.
Always let the backend handle execution.
"""

    def update_learned_context(self, context: str):
        """
        Update the learned context that gets injected into the system prompt.
        Called by the learning engine before each message.
        The AI cannot call this — only the orchestrator/learning engine can.
        """
        self._learned_context = context
        self._system_prompt = self._base_system_prompt + context
        self._logger.info("ai_interface", "Learned context updated", {
            "context_length": len(context),
        })

    async def send_message(self, user_message: str) -> str:
        """
        Send a user message to Claude and get a response.
        Returns the AI's text response (which may contain JSON commands).
        """
        self._logger.log_user_input(user_message, "text")

        # Add user message to conversation history
        self._conversation.append({
            "role": "user",
            "content": user_message,
        })

        # Trim history if too long
        if len(self._conversation) > self._max_history:
            self._conversation = self._conversation[-self._max_history:]

        # Build messages list with system prompt prepended as a system message
        messages = [{"role": "system", "content": self._system_prompt}] + self._conversation

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    f"{_OLLAMA_BASE}/api/chat",
                    json={
                        "model": self._model,
                        "messages": messages,
                        "stream": False,
                        "options": {
                            "temperature": self._temperature,
                            "num_predict": self._max_tokens,
                        },
                    },
                )
                response.raise_for_status()
                data = response.json()

            ai_text: str = data["message"]["content"]

            # Add AI response to conversation history
            self._conversation.append({
                "role": "assistant",
                "content": ai_text,
            })

            self._logger.log_ai_response(ai_text, self._model)
            return ai_text

        except httpx.HTTPStatusError as e:
            self._logger.error("ai_interface", f"Ollama HTTP error: {e}")
            return f"I'm sorry, I encountered an error talking to the Llama server: {e}"
        except Exception as e:
            self._logger.error("ai_interface", f"Unexpected AI error: {e}")
            return "I'm sorry, an unexpected error occurred while processing your request."

    def clear_history(self):
        """Clear conversation history."""
        self._conversation.clear()
        self._logger.info("ai_interface", "Conversation history cleared")

    def get_history_length(self) -> int:
        return len(self._conversation)
