"""
JARVIS-Lite — Project Manager
===============================
Scans directories, detects project types, extracts TODOs, integrates with Git.
"""

import os
from pathlib import Path

from config import JarvisConfig
from logs.audit import AuditLogger

_CODE_EXTS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go", ".c", ".cpp",
    ".java", ".rb", ".php", ".swift", ".kt", ".cs", ".sh", ".bash",
    ".html", ".css", ".scss",
}

_IGNORE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}


class ProjectManager:
    def __init__(self, audit: AuditLogger, config: JarvisConfig):
        self._audit = audit
        self._config = config

    def scan(self, path: str) -> dict:
        """Full project summary: file counts, type detection, Git status."""
        p = Path(os.path.expanduser(path))
        if not p.is_dir():
            return {"error": f"Not a directory: {path}"}

        files: dict = {"total": 0, "by_ext": {}, "by_dir": {}}
        for f in p.rglob("*"):
            if f.is_file() and not any(part in _IGNORE_DIRS for part in f.parts):
                files["total"] += 1
                ext = f.suffix or "(no ext)"
                files["by_ext"][ext] = files["by_ext"].get(ext, 0) + 1
                rel_dir = str(f.parent.relative_to(p))
                files["by_dir"][rel_dir] = files["by_dir"].get(rel_dir, 0) + 1

        # Detect project type
        project_type = "unknown"
        markers = {
            "package.json": "node",
            "requirements.txt": "python", "pyproject.toml": "python", "setup.py": "python",
            "Cargo.toml": "rust",
            "go.mod": "go",
            "pom.xml": "java", "build.gradle": "java",
            "Gemfile": "ruby",
            "composer.json": "php",
        }
        for marker, ptype in markers.items():
            if (p / marker).exists():
                project_type = ptype
                break

        readme = None
        for name in ["README.md", "README.txt", "README"]:
            rp = p / name
            if rp.exists():
                readme = rp.read_text(errors="replace")[:1000]
                break

        return {
            "path": str(p),
            "project_type": project_type,
            "files": files,
            "has_git": (p / ".git").is_dir(),
            "readme_preview": readme,
        }

    def extract_todos(self, path: str) -> list[dict]:
        """Extract TODO / FIXME / HACK comments from source files."""
        p = Path(os.path.expanduser(path))
        todos: list[dict] = []
        for f in p.rglob("*"):
            if not f.is_file() or f.suffix not in _CODE_EXTS:
                continue
            if any(part in _IGNORE_DIRS for part in f.parts):
                continue
            try:
                for i, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
                    for tag in ("TODO", "FIXME", "HACK", "XXX"):
                        if tag in line:
                            todos.append({
                                "file": str(f.relative_to(p)),
                                "line": i,
                                "tag": tag,
                                "text": line.strip(),
                            })
                            break
            except Exception:
                continue
            if len(todos) >= 200:
                break
        return todos
