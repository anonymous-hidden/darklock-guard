"""
Nova — Vision Engine
======================
Local image understanding via Ollama vision models (LLaVA).
Accepts raw image bytes, sends to the vision model, returns a
natural-language description that gets injected into the main
model's context.

No cloud APIs — everything runs on local hardware.
"""

import base64
import logging

import httpx

from config import JarvisConfig

logger = logging.getLogger(__name__)


class VisionEngine:
    """Sends images to a local Ollama vision model and returns descriptions."""

    def __init__(self, config: JarvisConfig):
        self._base_url = config.ollama_url
        self._model = config.get("vision.model", "llava:13b") or "llava:13b"
        self._enabled = config.get("vision.enabled", True)
        self._max_tokens = config.get("vision.max_tokens", 1024) or 1024

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def model(self) -> str:
        return self._model

    async def describe_image(self, image_bytes: bytes, user_prompt: str = "") -> str:
        """Send an image to the vision model and get a text description.

        Args:
            image_bytes: Raw image file bytes (JPEG, PNG, etc.)
            user_prompt: Optional user question about the image.

        Returns:
            Natural language description of the image.
        """
        if not self._enabled:
            return ""

        b64 = base64.b64encode(image_bytes).decode("ascii")

        prompt = user_prompt.strip() if user_prompt.strip() else (
            "Describe this image in detail. What do you see? "
            "Include objects, text, colors, people, and any notable details."
        )

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{self._base_url}/api/generate",
                    json={
                        "model": self._model,
                        "prompt": prompt,
                        "images": [b64],
                        "stream": False,
                        "options": {
                            "num_predict": self._max_tokens,
                        },
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            return data.get("response", "").strip()

        except httpx.HTTPStatusError as e:
            logger.error(f"Vision model HTTP error: {e}")
            return f"[Vision error: could not analyze image — {e.response.status_code}]"
        except Exception as e:
            logger.error(f"Vision model error: {e}")
            return "[Vision error: could not analyze image]"
