"""
Nova — AI Engine
==================
Async Ollama client with streaming support, command extraction,
dual-model routing (fast 8B + deep 32B), and hybrid cloud routing.
"""

import json
import re
import logging
from typing import AsyncGenerator

import httpx

from config import JarvisConfig
from core.prompt_builder import PromptBuilder
from logs.audit import AuditLogger
from core.cloud_router import CloudRouter

logger = logging.getLogger(__name__)

_DEEP_KEYWORDS = re.compile(
    r'\b(?:explain|analyze|analy[sz]e|compare|debug|refactor|write\s+(?:a\s+)?(?:function|class|script|code|program|essay|story|report)'
    r'|implement|architect|design|plan|review|summarize\s+(?:this|the)\s+\w+|step[\s-]by[\s-]step'
    r'|why\s+(?:does|is|do|are|did|would|should)|how\s+(?:does|do|would|should|can)'
    r'|create\s+(?:a|an)\s+\w+|build|optimize|complex|detailed|thorough|in[\s-]depth'
    r'|what\s+(?:are\s+the\s+(?:differences?|pros?\s+and\s+cons?|advantages?))'
    r'|translate|convert|migrate|rewrite|help\s+me\s+(?:understand|figure\s+out|think))\b', re.I)

_SIMPLE_PATTERNS = re.compile(
    r'^(?:hi|hey|hello|yo|sup|thanks|thank\s+you|ok|okay|yep|yeah|nah|no|yes|sure|cool|nice'
    r'|good\s+(?:morning|afternoon|evening|night)|gm|gn|bye|later|brb'
    r'|what\s+time|what\s+day|set\s+(?:a\s+)?(?:timer|alarm|reminder)'
    r'|turn\s+(?:on|off)|lights?\s+(?:on|off)|play|pause|stop|skip|next|volume'
    r'|weather|temperature|forecast'
    r'|what\'?s?\s+(?:up|good|new)'
    r'|how\s+are\s+you|how\'?s?\s+it\s+going'
    r'|tell\s+me\s+(?:a\s+)?joke|random\s+fact)(?:\s*[?!.]?\s*)?$', re.I)
_CONFIRMATION_PATTERN = re.compile(
    r'^(?:yes|yeah|yep|yup|sure|ok|okay|do\s+it|go\s+ahead|go\s+for\s+it|absolutely|definitely|please|sounds\s+good|alright)'
    r'(?:\s*[!.,]?)*$', re.I
)

_HISTORY_BROWSER_KEYWORDS = (
    'browser', 'page', 'tab', 'website', 'url', 'navigate', 'read', 'click',
    'type', 'scroll', 'open', 'go to', 'search', 'google', 'youtube',
)
_HISTORY_TERMINAL_KEYWORDS = ('terminal', 'command', 'run', 'shell', 'bash', 'sudo', 'npm', 'pip')
_HISTORY_SMARTHOME_KEYWORDS = ('lights', 'govee', 'brightness', 'color', 'lamp', 'hue')

def classify_complexity(text: str) -> str:
    """Return 'fast' for simple queries, 'deep' for complex ones."""
    text = text.strip()
    if len(text) < 12 and not _DEEP_KEYWORDS.search(text):
        return "fast"
    if _SIMPLE_PATTERNS.match(text):
        return "fast"
    if _DEEP_KEYWORDS.search(text):
        return "deep"
    # Medium-length general chat → fast is fine
    if len(text) < 80:
        return "fast"
    return "deep"


