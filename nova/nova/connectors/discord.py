"""Discord connector — outbound webhook + optional bot-token message post."""
from __future__ import annotations
import os
import httpx
from .base import BaseConnector, ConnectorAction


class DiscordConnector(BaseConnector):
    name = "discord"
    description = "Post messages via webhook or bot token."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.webhook = os.environ.get(self.cfg.get("webhook_env", "DISCORD_WEBHOOK_URL"), "")
        self.token = os.environ.get(self.cfg.get("token_env", "DISCORD_BOT_TOKEN"), "")

    def is_configured(self) -> bool:
        return bool(self.webhook or self.token)

    def _register_actions(self) -> None:
        self.register(ConnectorAction("post_webhook", "Post to configured webhook", "write",
                                      requires_approval=True, handler=self._post_webhook))
        self.register(ConnectorAction("post_channel", "Post to a channel via bot token",
                                      "write", requires_approval=True,
                                      handler=self._post_channel))

    def _post_webhook(self, *, content: str, username: str = "NOVA") -> dict:
        if not self.webhook:
            return {"ok": False, "error": "no webhook configured"}
        try:
            r = httpx.post(self.webhook, json={"content": content, "username": username},
                           timeout=10)
            return {"ok": r.status_code in (200, 204), "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _post_channel(self, *, channel_id: str, content: str) -> dict:
        if not self.token:
            return {"ok": False, "error": "no bot token configured"}
        try:
            r = httpx.post(f"https://discord.com/api/v10/channels/{channel_id}/messages",
                           json={"content": content},
                           headers={"Authorization": f"Bot {self.token}"}, timeout=10)
            return {"ok": r.status_code in (200, 201), "status": r.status_code,
                    "body": r.text[:400] if r.status_code >= 300 else ""}
        except Exception as e:
            return {"ok": False, "error": str(e)}
