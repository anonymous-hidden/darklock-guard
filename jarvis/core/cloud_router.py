"""
Nova — Cloud Router (Hybrid Intelligence)
============================================
Routes complex tasks to a cloud LLM (Claude) when the local model
isn't powerful enough. Simple stuff stays local for speed + privacy.

The router is transparent — Nova doesn't know she's switching brains.
The response just comes back smarter.

Requires: ANTHROPIC_API_KEY in .env (optional — gracefully degrades to local-only)
"""

import os
import re
import logging
import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

# ── Complexity detection ──────────────────────────────────────────────────────

# Patterns that indicate a task needs deeper reasoning
_COMPLEX_PATTERNS = [
    # Code / repo analysis
    re.compile(r'\b(?:review|analyze|analyse|explain|what\s+do\s+you\s+think)\b.*\b(?:code|repo|repository|codebase|project)\b', re.I),
    # Long-form content analysis
    re.compile(r'\b(?:summarize|summarise|analyze|analyse|break\s+down|explain)\b.*\b(?:page|article|document|readme|docs?)\b', re.I),
    # Architectural / design questions
    re.compile(r'\b(?:how\s+(?:should|would|could)|what\s+(?:approach|architecture|design|pattern|strategy))\b', re.I),
    # Debugging complex issues
    re.compile(r'\b(?:why\s+(?:is|does|isn\'t|doesn\'t)|debug|figure\s+out|troubleshoot)\b.*\b(?:error|bug|issue|problem|broken|failing)\b', re.I),
    # Comparisons requiring reasoning
    re.compile(r'\b(?:compare|versus|vs\.?|better|worse|pros?\s+(?:and|&)\s+cons?|trade\s*-?\s*offs?)\b', re.I),
    # Writing / creative tasks
    re.compile(r'\b(?:write|draft|compose|create)\b.*\b(?:email|message|letter|proposal|plan|doc(?:ument)?)\b', re.I),
    # Multi-step reasoning
    re.compile(r'\b(?:step\s+by\s+step|walk\s+me\s+through|how\s+do\s+I|tutorial|guide\s+me)\b', re.I),
]

# Patterns that should ALWAYS stay local (fast, simple, or privacy-sensitive)
_LOCAL_ONLY_PATTERNS = [
    re.compile(r'^\s*(?:hey|hi|hello|good\s+morning|what\'s\s+up)', re.I),
    re.compile(r'\b(?:turn|set|change)\b.*\b(?:light|lamp|brightness|color)\b', re.I),
    re.compile(r'\b(?:open|launch|start)\b.*\b(?:youtube|browser|terminal|app)\b', re.I),
    re.compile(r'\b(?:timer|alarm|reminder|volume|mute)\b', re.I),
    re.compile(r'\b(?:what\s+time|what\s+day|weather)\b', re.I),
    re.compile(r'\b(?:play|pause|skip|next|previous)\b', re.I),
]


def is_complex_task(message: str) -> bool:
    """Determine if a message needs cloud-level reasoning."""
    # Short messages are almost never complex
    if len(message) < 20:
        return False
    # Check local-only patterns first (override complex detection)
    for pat in _LOCAL_ONLY_PATTERNS:
        if pat.search(message):
            return False
    # Check complexity patterns
    for pat in _COMPLEX_PATTERNS:
        if pat.search(message):
            return True
    # Messages with large context attached (e.g. pasted code, URLs) are complex
    if len(message) > 500:
        return True
    return False


def has_context_data(message: str) -> bool:
    """Check if the message includes substantial data (code, URLs, pasted content)."""
    # System-injected context blocks
    if "[SYSTEM:" in message or "## README" in message or "```" in message:
        return True
    if len(message) > 800:
        return True
    return False


class CloudRouter:
    """
    Hybrid routing: local Ollama for speed, Claude for brains.
    Falls back gracefully to local-only if no API key is set.
    """

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self._available = bool(self._api_key)
        self._model = "claude-sonnet-4-20250514"
        if self._available:
            logger.info("[CloudRouter] Claude hybrid routing enabled")
        else:
            logger.info("[CloudRouter] No ANTHROPIC_API_KEY — local-only mode")

    @property
    def available(self) -> bool:
        return self._available

    def should_route_to_cloud(self, user_message: str) -> bool:
        """Decide if this message should go to Claude instead of Ollama."""
        if not self._available:
            return False
        return is_complex_task(user_message) or has_context_data(user_message)

    @property
    def model_name(self) -> str:
        return self._model

    async def send_message(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> str:
        """Send a message to Claude and return the response."""
        anthropic_messages = self._to_anthropic_messages(messages)

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    ANTHROPIC_API_URL,
                    headers=self._headers(),
                    json={
                        "model": self._model,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        "system": system_prompt,
                        "messages": anthropic_messages,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            # Extract text from response
            content = data.get("content", [])
            text_parts = [block["text"] for block in content if block.get("type") == "text"]
            return "\n".join(text_parts) if text_parts else "I couldn't generate a response."

        except httpx.HTTPStatusError as e:
            logger.warning(f"[CloudRouter] Claude API error: {e.response.status_code}")
            return ""  # Empty string signals fallback to local
        except Exception as e:
            logger.warning(f"[CloudRouter] Error: {e}")
            return ""  # Fallback to local

    async def stream_message(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ):
        """Stream tokens from Claude for real-time WebSocket delivery."""
        anthropic_messages = self._to_anthropic_messages(messages)

        try:
            async with httpx.AsyncClient(timeout=180) as client:
                async with client.stream(
                    "POST",
                    ANTHROPIC_API_URL,
                    headers={**self._headers(), "accept": "text/event-stream"},
                    json={
                        "model": self._model,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        "system": system_prompt,
                        "messages": anthropic_messages,
                        "stream": True,
                    },
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:]
                        if payload.strip() == "[DONE]":
                            break
                        try:
                            import json
                            event = json.loads(payload)
                            etype = event.get("type", "")
                            if etype == "content_block_delta":
                                delta = event.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    yield delta["text"]
                            elif etype == "message_stop":
                                break
                        except Exception:
                            continue
        except httpx.HTTPStatusError as e:
            logger.warning(f"[CloudRouter] Claude stream error: {e.response.status_code}")
            yield ""
        except Exception as e:
            logger.warning(f"[CloudRouter] Stream error: {e}")
            yield ""

    def _headers(self) -> dict:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    @staticmethod
    def _to_anthropic_messages(messages: list[dict]) -> list[dict]:
        return [
            {"role": msg["role"], "content": msg["content"]}
            for msg in messages
            if msg["role"] in ("user", "assistant")
        ]