class AIEngine:
    """Dual-model AI engine with fast (8B) and deep (32B) routing."""

    def __init__(self, config: JarvisConfig, prompt_builder: PromptBuilder, audit: AuditLogger):
        self._config = config
        self._prompt = prompt_builder
        self._audit = audit

        # Primary (deep) model
        self._model_deep = config.ai_model
        self._model_fast = config.ai_model_fast or config.ai_model
        self._auto_route = config.ai_auto_route

        self._base_url = config.ollama_url
        self._temperature = config.ai_temperature
        self._max_tokens = config.ai_max_tokens
        self._num_ctx = config.get("ai.num_ctx", 4096) or 4096
        self._num_gpu = config.get("ai.num_gpu", None)
        # Per-conversation history: keyed by conv_id (int) or None for background calls
        self._conversations: dict[int | None, list[dict]] = {}
        self._hydrated: set = set()  # conv_ids already loaded from DB
        self._max_history: int = config.get("ai.max_history", 50) or 50

        # Per-model options
        self._options_deep = config.get_model_options("deep")
        self._options_fast = config.get_model_options("fast")

        # Track which model last responded
        self._last_model: str = self._model_deep
        # Manual override (None = auto, "fast", "deep")
        self._forced_mode: str | None = None

        # Hybrid cloud router
        self._cloud = CloudRouter()

    @property
    def active_models(self) -> dict:
        """Return info about available models."""
        return {
            "deep": self._model_deep,
            "fast": self._model_fast,
            "claude": self._cloud.model_name if self._cloud.available else None,
            "claude_available": self._cloud.available,
            "auto_route": self._auto_route,
            "forced_mode": self._forced_mode,
            "last_used": self._last_model,
        }

    # ── Per-conversation history helpers ──────────────

    def _get_conv(self, conv_id: int | None) -> list[dict]:
        if conv_id not in self._conversations:
            self._conversations[conv_id] = []
        return self._conversations[conv_id]

    def _append_conv(self, conv_id: int | None, role: str, content: str):
        conv = self._get_conv(conv_id)
        conv.append({"role": role, "content": content})
        if len(conv) > self._max_history:
            # Keep the most recent messages; never silently drop context without a note
            self._conversations[conv_id] = conv[-self._max_history:]

    def is_hydrated(self, conv_id: int | None) -> bool:
        """True if this conversation's history has been loaded from the DB."""
        return conv_id in self._hydrated

    def hydrate(self, conv_id: int, messages: list[dict]):
        """
        Load stored conversation history into in-memory context.
        Called when the user resumes a conversation (sidebar click or server restart).
        Only runs once per conv_id per process lifetime.
        """
        if conv_id in self._hydrated:
            return
        self._hydrated.add(conv_id)
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m["role"] in ("user", "assistant")
        ]
        # Load the most recent max_history turns
        self._conversations[conv_id] = history[-self._max_history:]
        self._audit.log("ai", "history_hydrated", {
            "conv_id": conv_id, "messages_loaded": len(history),
        })

    def set_mode(self, mode: str | None):
        """Force a specific model mode, or None for auto."""
        if mode in ("fast", "deep", "claude", None):
            self._forced_mode = mode
            self._audit.log("ai", "mode_changed", {"mode": mode or "auto"})

    def _pick_model(self, user_message: str) -> tuple[str, dict]:
        """Select model and options based on message complexity."""
        if self._forced_mode == "fast":
            return self._model_fast, self._options_fast
        if self._forced_mode in ("deep", "claude"):
            return self._model_deep, self._options_deep
        if not self._auto_route or not self._model_fast:
            return self._model_deep, self._options_deep

        complexity = classify_complexity(user_message)
        if complexity == "fast":
            return self._model_fast, self._options_fast
        return self._model_deep, self._options_deep

    def _resolve_intent_message(self, user_message: str, conv_id: int | None) -> str:
        """If the user sent a short confirmation, look at recent history to infer
        what domain was active and inject context keywords so intent detection fires."""
        stripped = user_message.strip()
        if not _CONFIRMATION_PATTERN.match(stripped):
            return user_message

        history = self._get_conv(conv_id)
        # Inspect last 6 messages (3 turns)
        recent_text = " ".join(m["content"] for m in history[-6:]).lower()

        if any(kw in recent_text for kw in _HISTORY_BROWSER_KEYWORDS):
            return f"{user_message} [open browser page]"
        if any(kw in recent_text for kw in _HISTORY_TERMINAL_KEYWORDS):
            return f"{user_message} [run terminal command]"
        if any(kw in recent_text for kw in _HISTORY_SMARTHOME_KEYWORDS):
            return f"{user_message} [control lights]"
        return user_message

    # ── Complete response ──────────────────────────────

    async def send_message(self, user_message: str, context: dict | None = None,
                           force_mode: str | None = None,
                           conv_id: int | None = None) -> str:
        """Send a message and get a complete (non-streamed) response."""
        self._audit.log("ai", "user_input", {"message": user_message})

        self._append_conv(conv_id, "user", user_message)

        intent_message = self._resolve_intent_message(user_message, conv_id)
        system_prompt = self._prompt.build(context, user_message=intent_message)
        messages = list(self._get_conv(conv_id))

        # Claude mode: always route to cloud
        if self._forced_mode == "claude" and self._cloud.available:
            system_prompt = system_prompt.replace(
                "Local Ollama — no cloud, no API keys, no data harvesting.",
                f"You are running as Claude ({self._cloud.model_name}) via the Anthropic API, selected manually by {self._prompt._personality._owner}."
            )
            self._audit.log("ai", "cloud_route", {"reason": "claude_mode"})
            cloud_response = await self._cloud.send_message(
                system_prompt=system_prompt,
                messages=messages,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
            )
            if cloud_response:
                self._last_model = self._cloud.model_name
                self._append_conv(conv_id, "assistant", cloud_response)
                self._audit.log("ai", "response", {
                    "model": self._cloud.model_name, "length": len(cloud_response), "routed": True,
                })
                return cloud_response
            self._audit.log("ai", "cloud_fallback", {"reason": "cloud_error"})

        # Try cloud routing for complex tasks (auto mode only)
        if self._forced_mode != "claude" and self._cloud.should_route_to_cloud(user_message):
            self._audit.log("ai", "cloud_route", {"reason": "complex_task"})
            cloud_response = await self._cloud.send_message(
                system_prompt=system_prompt,
                messages=messages,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
            )
            if cloud_response:
                self._append_conv(conv_id, "assistant", cloud_response)
                self._audit.log("ai", "response", {
                    "model": "claude", "length": len(cloud_response), "routed": True,
                })
                return cloud_response
            self._audit.log("ai", "cloud_fallback", {"reason": "cloud_error"})

        # Pick model (dual routing)
        old_forced = self._forced_mode
        if force_mode:
            self._forced_mode = force_mode
        model, options = self._pick_model(user_message)
        if force_mode:
            self._forced_mode = old_forced

        self._last_model = model

        all_messages = [{"role": "system", "content": system_prompt}] + messages
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                resp = await client.post(
                    f"{self._base_url}/api/chat",
                    json={
                        "model": model,
                        "messages": all_messages,
                        "stream": False,
                        "options": options,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            ai_text: str = data["message"]["content"]
            self._append_conv(conv_id, "assistant", ai_text)
            self._audit.log("ai", "response", {"model": model, "length": len(ai_text)})
            return ai_text

        except httpx.HTTPStatusError as e:
            self._audit.log("ai", "error", {"error": str(e)})
            return f"Sorry Cayden, communication error with the language model: {e}"
        except Exception as e:
            self._audit.log("ai", "error", {"error": str(e)})
            return "Sorry Cayden, an unexpected error occurred. Details have been logged."

    # ── Streaming response (for WebSocket) ─────────────

    async def stream_message(self, user_message: str, context: dict | None = None,
                             force_mode: str | None = None,
                             conv_id: int | None = None) -> AsyncGenerator[str, None]:
        """Stream tokens one at a time. Used by the WebSocket endpoint."""
        self._audit.log("ai", "user_input", {"message": user_message, "streaming": True})

        self._append_conv(conv_id, "user", user_message)

        intent_message = self._resolve_intent_message(user_message, conv_id)
        system_prompt = self._prompt.build(context, user_message=intent_message)
        messages = [{"role": "system", "content": system_prompt}] + list(self._get_conv(conv_id))

        # Claude mode: stream from Claude API
        if self._forced_mode == "claude" and self._cloud.available:
            system_prompt = system_prompt.replace(
                "Local Ollama — no cloud, no API keys, no data harvesting.",
                f"You are running as Claude ({self._cloud.model_name}) via the Anthropic API, selected manually by {self._prompt._personality._owner}."
            )
            self._last_model = self._cloud.model_name
            full_response = ""
            try:
                async for token in self._cloud.stream_message(
                    system_prompt=system_prompt,
                    messages=list(self._get_conv(conv_id)),
                    max_tokens=self._max_tokens,
                    temperature=self._temperature,
                ):
                    full_response += token
                    yield token
                self._append_conv(conv_id, "assistant", full_response)
                self._audit.log("ai", "response", {
                    "model": self._cloud.model_name, "length": len(full_response), "streaming": True, "routed": True,
                })
            except Exception as e:
                self._audit.log("ai", "error", {"error": str(e), "model": "claude"})
                yield f"\n\n[Claude error: {e}]"
            return

        # Pick model (dual routing)
        old_forced = self._forced_mode
        if force_mode:
            self._forced_mode = force_mode
        model, options = self._pick_model(user_message)
        if force_mode:
            self._forced_mode = old_forced

        self._last_model = model

        full_response = ""
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/api/chat",
                    json={
                        "model": model,
                        "messages": messages,
                        "stream": True,
                        "options": options,
                    },
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if "message" in chunk and "content" in chunk["message"]:
                            token = chunk["message"]["content"]
                            full_response += token
                            yield token
                        if chunk.get("done"):
                            break

            self._append_conv(conv_id, "assistant", full_response)
            self._audit.log("ai", "response", {
                "model": model, "length": len(full_response), "streaming": True,
            })

        except Exception as e:
            self._audit.log("ai", "error", {"error": str(e)})
            err = str(e)
            if "All connection attempts failed" in err or "Connection refused" in err or "ConnectError" in err:
                yield "Sorry, I can't reach my brain right now — Ollama isn't running. Ask Cayden to start it with `ollama serve`."
            else:
                yield f"\n\n[Error: {e}]"

    # ── Command extraction ─────────────────────────────

    def extract_commands(self, text: str) -> list[dict]:
        """Extract JSON command blocks from AI response text."""
        commands = []

        # Try fenced ```json blocks first
        for match in re.finditer(r'```json\s*(\{[\s\S]*?\})\s*```', text):
            try:
                cmd = json.loads(match.group(1))
                if "type" in cmd and "action" in cmd:
                    commands.append(self._normalize_cmd(cmd))
            except json.JSONDecodeError:
                continue

        # Also try bare JSON objects (LLM sometimes omits fences)
        if not commands:
            for match in re.finditer(r'(\{\s*"type"\s*:\s*"command"[\s\S]*?\})', text):
                try:
                    cmd = json.loads(match.group(1))
                    if "type" in cmd and "action" in cmd:
                        commands.append(self._normalize_cmd(cmd))
                except json.JSONDecodeError:
                    continue

        return commands

    @staticmethod
    def _normalize_cmd(cmd: dict) -> dict:
        """Fix common LLM output quirks in command args."""
        args = cmd.get("args", {})
        # LLM outputs "devices" (array) but handler expects "device" (string)
        if "devices" in args and "device" not in args:
            devs = args.pop("devices")
            if isinstance(devs, list) and devs:
                args["device"] = devs[0]  # Use first device name
            elif isinstance(devs, str):
                args["device"] = devs
        cmd["args"] = args
        return cmd

    # ── History management ─────────────────────────────

    def clear_history(self, conv_id: int | None = None):
        if conv_id is not None:
            self._conversations.pop(conv_id, None)
            self._hydrated.discard(conv_id)
        else:
            self._conversations.clear()
            self._hydrated.clear()
        self._audit.log("ai", "history_cleared", {"conv_id": conv_id})

    @property
    def history_length(self) -> int:
        return sum(len(v) for v in self._conversations.values())
