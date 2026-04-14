"""
Nova — Project Indexer
================================
Scans the user's project directories and indexes key files into memory
so the AI understands the codebase and can provide relevant help.

Security: STRICTLY respects restricted paths — will never index
sensitive files like .env, secrets, keys, or binary files.
"""

import hashlib
import os
from pathlib import Path

from config import JarvisConfig
from logs.audit import AuditLogger
from memory.store import MemoryStore


# File extensions we index (code, config, docs)
_INDEXABLE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".go", ".java",
    ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".kt",
    ".yaml", ".yml", ".toml", ".json", ".md", ".txt", ".sh",
    ".css", ".html", ".sql", ".dockerfile", ".makefile",
}

# Files/dirs that are NEVER indexed — security boundary
_RESTRICTED_PATTERNS = {
    ".env", ".env.local", ".env.production", ".env.development",
    "secrets", "private_key", "id_rsa", "id_ed25519",
    ".ssh", ".gnupg", ".password-store",
    "node_modules", "__pycache__", ".venv", "venv", ".git",
    "dist", "build", ".next", ".nuxt", "target",
    ".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe",
    "jarvis.db", "audit.jsonl", "integrity.json",
}

# Max file size to index (200KB — skip large generated files)
_MAX_FILE_SIZE = 200 * 1024

# Max lines to store per file (summary, not full dump)
_MAX_LINES = 150


