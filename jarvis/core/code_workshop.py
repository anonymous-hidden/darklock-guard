"""
Nova — Code Workshop
=====================
Nova's ability to read, understand, edit, and build code.
Not just blind file writes — AST-aware editing for Python,
targeted function replacement, project scaffolding, and
build pipeline management.

Capabilities:
  - Read & analyze code (structure, functions, classes, imports)
  - Targeted edits (find function by name → replace just that block)
  - Patch generation (show diff before applying)
  - Project scaffolding (create full project trees from templates)
  - Build pipeline (detect type → install deps → build → test)
  - Syntax validation before writing
"""

import ast
import difflib
import json
import os
import re
import subprocess
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class CodeBlock:
    """A located block of code (function, class, etc.)."""
    name: str
    block_type: str         # "function", "class", "method"
    start_line: int
    end_line: int
    source: str
    decorators: list[str] = field(default_factory=list)
    docstring: str = ""
    parent: str = ""        # class name for methods


@dataclass
class CodeAnalysis:
    """Analysis of a source file."""
    path: str
    language: str
    imports: list[str] = field(default_factory=list)
    classes: list[str] = field(default_factory=list)
    functions: list[str] = field(default_factory=list)
    blocks: list[CodeBlock] = field(default_factory=list)
    line_count: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "language": self.language,
            "imports": self.imports,
            "classes": self.classes,
            "functions": self.functions,
            "line_count": self.line_count,
            "blocks": len(self.blocks),
            "errors": self.errors,
        }


@dataclass
class EditPatch:
    """A proposed code edit with before/after diff."""
    file_path: str
    description: str
    original: str
    modified: str
    diff: str
    applied: bool = False

    def to_dict(self) -> dict:
        return {
            "file_path": self.file_path,
            "description": self.description,
            "diff": self.diff,
            "applied": self.applied,
        }


@dataclass
class BuildResult:
    """Result of a build pipeline run."""
    project_path: str
    project_type: str
    steps: list[dict] = field(default_factory=list)     # [{name, command, success, output}]
    success: bool = False
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "project_path": self.project_path,
            "project_type": self.project_type,
            "steps": self.steps,
            "success": self.success,
            "errors": self.errors,
        }


# ── Language Detection ────────────────────────────

_EXT_TO_LANG = {
    ".py": "python", ".pyw": "python",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".jsx": "javascript",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c", ".h": "c",
    ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
    ".rb": "ruby",
    ".sh": "bash", ".bash": "bash",
    ".yaml": "yaml", ".yml": "yaml",
    ".json": "json",
    ".toml": "toml",
    ".md": "markdown",
    ".html": "html", ".htm": "html",
    ".css": "css",
    ".sql": "sql",
}

# ── Project Type Detection ────────────────────────

_PROJECT_MARKERS = {
    "python": ["setup.py", "pyproject.toml", "requirements.txt", "setup.cfg"],
    "node": ["package.json"],
    "rust": ["Cargo.toml"],
    "go": ["go.mod"],
    "java": ["pom.xml", "build.gradle"],
    "docker": ["Dockerfile", "docker-compose.yml"],
}


