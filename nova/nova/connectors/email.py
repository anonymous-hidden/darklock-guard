"""Email connector — SMTP send + draft composition (no IMAP in v1)."""
from __future__ import annotations
import os
import smtplib
from email.message import EmailMessage
from .base import BaseConnector, ConnectorAction, ConnectorResult


class EmailConnector(BaseConnector):
    name = "email"
    description = "Compose drafts locally and send via SMTP."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        env = lambda k, d="": os.environ.get(self.cfg.get(k, ""), d)
        self.host = env("smtp_host_env")
        self.port = int(env("smtp_port_env", "587") or 587)
        self.user = env("smtp_user_env")
        self.password = env("smtp_pass_env")
        self.from_addr = env("from_env") or self.user

    def is_configured(self) -> bool:
        return all([self.host, self.user, self.password, self.from_addr])

    def _register_actions(self) -> None:
        self.register(ConnectorAction("draft", "Compose an email draft (no send)", "read",
                                      handler=self._draft))
        self.register(ConnectorAction("send", "Send an email via SMTP", "write",
                                      requires_approval=True, handler=self._send))

    def _draft(self, *, to: str, subject: str, body: str, cc: str = "") -> dict:
        return {"ok": True, "draft": {"from": self.from_addr or "(unset)",
                                      "to": to, "cc": cc, "subject": subject, "body": body}}

    def _send(self, *, to: str, subject: str, body: str, cc: str = "") -> dict:
        if not self.is_configured():
            return {"ok": False, "error": "SMTP not configured"}
        msg = EmailMessage()
        msg["From"] = self.from_addr
        msg["To"] = to
        if cc:
            msg["Cc"] = cc
        msg["Subject"] = subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=20) as s:
                s.starttls()
                s.login(self.user, self.password)
                s.send_message(msg)
            return {"ok": True, "to": to, "subject": subject}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    def health(self) -> ConnectorResult:
        return ConnectorResult(self.enabled and self.is_configured(),
                               data={"host": self.host or None})
