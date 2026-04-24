"""Connector registry + factory that assembles all built-in connectors."""
from __future__ import annotations
from .base import BaseConnector, ConnectorResult


class ConnectorRegistry:
    def __init__(self, logger=None):
        self._conn: dict[str, BaseConnector] = {}
        self.logger = logger

    def register(self, c: BaseConnector) -> None:
        self._conn[c.name] = c

    def get(self, name: str) -> BaseConnector | None:
        return self._conn.get(name)

    def names(self) -> list[str]:
        return list(self._conn.keys())

    def enabled_names(self) -> list[str]:
        return [n for n, c in self._conn.items() if c.enabled]

    def capabilities(self) -> list[dict]:
        return [c.capabilities() for c in self._conn.values()]

    def health_check_all(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for name, c in self._conn.items():
            r = c.health()
            out[name] = {"ok": r.ok, "error": r.error, "data": r.data}
        return out

    def invoke(self, name: str, action: str, /, **params) -> ConnectorResult:
        c = self.get(name)
        if not c:
            return ConnectorResult(False, error=f"unknown connector '{name}'")
        return c.invoke(action, **params)


def build_connectors(cfg, *, fs_policy, executor, logger=None) -> ConnectorRegistry:
    """Instantiate all built-in connectors from the connectors.yaml config."""
    from .local_files import LocalFilesConnector
    from .shell import ShellConnector
    from .web_search import WebSearchConnector
    from .github import GitHubConnector
    from .email import EmailConnector
    from .calendar import CalendarConnector
    from .notes import NotesConnector
    from .weather import WeatherConnector
    from .discord import DiscordConnector
    from .generic_rest_api import GenericRestConnector
    from .contacts import ContactsConnector
    from .task_manager import TaskManagerConnector
    from .cloud_storage import CloudStorageConnector
    from .server_monitor import ServerMonitorConnector

    reg = ConnectorRegistry(logger=logger)
    g = lambda k: (cfg.get(f"connectors.{k}", {}) or {})
    reg.register(LocalFilesConnector(g("local_files"), logger=logger, fs_policy=fs_policy))
    reg.register(ShellConnector(g("shell"), logger=logger, executor=executor))
    reg.register(WebSearchConnector(g("web_search"), logger=logger))
    reg.register(GitHubConnector(g("github"), logger=logger))
    reg.register(EmailConnector(g("email"), logger=logger))
    reg.register(CalendarConnector(g("calendar"), logger=logger))
    reg.register(NotesConnector(g("notes"), logger=logger))
    reg.register(WeatherConnector(g("weather"), logger=logger))
    reg.register(DiscordConnector(g("discord"), logger=logger))
    reg.register(GenericRestConnector(g("generic_rest_api"), logger=logger))
    reg.register(ContactsConnector(g("contacts"), logger=logger))
    reg.register(TaskManagerConnector(g("task_manager"), logger=logger))
    reg.register(CloudStorageConnector(g("cloud_storage"), logger=logger))
    reg.register(ServerMonitorConnector(g("server_monitor"), logger=logger))
    return reg