class ProjectIndexer:
    """Scans project directories and stores structured summaries in memory."""

    def __init__(self, config: JarvisConfig, memory: MemoryStore, audit: AuditLogger):
        self._config = config
        self._memory = memory
        self._audit = audit
        self._allowed_dirs = [os.path.expanduser(d) for d in config.allowed_dirs]
        self._indexed_hashes: dict[str, str] = {}  # path → content hash

    def is_restricted(self, path: str) -> bool:
        """Check if a path matches any restricted pattern."""
        parts = Path(path).parts
        name = Path(path).name.lower()
        for pattern in _RESTRICTED_PATTERNS:
            if pattern in parts or name == pattern or name.endswith(pattern):
                return True
        return False

    def is_indexable(self, path: str) -> bool:
        """Check if a file should be indexed."""
        p = Path(path)
        if self.is_restricted(path):
            return False
        if p.suffix.lower() not in _INDEXABLE_EXTS:
            return False
        try:
            if p.stat().st_size > _MAX_FILE_SIZE:
                return False
        except OSError:
            return False
        return True

    def index_directory(self, directory: str) -> dict:
        """
        Index all eligible files in a directory tree.
        Returns summary of what was indexed.
        """
        directory = os.path.expanduser(directory)
        resolved = os.path.realpath(directory)

        # Security: must be within allowed dirs
        if not any(resolved.startswith(os.path.realpath(d)) for d in self._allowed_dirs):
            self._audit.log("indexer", "blocked_directory", {"path": directory})
            return {"error": f"Directory outside allowed paths: {directory}"}

        if not os.path.isdir(resolved):
            return {"error": f"Not a directory: {directory}"}

        self._audit.log("indexer", "scan_started", {"path": directory})

        stats = {"files_scanned": 0, "files_indexed": 0, "files_skipped": 0, "restricted": 0}
        project_summary = {
            "root": directory,
            "languages": set(),
            "structure": [],
            "key_files": [],
        }

        for root, dirs, files in os.walk(resolved):
            # Prune restricted directories in-place
            dirs[:] = [d for d in dirs if not self.is_restricted(os.path.join(root, d))]

            for fname in files:
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, resolved)
                stats["files_scanned"] += 1

                if self.is_restricted(full_path):
                    stats["restricted"] += 1
                    continue

                if not self.is_indexable(full_path):
                    stats["files_skipped"] += 1
                    continue

                try:
                    content = Path(full_path).read_text(errors="replace")
                except Exception:
                    stats["files_skipped"] += 1
                    continue

                # Check if content changed since last index
                content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
                if self._indexed_hashes.get(rel_path) == content_hash:
                    continue

                # Store a concise summary of the file
                summary = self._summarize_file(rel_path, content)
                self._memory.store_knowledge("project_file", rel_path, summary)
                self._indexed_hashes[rel_path] = content_hash
                stats["files_indexed"] += 1

                # Track language
                ext = Path(fname).suffix.lower()
                lang = _EXT_TO_LANG.get(ext, ext)
                project_summary["languages"].add(lang)
                project_summary["structure"].append(rel_path)

                # Track important files
                if fname.lower() in ("readme.md", "package.json", "requirements.txt",
                                      "cargo.toml", "main.py", "main.js", "main.ts",
                                      "index.py", "index.js", "index.ts", "app.py",
                                      "config.yaml", "config.json", "makefile"):
                    project_summary["key_files"].append(rel_path)

        # Store the project overview
        overview = self._build_overview(project_summary, stats)
        self._memory.store_knowledge("project", "overview", overview)

        self._audit.log("indexer", "scan_complete", stats)
        stats["languages"] = list(project_summary["languages"])
        return stats

    def get_file_context(self, path: str) -> str | None:
        """Retrieve the indexed summary for a specific file."""
        return self._memory.get_knowledge("project_file", path)

    def get_project_overview(self) -> str | None:
        """Get the stored project overview."""
        return self._memory.get_knowledge("project", "overview")

    def _summarize_file(self, rel_path: str, content: str) -> str:
        """Create a concise summary of a file's contents."""
        lines = content.split("\n")
        total = len(lines)

        # For short files, store (almost) everything
        if total <= _MAX_LINES:
            return content

        # For longer files, grab the important parts:
        # - First 30 lines (imports, module docstring)
        # - Any class/function definitions
        # - Last 10 lines
        parts = []
        parts.append(f"[{rel_path} — {total} lines total, showing key sections]")
        parts.append("\n".join(lines[:30]))

        # Extract class/function signatures
        defs = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if (stripped.startswith(("class ", "def ", "async def ",
                                     "function ", "export ", "const ", "pub fn ",
                                     "func ", "public class "))):
                # Grab the definition + next 2 lines for context
                defs.append(f"  L{i+1}: {stripped}")
        if defs:
            parts.append("\n[Definitions found:]")
            parts.append("\n".join(defs[:50]))

        parts.append(f"\n[... last 10 lines ...]")
        parts.append("\n".join(lines[-10:]))

        return "\n".join(parts)

    def _build_overview(self, summary: dict, stats: dict) -> str:
        """Build a human-readable project overview string."""
        lines = [
            f"Project root: {summary['root']}",
            f"Languages: {', '.join(sorted(summary['languages'])) or 'unknown'}",
            f"Files indexed: {stats['files_indexed']}",
            f"Files restricted (security): {stats['restricted']}",
        ]
        if summary["key_files"]:
            lines.append(f"Key files: {', '.join(summary['key_files'][:15])}")
        if summary["structure"]:
            lines.append(f"Structure ({len(summary['structure'])} files):")
            for f in summary["structure"][:40]:
                lines.append(f"  {f}")
            if len(summary["structure"]) > 40:
                lines.append(f"  ... and {len(summary['structure']) - 40} more")
        return "\n".join(lines)


# Extension → friendly language name
_EXT_TO_LANG = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "React/JSX",
    ".ts": "TypeScript", ".tsx": "React/TSX", ".rs": "Rust",
    ".go": "Go", ".java": "Java", ".c": "C", ".cpp": "C++",
    ".h": "C/C++ Header", ".rb": "Ruby", ".php": "PHP",
    ".swift": "Swift", ".kt": "Kotlin", ".sh": "Shell",
    ".css": "CSS", ".html": "HTML", ".sql": "SQL",
    ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
    ".json": "JSON", ".md": "Markdown",
}