class CodeWorkshop:
    """
    Nova's code manipulation engine. Reads, analyzes, edits, and
    builds code projects with intelligence.
    """

    def __init__(self, guardian, audit, activity_tracker):
        self._guardian = guardian
        self._audit = audit
        self._activity = activity_tracker

        self._pending_patches: dict[str, EditPatch] = {}
        self._patch_counter = 0

    # ── Analysis ──────────────────────────────────

    def analyze_file(self, file_path: str) -> CodeAnalysis:
        """Analyze a source file and extract its structure."""
        path = Path(os.path.expanduser(file_path)).resolve()

        # Guardian check
        decision = self._guardian.check_path(str(path), "read")
        if not decision.allowed:
            return CodeAnalysis(
                path=str(path), language="unknown",
                errors=[f"Access denied: {decision.reason}"],
            )

        if not path.exists():
            return CodeAnalysis(
                path=str(path), language="unknown",
                errors=["File not found"],
            )

        ext = path.suffix.lower()
        lang = _EXT_TO_LANG.get(ext, "unknown")

        try:
            source = path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            return CodeAnalysis(
                path=str(path), language=lang,
                errors=[f"Read error: {e}"],
            )

        analysis = CodeAnalysis(
            path=str(path),
            language=lang,
            line_count=source.count("\n") + 1,
        )

        if lang == "python":
            self._analyze_python(source, analysis)
        elif lang in ("javascript", "typescript"):
            self._analyze_js(source, analysis)
        else:
            # Basic analysis for other languages
            self._analyze_generic(source, analysis)

        return analysis

    def _analyze_python(self, source: str, analysis: CodeAnalysis):
        """AST-based analysis for Python files."""
        try:
            tree = ast.parse(source)
        except SyntaxError as e:
            analysis.errors.append(f"Syntax error: {e}")
            return

        lines = source.splitlines()

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    analysis.imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    analysis.imports.append(f"{module}.{alias.name}")

        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.ClassDef):
                analysis.classes.append(node.name)
                end = self._get_end_line(node, lines)
                block_source = "\n".join(lines[node.lineno - 1:end])
                analysis.blocks.append(CodeBlock(
                    name=node.name,
                    block_type="class",
                    start_line=node.lineno,
                    end_line=end,
                    source=block_source,
                    decorators=[ast.dump(d) for d in node.decorator_list],
                    docstring=ast.get_docstring(node) or "",
                ))
                # Methods
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        m_end = self._get_end_line(item, lines)
                        m_source = "\n".join(lines[item.lineno - 1:m_end])
                        analysis.functions.append(f"{node.name}.{item.name}")
                        analysis.blocks.append(CodeBlock(
                            name=item.name,
                            block_type="method",
                            start_line=item.lineno,
                            end_line=m_end,
                            source=m_source,
                            parent=node.name,
                            docstring=ast.get_docstring(item) or "",
                        ))

            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                analysis.functions.append(node.name)
                end = self._get_end_line(node, lines)
                block_source = "\n".join(lines[node.lineno - 1:end])
                analysis.blocks.append(CodeBlock(
                    name=node.name,
                    block_type="function",
                    start_line=node.lineno,
                    end_line=end,
                    source=block_source,
                    decorators=[ast.dump(d) for d in node.decorator_list],
                    docstring=ast.get_docstring(node) or "",
                ))

    def _analyze_js(self, source: str, analysis: CodeAnalysis):
        """Regex-based analysis for JavaScript/TypeScript."""
        # Imports
        for m in re.finditer(r'''(?:import|require)\s*\(?\s*['"](.+?)['"]\)?''', source):
            analysis.imports.append(m.group(1))
        for m in re.finditer(r'''import\s+.+?\s+from\s+['"](.+?)['"]''', source):
            analysis.imports.append(m.group(1))

        # Classes
        for m in re.finditer(r'class\s+(\w+)', source):
            analysis.classes.append(m.group(1))

        # Functions (top-level)
        for m in re.finditer(
            r'(?:export\s+)?(?:async\s+)?function\s+(\w+)|'
            r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>',
            source,
        ):
            name = m.group(1) or m.group(2)
            if name:
                analysis.functions.append(name)

    def _analyze_generic(self, source: str, analysis: CodeAnalysis):
        """Basic pattern matching for any language."""
        for m in re.finditer(r'(?:def|func|fn|function|sub|proc)\s+(\w+)', source):
            analysis.functions.append(m.group(1))
        for m in re.finditer(r'class\s+(\w+)', source):
            analysis.classes.append(m.group(1))

    @staticmethod
    def _get_end_line(node, lines: list[str]) -> int:
        """Get the end line of an AST node (handles Python 3.8+ end_lineno)."""
        if hasattr(node, "end_lineno") and node.end_lineno:
            return node.end_lineno
        # Fallback: find next non-indented line
        start_indent = len(lines[node.lineno - 1]) - len(lines[node.lineno - 1].lstrip())
        for i in range(node.lineno, len(lines)):
            line = lines[i]
            if line.strip() and not line.startswith(" " * (start_indent + 1)):
                if i > node.lineno:
                    return i
        return len(lines)

    # ── Find Block ────────────────────────────────

    def find_block(self, file_path: str, name: str) -> CodeBlock | None:
        """Find a named function/class/method in a file."""
        analysis = self.analyze_file(file_path)
        for block in analysis.blocks:
            if block.name == name:
                return block
            # Check class.method format
            if block.parent and f"{block.parent}.{block.name}" == name:
                return block
        return None

    # ── Editing ───────────────────────────────────

    def replace_block(
        self,
        file_path: str,
        block_name: str,
        new_source: str,
        description: str = "",
    ) -> EditPatch | None:
        """Replace a named code block with new source. Returns a patch for review."""
        path = Path(os.path.expanduser(file_path)).resolve()

        decision = self._guardian.check_path(str(path), "write")
        if not decision.allowed:
            return None

        block = self.find_block(str(path), block_name)
        if not block:
            return None

        source = path.read_text(encoding="utf-8")
        lines = source.splitlines(keepends=True)

        # Replace the block's lines
        before = lines[:block.start_line - 1]
        after = lines[block.end_line:]
        new_lines = before + [new_source.rstrip() + "\n"] + after
        modified = "".join(new_lines)

        # Validate syntax for Python
        lang = _EXT_TO_LANG.get(path.suffix.lower(), "")
        if lang == "python":
            try:
                ast.parse(modified)
            except SyntaxError as e:
                self._audit.log("workshop", "syntax_error", {
                    "file": str(path), "block": block_name, "error": str(e),
                })
                return EditPatch(
                    file_path=str(path),
                    description=f"SYNTAX ERROR: {e}",
                    original=source,
                    modified=modified,
                    diff="",
                )

        # Generate diff
        diff = "".join(difflib.unified_diff(
            source.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{path.name}",
            tofile=f"b/{path.name}",
        ))

        self._patch_counter += 1
        patch_id = f"patch-{self._patch_counter}"

        patch = EditPatch(
            file_path=str(path),
            description=description or f"Replace {block_name}",
            original=source,
            modified=modified,
            diff=diff,
        )

        self._pending_patches[patch_id] = patch

        self._audit.log("workshop", "patch_created", {
            "id": patch_id,
            "file": str(path),
            "block": block_name,
            "diff_lines": diff.count("\n"),
        })

        return patch

    def edit_file(
        self,
        file_path: str,
        old_text: str,
        new_text: str,
        description: str = "",
    ) -> EditPatch | None:
        """Find-and-replace edit with diff preview."""
        path = Path(os.path.expanduser(file_path)).resolve()

        decision = self._guardian.check_path(str(path), "write")
        if not decision.allowed:
            return None

        if not path.exists():
            return None

        source = path.read_text(encoding="utf-8")
        if old_text not in source:
            return None

        # Only replace first occurrence
        modified = source.replace(old_text, new_text, 1)

        # Validate Python syntax
        lang = _EXT_TO_LANG.get(path.suffix.lower(), "")
        if lang == "python":
            try:
                ast.parse(modified)
            except SyntaxError as e:
                return EditPatch(
                    file_path=str(path),
                    description=f"SYNTAX ERROR: {e}",
                    original=source,
                    modified=modified,
                    diff="",
                )

        diff = "".join(difflib.unified_diff(
            source.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{path.name}",
            tofile=f"b/{path.name}",
        ))

        self._patch_counter += 1
        patch_id = f"patch-{self._patch_counter}"

        patch = EditPatch(
            file_path=str(path),
            description=description or "Find-and-replace edit",
            original=source,
            modified=modified,
            diff=diff,
        )
        self._pending_patches[patch_id] = patch
        return patch

    def apply_patch(self, patch_id: str) -> bool:
        """Apply a pending patch (write to disk)."""
        patch = self._pending_patches.get(patch_id)
        if not patch or patch.applied:
            return False

        path = Path(patch.file_path)
        decision = self._guardian.check_path(str(path), "write")
        if not decision.allowed:
            return False

        path.write_text(patch.modified, encoding="utf-8")
        patch.applied = True

        self._audit.log("workshop", "patch_applied", {
            "id": patch_id,
            "file": patch.file_path,
        })
        self._activity.system_event(
            f"Code patch applied: {patch.description} ({path.name})")

        return True

    def create_file(
        self,
        file_path: str,
        content: str,
        description: str = "",
    ) -> bool:
        """Create a new file with content."""
        path = Path(os.path.expanduser(file_path)).resolve()

        decision = self._guardian.check_path(str(path), "write")
        if not decision.allowed:
            return False

        # Validate Python syntax
        lang = _EXT_TO_LANG.get(path.suffix.lower(), "")
        if lang == "python":
            try:
                ast.parse(content)
            except SyntaxError as e:
                self._audit.log("workshop", "create_syntax_error", {
                    "file": str(path), "error": str(e),
                })
                return False

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

        self._audit.log("workshop", "file_created", {
            "path": str(path), "lines": content.count("\n") + 1,
        })
        self._activity.system_event(
            f"Created file: {path.name} ({description})" if description
            else f"Created file: {path.name}")

        return True

    # ── Build Pipeline ────────────────────────────

    def detect_project_type(self, project_path: str) -> str:
        """Detect the type of project in a directory."""
        path = Path(os.path.expanduser(project_path)).resolve()
        if not path.is_dir():
            return "unknown"

        files = {f.name for f in path.iterdir() if f.is_file()}
        for ptype, markers in _PROJECT_MARKERS.items():
            if any(m in files for m in markers):
                return ptype
        return "unknown"

    def build_project(self, project_path: str, force_type: str = "") -> BuildResult:
        """Run the build pipeline for a project."""
        path = Path(os.path.expanduser(project_path)).resolve()
        ptype = force_type or self.detect_project_type(str(path))

        result = BuildResult(
            project_path=str(path),
            project_type=ptype,
        )

        if ptype == "python":
            self._build_python(path, result)
        elif ptype == "node":
            self._build_node(path, result)
        elif ptype == "rust":
            self._build_rust(path, result)
        elif ptype == "go":
            self._build_go(path, result)
        elif ptype == "docker":
            self._build_docker(path, result)
        else:
            result.errors.append(f"Unknown project type: {ptype}")

        result.success = all(s.get("success") for s in result.steps)

        self._audit.log("workshop", "build_complete", {
            "path": str(path),
            "type": ptype,
            "success": result.success,
            "steps": len(result.steps),
        })

        return result

    def _run_step(self, name: str, command: str, cwd: Path,
                  result: BuildResult, timeout: int = 120):
        """Run a build step and record the result."""
        try:
            proc = subprocess.run(
                command, shell=True, cwd=str(cwd),
                capture_output=True, text=True, timeout=timeout,
            )
            step = {
                "name": name,
                "command": command,
                "success": proc.returncode == 0,
                "output": (proc.stdout[-2000:] if proc.stdout else "")
                    + (proc.stderr[-1000:] if proc.stderr else ""),
                "exit_code": proc.returncode,
            }
        except subprocess.TimeoutExpired:
            step = {
                "name": name, "command": command,
                "success": False, "output": f"Timeout after {timeout}s",
                "exit_code": -1,
            }
        except Exception as e:
            step = {
                "name": name, "command": command,
                "success": False, "output": str(e),
                "exit_code": -1,
            }

        result.steps.append(step)
        if not step["success"]:
            result.errors.append(f"Step '{name}' failed: {step['output'][:200]}")

    def _build_python(self, path: Path, result: BuildResult):
        """Python build pipeline."""
        # Create venv if missing
        venv = path / ".venv"
        if not venv.exists():
            self._run_step("create_venv", "python3 -m venv .venv", path, result)

        pip = str(venv / "bin" / "pip") if venv.exists() else "pip3"

        # Install deps
        if (path / "requirements.txt").exists():
            self._run_step("install_deps", f"{pip} install -r requirements.txt", path, result)
        elif (path / "pyproject.toml").exists():
            self._run_step("install_deps", f"{pip} install -e .", path, result)

        # Syntax check
        self._run_step("syntax_check",
            f"python3 -m py_compile {' '.join(str(f) for f in path.glob('*.py'))}",
            path, result, timeout=30)

        # Run tests if they exist
        tests = path / "tests"
        if tests.is_dir():
            python = str(venv / "bin" / "python") if venv.exists() else "python3"
            self._run_step("test", f"{python} -m pytest tests/ -x --tb=short", path, result)

    def _build_node(self, path: Path, result: BuildResult):
        """Node.js build pipeline."""
        nm = path / "node_modules"
        if not nm.exists():
            lock = path / "package-lock.json"
            cmd = "npm ci" if lock.exists() else "npm install"
            self._run_step("install_deps", cmd, path, result)

        # Lint if configured
        pkg = path / "package.json"
        if pkg.exists():
            try:
                pkg_data = json.loads(pkg.read_text())
                scripts = pkg_data.get("scripts", {})
                if "lint" in scripts:
                    self._run_step("lint", "npm run lint", path, result)
                if "build" in scripts:
                    self._run_step("build", "npm run build", path, result)
                if "test" in scripts:
                    self._run_step("test", "npm test", path, result, timeout=60)
            except Exception:
                pass

    def _build_rust(self, path: Path, result: BuildResult):
        self._run_step("check", "cargo check", path, result)
        self._run_step("build", "cargo build", path, result)
        self._run_step("test", "cargo test", path, result)

    def _build_go(self, path: Path, result: BuildResult):
        self._run_step("build", "go build ./...", path, result)
        self._run_step("test", "go test ./...", path, result)

    def _build_docker(self, path: Path, result: BuildResult):
        self._run_step("build", "docker compose build", path, result, timeout=300)

    # ── Scaffolding ───────────────────────────────

    def scaffold_project(
        self,
        base_path: str,
        project_name: str,
        project_type: str,
        features: list[str] | None = None,
    ) -> dict:
        """Create a new project directory with boilerplate."""
        base = Path(os.path.expanduser(base_path)).resolve()
        project_dir = base / project_name

        decision = self._guardian.check_path(str(project_dir), "write")
        if not decision.allowed:
            return {"success": False, "error": decision.reason}

        if project_dir.exists():
            return {"success": False, "error": "Directory already exists"}

        project_dir.mkdir(parents=True)
        features = features or []
        created_files = []

        if project_type == "python":
            created_files = self._scaffold_python(project_dir, project_name, features)
        elif project_type == "node":
            created_files = self._scaffold_node(project_dir, project_name, features)
        elif project_type == "fastapi":
            created_files = self._scaffold_fastapi(project_dir, project_name, features)
        else:
            # Generic
            (project_dir / "README.md").write_text(f"# {project_name}\n")
            created_files.append("README.md")

        self._audit.log("workshop", "scaffold", {
            "path": str(project_dir),
            "type": project_type,
            "files": len(created_files),
        })
        self._activity.system_event(
            f"Scaffolded {project_type} project: {project_name}")

        return {
            "success": True,
            "path": str(project_dir),
            "type": project_type,
            "files_created": created_files,
        }

    def _scaffold_python(self, d: Path, name: str, features: list) -> list[str]:
        files = []
        (d / name).mkdir()
        (d / name / "__init__.py").write_text(f'"""{ name }"""\n\n__version__ = "0.1.0"\n')
        files.append(f"{name}/__init__.py")

        (d / name / "main.py").write_text(textwrap.dedent(f"""\
            \"\"\"{ name } — entry point.\"\"\"


            def main():
                print("Hello from {name}")


            if __name__ == "__main__":
                main()
        """))
        files.append(f"{name}/main.py")

        (d / "requirements.txt").write_text("")
        files.append("requirements.txt")

        (d / "tests").mkdir()
        (d / "tests" / "__init__.py").write_text("")
        (d / "tests" / f"test_{name}.py").write_text(textwrap.dedent(f"""\
            from {name}.main import main


            def test_main():
                main()  # smoke test
        """))
        files.extend(["tests/__init__.py", f"tests/test_{name}.py"])

        (d / "README.md").write_text(f"# {name}\n")
        files.append("README.md")

        return files

    def _scaffold_node(self, d: Path, name: str, features: list) -> list[str]:
        files = []
        pkg = {
            "name": name,
            "version": "1.0.0",
            "main": "src/index.js",
            "scripts": {"start": "node src/index.js", "test": "echo 'no tests'"},
        }
        (d / "package.json").write_text(json.dumps(pkg, indent=2))
        files.append("package.json")

        (d / "src").mkdir()
        (d / "src" / "index.js").write_text(
            f'console.log("Hello from {name}");\n')
        files.append("src/index.js")

        (d / "README.md").write_text(f"# {name}\n")
        files.append("README.md")

        return files

    def _scaffold_fastapi(self, d: Path, name: str, features: list) -> list[str]:
        files = []

        (d / "requirements.txt").write_text("fastapi\nuvicorn[standard]\n")
        files.append("requirements.txt")

        (d / "app").mkdir()
        (d / "app" / "__init__.py").write_text("")
        files.append("app/__init__.py")

        main_code = textwrap.dedent("""\
            from fastapi import FastAPI

            app = FastAPI()


            @app.get("/health")
            def health():
                return {"status": "ok"}


            @app.get("/")
            def root():
                return {"message": "Hello World"}
        """)

        if "auth" in features:
            main_code += textwrap.dedent("""

            # Auth placeholder
            from fastapi import Depends, HTTPException
            from fastapi.security import HTTPBearer

            security = HTTPBearer()


            @app.get("/protected")
            def protected(token=Depends(security)):
                return {"message": "Authenticated"}
            """)

        (d / "app" / "main.py").write_text(main_code)
        files.append("app/main.py")

        (d / "README.md").write_text(f"# {name}\n\nFastAPI project.\n\n```\nuvicorn app.main:app --reload\n```\n")
        files.append("README.md")

        return files

    # ── Validation ────────────────────────────────

    def validate_python(self, source: str) -> dict:
        """Check Python source for syntax errors."""
        try:
            ast.parse(source)
            return {"valid": True, "errors": []}
        except SyntaxError as e:
            return {
                "valid": False,
                "errors": [{
                    "line": e.lineno,
                    "offset": e.offset,
                    "message": e.msg,
                }],
            }

    # ── Status ────────────────────────────────────

    def get_status(self) -> dict:
        pending = sum(1 for p in self._pending_patches.values() if not p.applied)
        applied = sum(1 for p in self._pending_patches.values() if p.applied)
        return {
            "pending_patches": pending,
            "applied_patches": applied,
            "total_patches": len(self._pending_patches),
        }
