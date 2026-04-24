"""Cloud storage connector — local-path-backed pluggable backend.

Config env var CLOUD_STORAGE_PATH is treated as a mount point (e.g. an
rclone mount, Dropbox folder, or shared drive). External SDKs can be added
later by swapping the backend without changing action names.
"""
from __future__ import annotations
import os
import shutil
from pathlib import Path
from .base import BaseConnector, ConnectorAction


class CloudStorageConnector(BaseConnector):
    name = "cloud_storage"
    description = "List/upload/download against a cloud-mount folder."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.root = Path(os.environ.get(self.cfg.get("path_env", ""), "")
                         or "~/cloud").expanduser()

    def is_configured(self) -> bool:
        return self.root.exists()

    def _register_actions(self) -> None:
        self.register(ConnectorAction("list", "List files at root or subpath", "read",
                                      handler=self._list))
        self.register(ConnectorAction("upload", "Copy a local file to cloud", "write",
                                      requires_approval=True, handler=self._upload))
        self.register(ConnectorAction("download", "Copy from cloud to local", "write",
                                      requires_approval=True, handler=self._download))

    def _list(self, *, subpath: str = "") -> dict:
        p = (self.root / subpath).resolve()
        if not p.exists():
            return {"ok": False, "error": "not found", "path": str(p)}
        return {"ok": True, "entries": [
            {"name": x.name, "is_dir": x.is_dir(),
             "size": x.stat().st_size if x.is_file() else None}
            for x in sorted(p.iterdir())]}

    def _upload(self, *, src: str, dst: str) -> dict:
        s = Path(src).expanduser().resolve()
        d = (self.root / dst).resolve()
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
        return {"ok": True, "dst": str(d)}

    def _download(self, *, src: str, dst: str) -> dict:
        s = (self.root / src).resolve()
        d = Path(dst).expanduser().resolve()
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
        return {"ok": True, "dst": str(d)}
