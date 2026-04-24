"""Local filesystem connector — sandboxed through FsPolicy."""
from __future__ import annotations
from .base import BaseConnector, ConnectorAction, ConnectorResult
from ..tools.fs_tools import read_file, write_file, list_dir, search_files, inspect_repo


class LocalFilesConnector(BaseConnector):
    name = "local_files"
    description = "Read/write/search files inside sandboxed roots."
    risk = "medium"

    def __init__(self, cfg=None, logger=None, fs_policy=None):
        self.fs = fs_policy
        self.read_only = bool((cfg or {}).get("read_only", False))
        super().__init__(cfg, logger)

    def _register_actions(self) -> None:
        self.register(ConnectorAction("read", "Read a file", "read",
                                      handler=lambda **p: read_file(self.fs, **p)))
        self.register(ConnectorAction("list", "List a directory", "read",
                                      handler=lambda **p: list_dir(self.fs, **p)))
        self.register(ConnectorAction("search", "Grep in files", "read",
                                      handler=lambda **p: search_files(self.fs, **p)))
        self.register(ConnectorAction("inspect_repo", "Inspect repo metadata", "read",
                                      handler=lambda **p: inspect_repo(self.fs, **p)))
        if not self.read_only:
            self.register(ConnectorAction(
                "write", "Write a file (sandboxed)", "write",
                requires_approval=True,
                handler=lambda **p: write_file(self.fs, **p),
            ))

    def is_configured(self) -> bool:
        return self.fs is not None

    def health(self) -> ConnectorResult:
        return ConnectorResult(self.enabled and self.fs is not None,
                               data={"roots": [str(r) for r in (self.fs.allowed_roots if self.fs else [])]})
