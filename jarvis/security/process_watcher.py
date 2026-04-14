"""
Nova — Process Watcher
================================
Monitors all child processes spawned by JARVIS for anomalies:
 - new/exited children
 - high CPU or memory usage
 - suspicious command lines
"""

import os
import threading
import time

import psutil

from logs.audit import AuditLogger


class ProcessWatcher:
    def __init__(self, audit: AuditLogger):
        self._audit = audit
        self._thread: threading.Thread | None = None
        self._running = False
        self._watched: set[int] = set()

    def start(self, interval: float = 5.0):
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True,
        )
        self._thread.start()
        self._audit.log("security", "process_watcher_started", {"interval": interval})

    def stop(self):
        self._running = False

    def _loop(self, interval: float):
        while self._running:
            try:
                self._check()
            except Exception as e:
                self._audit.log("security", "watcher_error", {"error": str(e)})
            time.sleep(interval)

    def _check(self):
        try:
            main = psutil.Process(os.getpid())
        except psutil.NoSuchProcess:
            return
        children = main.children(recursive=True)
        current = {c.pid for c in children}

        # Detect new child processes
        for pid in current - self._watched:
            try:
                p = psutil.Process(pid)
                cmdline = " ".join(p.cmdline()[:5])
                self._audit.log("security", "new_child_process", {
                    "pid": pid, "name": p.name(), "cmdline": cmdline,
                })
                # Flag suspicious commands
                for bad in ("nc ", "ncat ", "socat ", "curl.*|.*sh", "bash -i"):
                    if bad in cmdline.lower():
                        self._audit.log("security", "suspicious_process", {
                            "pid": pid, "name": p.name(), "cmdline": cmdline,
                        })
            except psutil.NoSuchProcess:
                continue

        # Detect exited children
        for pid in self._watched - current:
            self._audit.log("security", "child_ended", {"pid": pid})

        self._watched = current

        # Resource abuse checks
        for child in children:
            try:
                mem_mb = child.memory_info().rss / (1024 * 1024)
                cpu = child.cpu_percent(interval=0.1)
                if mem_mb > 1024:
                    self._audit.log("security", "high_memory", {
                        "pid": child.pid, "name": child.name(), "mb": round(mem_mb),
                    })
                if cpu > 90:
                    self._audit.log("security", "high_cpu", {
                        "pid": child.pid, "name": child.name(), "cpu": cpu,
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

    def get_status(self) -> dict:
        try:
            main = psutil.Process(os.getpid())
            children = main.children(recursive=True)
            return {
                "running": self._running,
                "child_count": len(children),
                "watched_pids": list(self._watched),
            }
        except Exception:
            return {"running": self._running, "child_count": 0, "watched_pids": []}
