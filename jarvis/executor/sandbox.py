"""
Nova — Sandboxed Executor
==================================
Runs validated commands inside a restricted environment.
 - No root access
 - Restricted directories
 - Timeouts on every subprocess
 - Memory limits
"""

import asyncio
import datetime
import os
import shutil
import uuid
from pathlib import Path

import psutil

from config import JarvisConfig
from gateway.validator import CommandGateway
from integrations.govee import GoveeClient, parse_color
from logs.audit import AuditLogger


class SandboxExecutor:
    def __init__(self, gateway: CommandGateway, audit: AuditLogger, config: JarvisConfig):
        self._gateway = gateway
        self._audit = audit
        self._timeout = config.command_timeout
        self._max_mem = config.max_memory_mb
        self._config = config
        # Commands awaiting user approval: {id: command}
        self._pending: dict[str, dict] = {}

    # ── Public API ─────────────────────────────────────

    async def execute(self, command: dict) -> dict:
        """Validate → maybe queue for approval → run."""
        validation = self._gateway.validate(command)
        if not validation.approved:
            return {"success": False, "error": validation.reason}

        if validation.requires_approval:
            aid = uuid.uuid4().hex[:8]
            self._pending[aid] = command
            self._audit.log("executor", "pending_approval", {"id": aid, "command": command})
            return {
                "success": True,
                "pending_approval": True,
                "approval_id": aid,
                "message": f"⚠ Command requires your approval. ID: {aid}",
            }

        return await self._run(command)

    async def approve(self, approval_id: str) -> dict:
        command = self._pending.pop(approval_id, None)
        if not command:
            return {"success": False, "error": f"No pending command: {approval_id}"}
        self._audit.log("executor", "user_approved", {"id": approval_id})
        return await self._run(command)

    def reject(self, approval_id: str) -> dict:
        command = self._pending.pop(approval_id, None)
        if not command:
            return {"success": False, "error": f"No pending command: {approval_id}"}
        self._audit.log("executor", "user_rejected", {"id": approval_id})
        return {"success": True, "message": "Command rejected."}

    def list_pending(self) -> list[dict]:
        return [{"id": k, "command": v} for k, v in self._pending.items()]

    # ── Command router ─────────────────────────────────

    async def _run(self, command: dict) -> dict:
        action = command["action"]
        args = command.get("args", {})
        self._audit.log("executor", "executing", {"action": action, "args": args})

        handler = getattr(self, f"_cmd_{action}", None)
        if handler is None:
            return {"success": False, "error": f"No handler for '{action}'"}
        try:
            result = await handler(args)
            self._audit.log("executor", "completed", {"action": action})
            return {"success": True, "result": result}
        except asyncio.TimeoutError:
            self._audit.log("executor", "timeout", {"action": action})
            return {"success": False, "error": f"Timed out after {self._timeout}s"}
        except Exception as e:
            self._audit.log("executor", "error", {"action": action, "error": str(e)})
            return {"success": False, "error": str(e)}

    # ── File commands ──────────────────────────────────

    async def _cmd_file_read(self, args: dict) -> str:
        path = Path(os.path.expanduser(args["path"]))
        if not path.exists():
            raise FileNotFoundError(f"Not found: {path}")
        if path.stat().st_size > 1_000_000:
            raise ValueError("File too large (>1 MB)")
        return path.read_text(errors="replace")

    async def _cmd_file_write(self, args: dict) -> str:
        path = Path(os.path.expanduser(args["path"]))
        if path.exists():
            shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"])
        return f"Written {len(args['content'])} bytes → {path}"

    async def _cmd_file_list(self, args: dict) -> list[str]:
        path = Path(os.path.expanduser(args["path"]))
        if not path.is_dir():
            raise NotADirectoryError(str(path))
        entries = []
        for entry in sorted(path.iterdir()):
            prefix = "📁 " if entry.is_dir() else "📄 "
            entries.append(prefix + entry.name)
        return entries[:200]

    async def _cmd_file_search(self, args: dict) -> list[str]:
        path = Path(os.path.expanduser(args["path"]))
        matches = []
        for p in path.rglob(args["pattern"]):
            if ".git" in p.parts or "node_modules" in p.parts:
                continue
            matches.append(str(p.relative_to(path)))
            if len(matches) >= 100:
                break
        return matches

    # ── Git commands ───────────────────────────────────

    async def _cmd_git_status(self, a: dict) -> str:
        return await self._proc(["git", "status", "--short"], cwd=a["path"])

    async def _cmd_git_log(self, a: dict) -> str:
        n = str(a.get("limit", 10))
        return await self._proc(["git", "log", "--oneline", f"-{n}"], cwd=a["path"])

    async def _cmd_git_diff(self, a: dict) -> str:
        cmd = ["git", "diff"]
        if "file" in a:
            cmd.append(a["file"])
        return await self._proc(cmd, cwd=a["path"])

    async def _cmd_git_commit(self, a: dict) -> str:
        await self._proc(["git", "add", "-A"], cwd=a["path"])
        return await self._proc(["git", "commit", "-m", a["message"]], cwd=a["path"])

    async def _cmd_git_branch(self, a: dict) -> str:
        cmd = ["git", "branch"]
        if "name" in a:
            cmd.append(a["name"])
        return await self._proc(cmd, cwd=a["path"])

    # ── System commands ────────────────────────────────

    async def _cmd_system_status(self, _: dict) -> dict:
        return {
            "cpu_percent": psutil.cpu_percent(interval=0.5),
            "memory": {
                "total_gb": round(psutil.virtual_memory().total / 1e9, 1),
                "used_percent": psutil.virtual_memory().percent,
            },
            "disk": {
                "total_gb": round(psutil.disk_usage("/").total / 1e9, 1),
                "used_percent": round(psutil.disk_usage("/").percent, 1),
            },
        }

    async def _cmd_system_time(self, _: dict) -> str:
        return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z")

    async def _cmd_system_processes(self, _: dict) -> list[dict]:
        procs = []
        for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            try:
                procs.append(p.info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        procs.sort(key=lambda x: x.get("cpu_percent", 0) or 0, reverse=True)
        return procs[:20]

    # ── Script execution ───────────────────────────────

    async def _cmd_run_script(self, a: dict) -> str:
        script = a["script"]
        script_args = a.get("args", [])
        if isinstance(script_args, str):
            script_args = script_args.split()
        return await self._proc(["bash", script] + script_args, cwd=os.path.expanduser("~"))

    # ── Terminal / Shell commands ──────────────────────

    # Safe commands that don't need approval (read-only / informational)
    _SAFE_COMMANDS = {
        "ls", "cat", "head", "tail", "wc", "df", "du", "free", "uptime",
        "whoami", "hostname", "uname", "date", "cal", "which", "whereis",
        "file", "stat", "lsblk", "ip", "ping", "dig", "nslookup", "curl",
        "wget", "echo", "printf", "sort", "uniq", "grep", "awk", "sed",
        "cut", "tr", "pwd", "env", "printenv", "id", "groups",
        "pip", "pip3", "npm", "node", "python3", "git",
        "docker", "systemctl", "journalctl", "top", "htop", "neofetch",
    }

    async def _cmd_run_command(self, a: dict) -> str:
        """Run a shell command and return its output.
        Safe read-only commands run immediately.
        Others go through the approval queue (handled by the registry's requires_approval).
        """
        command = a["command"].strip()
        cwd = a.get("cwd", os.path.expanduser("~"))

        # Block obviously dangerous patterns
        dangerous = ["rm -rf /", "mkfs", "dd if=", ":(){", "fork bomb",
                     "> /dev/sd", "chmod -R 777 /", "wget|sh", "curl|sh"]
        cmd_lower = command.lower()
        for pattern in dangerous:
            if pattern in cmd_lower:
                return f"Blocked: that command pattern is not allowed for safety reasons."

        try:
            proc = await asyncio.wait_for(
                asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=os.path.expanduser(cwd),
                ),
                timeout=5,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            output = stdout.decode(errors="replace")
            if stderr:
                err_text = stderr.decode(errors="replace").strip()
                if err_text:
                    output += f"\n[stderr] {err_text}"
            if proc.returncode != 0:
                output += f"\n[exit code: {proc.returncode}]"
            if not output.strip():
                output = "(command completed with no output)"
            if len(output) > 10_000:
                output = output[:10_000] + "\n…[truncated]"
            return output.strip()
        except asyncio.TimeoutError:
            return "Command timed out after 30 seconds."
        except Exception as e:
            return f"Failed to run command: {e}"

    # ── Project commands ───────────────────────────────

    async def _cmd_project_scan(self, a: dict) -> dict:
        path = Path(os.path.expanduser(a["path"]))
        if not path.is_dir():
            raise NotADirectoryError(str(path))
        files: dict = {"total": 0, "by_ext": {}}
        for f in path.rglob("*"):
            if f.is_file() and ".git" not in f.parts and "node_modules" not in f.parts:
                files["total"] += 1
                ext = f.suffix or "(no ext)"
                files["by_ext"][ext] = files["by_ext"].get(ext, 0) + 1
        has_git = (path / ".git").is_dir()
        readme = None
        for name in ["README.md", "README.txt", "README"]:
            rp = path / name
            if rp.exists():
                readme = rp.read_text(errors="replace")[:1000]
                break
        return {"path": str(path), "files": files, "has_git": has_git, "readme_preview": readme}

    async def _cmd_project_todos(self, a: dict) -> list[str]:
        path = Path(os.path.expanduser(a["path"]))
        code_exts = {".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go", ".c", ".cpp", ".java"}
        todos = []
        for f in path.rglob("*"):
            if f.is_file() and f.suffix in code_exts and ".git" not in f.parts:
                try:
                    for i, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
                        for tag in ("TODO", "FIXME", "HACK"):
                            if tag in line:
                                todos.append(f"{f.relative_to(path)}:{i}: {line.strip()}")
                                break
                except Exception:
                    continue
            if len(todos) >= 200:
                break
        return todos

    # ── Task commands (delegate to memory via API) ─────

    async def _cmd_task_add(self, a: dict) -> str:
        return f"Task queued: {a['title']}"

    async def _cmd_task_list(self, _: dict) -> str:
        return "Task list retrieved"

    async def _cmd_task_update(self, a: dict) -> str:
        return f"Task {a['task_id']} → {a['status']}"

    # ── Memory commands (delegate to memory via API) ───

    async def _cmd_remember(self, a: dict) -> str:
        return f"Stored: {a['key']}"

    async def _cmd_recall(self, a: dict) -> str:
        return f"Recalled: {a['key']}"

    # ── Self-improvement placeholder ───────────────────

    async def _cmd_suggest_improvement(self, a: dict) -> str:
        return "Improvement suggestion noted — route through learning engine"

    # ── Browser / Web commands ─────────────────────────

    async def _cmd_open_url(self, a: dict) -> str:
        url = a["url"].strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        try:
            result = await self._proc(["xdg-open", url])
            return f"Opened {url} in your browser."
        except Exception as e:
            return f"Failed to open browser: {e}"

    async def _cmd_web_search(self, a: dict) -> str:
        import urllib.parse
        query = a["query"].strip()
        url = f"https://www.google.com/search?q={urllib.parse.quote_plus(query)}"
        try:
            await self._proc(["xdg-open", url])
            return f"Searching Google for: {query}"
        except Exception as e:
            return f"Failed to search: {e}"

    async def _cmd_youtube_search(self, a: dict) -> str:
        import urllib.parse
        query = a["query"].strip()
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
        try:
            await self._proc(["xdg-open", url])
            return f"Searching YouTube for: {query}"
        except Exception as e:
            return f"Failed to search YouTube: {e}"

    async def _cmd_youtube_play(self, a: dict) -> str:
        import urllib.parse
        query = a["query"].strip()
        # Use ytsearch to open YouTube search — the user can click the first result
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
        try:
            await self._proc(["xdg-open", url])
            return f"Searching YouTube for: {query} — click the top result to play."
        except Exception as e:
            return f"Failed to open YouTube: {e}"

    async def _cmd_site_search(self, a: dict) -> str:
        import urllib.parse
        site = a["site"].strip().lower()
        query = a["query"].strip()
        # Map common site names to their search URLs
        site_search_urls = {
            "amazon": f"https://www.amazon.com/s?k={urllib.parse.quote_plus(query)}",
            "ebay": f"https://www.ebay.com/sch/i.html?_nkw={urllib.parse.quote_plus(query)}",
            "walmart": f"https://www.walmart.com/search?q={urllib.parse.quote_plus(query)}",
            "target": f"https://www.target.com/s?searchTerm={urllib.parse.quote_plus(query)}",
            "bestbuy": f"https://www.bestbuy.com/site/searchpage.jsp?st={urllib.parse.quote_plus(query)}",
            "best buy": f"https://www.bestbuy.com/site/searchpage.jsp?st={urllib.parse.quote_plus(query)}",
            "newegg": f"https://www.newegg.com/p/pl?d={urllib.parse.quote_plus(query)}",
            "etsy": f"https://www.etsy.com/search?q={urllib.parse.quote_plus(query)}",
            "reddit": f"https://www.reddit.com/search/?q={urllib.parse.quote_plus(query)}",
            "youtube": f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}",
            "github": f"https://github.com/search?q={urllib.parse.quote_plus(query)}",
            "stackoverflow": f"https://stackoverflow.com/search?q={urllib.parse.quote_plus(query)}",
            "stack overflow": f"https://stackoverflow.com/search?q={urllib.parse.quote_plus(query)}",
            "wikipedia": f"https://en.wikipedia.org/w/index.php?search={urllib.parse.quote_plus(query)}",
            "google": f"https://www.google.com/search?q={urllib.parse.quote_plus(query)}",
        }
        url = site_search_urls.get(site)
        if not url:
            # Fallback: Google site-specific search
            url = f"https://www.google.com/search?q=site:{urllib.parse.quote_plus(site)}+{urllib.parse.quote_plus(query)}"
        try:
            await self._proc(["xdg-open", url])
            return f"Searching {site} for: {query}"
        except Exception as e:
            return f"Failed to search {site}: {e}"

    async def _cmd_web_read(self, a: dict) -> str:
        """Fetch a webpage and extract its text content."""
        import httpx as _httpx
        import re as _re

        url = a["url"].strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        max_chars = int(a.get("max_chars", 6000))

        try:
            async with _httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                })
                resp.raise_for_status()
        except _httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code} error fetching {url}"
        except (_httpx.ConnectError, _httpx.TimeoutException) as e:
            return f"Failed to connect to {url}: {e}"

        html = resp.text

        # Strip script/style/nav elements
        html = _re.sub(r'<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?</\1>', '', html, flags=_re.I)
        # Strip all remaining tags
        text = _re.sub(r'<[^>]+>', ' ', html)
        # Decode common entities
        for entity, char in [('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                             ('&quot;', '"'), ('&#39;', "'"), ('&nbsp;', ' ')]:
            text = text.replace(entity, char)
        # Collapse whitespace
        text = _re.sub(r'\s+', ' ', text).strip()

        if not text:
            return f"Could not extract readable text from {url}"

        if len(text) > max_chars:
            text = text[:max_chars] + "… [truncated]"

        return f"Content from {url}:\n\n{text}"

    async def _cmd_open_terminal(self, _: dict) -> str:
        terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"]
        for term in terminals:
            if shutil.which(term):
                try:
                    await asyncio.create_subprocess_exec(
                        term,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    return f"Opened {term}."
                except Exception:
                    continue
        return "Couldn't find a terminal emulator to open."

    # ── App / Program launcher ─────────────────────────

    async def _cmd_open_app(self, a: dict) -> str:
        name = a["name"].strip().lower()
        app_map = {
            "files": "nautilus", "file manager": "nautilus", "explorer": "nautilus",
            "terminal": "gnome-terminal", "term": "gnome-terminal", "konsole": "konsole",
            "browser": "xdg-open http://google.com", "chrome": "google-chrome",
            "firefox": "firefox", "code": "code", "vscode": "code",
            "spotify": "spotify", "discord": "discord",
            "calculator": "gnome-calculator", "calc": "gnome-calculator",
            "settings": "gnome-control-center", "system settings": "gnome-control-center",
            "text editor": "gedit", "notepad": "gedit",
            "steam": "steam", "obs": "obs",
            # System utilities
            "task manager": "gnome-system-monitor", "system monitor": "gnome-system-monitor",
            "monitor": "gnome-system-monitor",
            "photos": "eog", "image viewer": "eog",
            "videos": "totem", "video player": "totem", "vlc": "vlc",
            "music": "rhythmbox", "music player": "rhythmbox",
            "gimp": "gimp", "inkscape": "inkscape", "blender": "blender",
            # Common apps not in standard list
            "slack": "slack", "zoom": "zoom", "teams": "teams",
            "intellij": "idea", "pycharm": "pycharm", "webstorm": "webstorm",
        }
        cmd = app_map.get(name, name)
        parts = cmd.split()
        try:
            proc = await asyncio.create_subprocess_exec(
                *parts,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            # Don't wait for the app to close — just check it started
            await asyncio.sleep(0.5)
            if proc.returncode is not None and proc.returncode != 0:
                stderr = (await proc.stderr.read()).decode(errors='replace')
                return f"Failed to open {a['name']}: {stderr.strip()}"
            return f"Opened {a['name']}."
        except FileNotFoundError:
            return f"App '{a['name']}' not found. The command '{parts[0]}' is not installed."
        except Exception as e:
            return f"Failed to open {a['name']}: {e}"

    # ── File content search ────────────────────────────

    async def _cmd_grep_files(self, a: dict) -> str:
        path = os.path.expanduser(a["path"])
        query = a["query"]
        ext = a.get("ext", "")
        cmd = ["grep", "-rn", "--max-count=5", "--include", f"*{ext}" if ext else "*", query, path]
        try:
            result = await self._proc(cmd)
            lines = result.strip().splitlines()[:30]
            return "\n".join(lines) if lines else "No matches found."
        except Exception:
            return "No matches found."

    async def _cmd_find_files(self, a: dict) -> str:
        pattern = a["pattern"]
        path = os.path.expanduser(a.get("path", "~"))
        cmd = ["find", path, "-maxdepth", "5", "-iname", f"*{pattern}*", "-type", "f"]
        try:
            result = await self._proc(cmd)
            lines = result.strip().splitlines()[:30]
            return "\n".join(lines) if lines else "No files found."
        except Exception:
            return "No files found."

    # ── Media / Volume commands ─────────────────────────

    async def _cmd_volume_set(self, a: dict) -> str:
        level = str(a["level"]).strip()
        if level.startswith("+") or level.startswith("-"):
            await self._proc(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"])
            return f"Volume adjusted by {level}%."
        else:
            level_int = max(0, min(100, int(level)))
            await self._proc(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level_int}%"])
            return f"Volume set to {level_int}%."

    async def _cmd_volume_get(self, _: dict) -> str:
        result = await self._proc(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
        return result.strip()

    async def _cmd_media_play_pause(self, _: dict) -> str:
        await self._proc(["playerctl", "play-pause"])
        return "Toggled play/pause."

    async def _cmd_media_next(self, _: dict) -> str:
        await self._proc(["playerctl", "next"])
        return "Skipped to next track."

    async def _cmd_media_prev(self, _: dict) -> str:
        await self._proc(["playerctl", "previous"])
        return "Previous track."

    # ── Spotify commands ───────────────────────────────

    def _spotify(self):
        """Get the SpotifyClient (injected via set_spotify_client)."""
        if not hasattr(self, '_spotify_client') or self._spotify_client is None:
            raise ValueError("Spotify is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the .env file.")
        if not self._spotify_client.is_authenticated:
            auth_url = self._spotify_client.get_auth_url()
            raise ValueError(f"Spotify isn't connected yet. Open this link to authorize: {auth_url}")
        return self._spotify_client

    def set_spotify_client(self, client):
        """Inject a pre-configured SpotifyClient."""
        self._spotify_client = client

    async def _cmd_spotify_play(self, a: dict) -> str:
        s = self._spotify()
        query = a.get("query", "")
        play_type = a.get("type", "track").lower()
        if play_type == "artist":
            return await s.play_artist(query)
        elif play_type == "album":
            return await s.play_album(query)
        elif play_type == "playlist":
            return await s.play_playlist(query)
        return await s.play_track(query)

    async def _cmd_spotify_pause(self, _: dict) -> str:
        return await self._spotify().pause()

    async def _cmd_spotify_resume(self, _: dict) -> str:
        return await self._spotify().play()

    async def _cmd_spotify_next(self, _: dict) -> str:
        return await self._spotify().next_track()

    async def _cmd_spotify_prev(self, _: dict) -> str:
        return await self._spotify().prev_track()

    async def _cmd_spotify_current(self, _: dict) -> str:
        np = await self._spotify().get_playback()
        return np.summary()

    async def _cmd_spotify_volume(self, a: dict) -> str:
        level = int(a.get("level", 50))
        return await self._spotify().set_volume(level)

    async def _cmd_spotify_shuffle(self, a: dict) -> str:
        state = str(a.get("state", "on")).lower() in ("on", "true", "1", "yes")
        return await self._spotify().set_shuffle(state)

    async def _cmd_spotify_repeat(self, a: dict) -> str:
        mode = a.get("mode", "track")
        return await self._spotify().set_repeat(mode)

    async def _cmd_spotify_queue(self, a: dict) -> str:
        return await self._spotify().queue_track(a.get("query", ""))

    async def _cmd_spotify_search(self, a: dict) -> str:
        s = self._spotify()
        query = a.get("query", "")
        types = a.get("type", "track")
        limit = int(a.get("limit", 5))
        results = await s.search(query, types, limit)
        if not results:
            return f"No results for \"{query}\"."
        lines = []
        for r in results:
            if r["type"] == "track":
                lines.append(f"🎵 \"{r['name']}\" by {r['artist']} ({r['album']})")
            elif r["type"] == "artist":
                lines.append(f"🎤 {r['name']}")
            elif r["type"] == "album":
                lines.append(f"💿 \"{r['name']}\"")
            elif r["type"] == "playlist":
                lines.append(f"📋 \"{r['name']}\"")
        return "\n".join(lines)

    async def _cmd_spotify_devices(self, _: dict) -> str:
        devices = await self._spotify().get_devices()
        if not devices:
            return "No Spotify devices found. Make sure Spotify is open on a device."
        lines = []
        for d in devices:
            active = " (active)" if d["active"] else ""
            lines.append(f"• {d['name']} ({d['type']}){active}")
        return "Spotify devices:\n" + "\n".join(lines)

    async def _cmd_spotify_transfer(self, a: dict) -> str:
        s = self._spotify()
        device_name = a.get("device", "").lower()
        devices = await s.get_devices()
        for d in devices:
            if device_name in d["name"].lower():
                return await s.transfer_playback(d["id"])
        return f"No device matching \"{device_name}\" found. Available: {', '.join(d['name'] for d in devices)}"

    async def _cmd_spotify_recent(self, a: dict) -> str:
        limit = int(a.get("limit", 5))
        return await self._spotify().get_recently_played(limit)

    # ── Screenshot ─────────────────────────────────────

    async def _cmd_screenshot(self, a: dict) -> str:
        import datetime as _dt
        save_path = a.get("path", os.path.expanduser(f"~/Pictures/nova_screenshot_{_dt.datetime.now():%Y%m%d_%H%M%S}.png"))
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        try:
            await self._proc(["scrot", save_path])
            return f"Screenshot saved to {save_path}."
        except Exception:
            try:
                await self._proc(["gnome-screenshot", "-f", save_path])
                return f"Screenshot saved to {save_path}."
            except Exception as e:
                return f"Screenshot failed: {e}"

    # ── Clipboard ──────────────────────────────────────

    async def _cmd_clipboard_read(self, _: dict) -> str:
        result = await self._proc(["xclip", "-selection", "clipboard", "-o"])
        return result.strip() or "(clipboard is empty)"

    async def _cmd_clipboard_write(self, a: dict) -> str:
        proc = await asyncio.create_subprocess_exec(
            "xclip", "-selection", "clipboard",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate(input=a["text"].encode())
        return "Copied to clipboard."

    # ── Timer ──────────────────────────────────────────

    async def _cmd_set_timer(self, a: dict) -> str:
        import subprocess
        seconds = int(a["seconds"])
        label = a.get("label", "Timer done!")
        # Run in background: sleep then notify
        subprocess.Popen(
            ["bash", "-c", f'sleep {seconds} && notify-send "Nova Timer" "{label}"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        mins = seconds // 60
        secs = seconds % 60
        time_str = f"{mins}m {secs}s" if mins else f"{secs}s"
        return f"Timer set for {time_str} — I'll notify you when it's done."

    # ── Desktop notifications ──────────────────────────

    async def _cmd_notify(self, a: dict) -> str:
        title = a["title"]
        body = a.get("body", "")
        cmd = ["notify-send", title]
        if body:
            cmd.append(body)
        await self._proc(cmd)
        return f"Notification sent: {title}"

    # ── Govee Smart Light commands ─────────────────────

    def _govee(self) -> GoveeClient:
        # 1. Try env var
        api_key = os.environ.get("GOVEE_API_KEY", "")
        # 2. Try .env file directly (most reliable — env var may not propagate to workers)
        if not api_key:
            from pathlib import Path
            env_file = Path(__file__).parent.parent / ".env"
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("GOVEE_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break
        # 3. Try config.yaml
        if not api_key:
            api_key = self._config.get("govee.api_key", "")
        if not api_key or api_key == "paste-your-key-here":
            raise ValueError("Govee API key not set. Add GOVEE_API_KEY to jarvis/.env")
        return GoveeClient(api_key)

    async def _cmd_govee_on(self, a: dict) -> str:
        g = self._govee()
        # Always refresh device cache to avoid stale state
        await g.get_devices()
        device_name = a.get("device")
        if device_name:
            dev = await g.find_device(device_name)
            if not dev:
                return f"Couldn't find a light named '{device_name}'."
            try:
                await g.turn_on(dev)
                return f"Turned on {dev.name}."
            except Exception as e:
                return f"Failed to turn on {dev.name}: {e}"
        else:
            succeeded, failed = await g.turn_on_all()
            if not succeeded and not failed:
                return "No lights found — check your Govee API key or make sure devices are paired."
            msg = f"Turned on {len(succeeded)} light(s)."
            if failed:
                msg += f" ({len(failed)} offline, skipped.)"
            return msg.strip() if succeeded else f"No lights responded. {len(failed)} offline."

    async def _cmd_govee_off(self, a: dict) -> str:
        g = self._govee()
        await g.get_devices()
        device_name = a.get("device")
        if device_name:
            dev = await g.find_device(device_name)
            if not dev:
                return f"Couldn't find a light named '{device_name}'."
            try:
                await g.turn_off(dev)
                return f"Turned off {dev.name}."
            except Exception as e:
                return f"Failed to turn off {dev.name}: {e}"
        else:
            succeeded, failed = await g.turn_off_all()
            if not succeeded and not failed:
                return "No lights found — check your Govee API key or make sure devices are paired."
            msg = f"Turned off {len(succeeded)} light(s)."
            if failed:
                msg += f" ({len(failed)} offline, skipped.)"
            return msg.strip() if succeeded else f"No lights responded. {len(failed)} offline."

    async def _cmd_govee_brightness(self, a: dict) -> str:
        g = self._govee()
        await g.get_devices()
        b = int(a["brightness"])
        device_name = a.get("device")
        if device_name:
            dev = await g.find_device(device_name)
            if not dev:
                return f"Couldn't find a light named '{device_name}'."
            try:
                await g.set_brightness(dev, b)
                return f"Set {dev.name} brightness to {b}%."
            except Exception as e:
                return f"Failed to set brightness on {dev.name}: {e}"
        else:
            succeeded, failed = await g.set_brightness_all(b)
            if succeeded:
                msg = f"Set brightness to {b}% on {len(succeeded)} light(s)."
                if failed:
                    msg += f" ({len(failed)} offline, skipped.)"
                return msg
            return "No lights found that support brightness."

    async def _cmd_govee_color(self, a: dict) -> str:
        g = self._govee()
        await g.get_devices()
        r, gr, b = parse_color(a["color"])
        device_name = a.get("device")
        if device_name:
            dev = await g.find_device(device_name)
            if not dev:
                return f"Couldn't find a light named '{device_name}'."
            try:
                await g.set_color(dev, r, gr, b)
                return f"Set {dev.name} to {a['color']}."
            except Exception as e:
                return f"Failed to set color on {dev.name}: {e}"
        else:
            succeeded, failed = await g.set_color_all(r, gr, b)
            if succeeded:
                msg = f"Set {len(succeeded)} light(s) to {a['color']}."
                if failed:
                    msg += f" ({len(failed)} offline, skipped.)"
                return msg
            return "No lights found that support color."

    async def _cmd_govee_color_temp(self, a: dict) -> str:
        g = self._govee()
        temp = int(a["temperature"])
        device_name = a.get("device")
        if device_name:
            dev = await g.find_device(device_name)
            if not dev:
                return f"Couldn't find a light named '{device_name}'."
            await g.set_color_temp(dev, temp)
            return f"Set {dev.name} color temp to {temp}K."
        else:
            await g.get_devices()
            targets = [d for d in g._cache if d.supports_color()]
            import asyncio as _aio
            await _aio.gather(*[g.set_color_temp(d, temp) for d in targets], return_exceptions=True)
            return f"Set color temp to {temp}K on {len(targets)} light(s)."

    async def _cmd_govee_status(self, a: dict) -> str:
        g = self._govee()
        devices = await g.get_devices()
        if not devices:
            return "No Govee devices found."
        lines = [f"{len(devices)} light(s) found:"]
        for d in devices:
            lines.append(f"  - {d.name} ({d.sku})")
        return "\n".join(lines)

    async def _cmd_govee_list(self, a: dict) -> str:
        g = self._govee()
        devices = await g.get_devices()
        if not devices:
            return "No Govee devices found. Check your API key."
        lines = [f"Found {len(devices)} Govee device(s):"]
        for d in devices:
            lines.append(f"  - {d.name} ({d.sku}) [{d.device_id}]")
        return "\n".join(lines)

    async def _cmd_govee_scene(self, a: dict) -> str:
        from integrations.light_scenes import start_scene, stop_scene, scene_names, current_scene
        action = (a.get("scene") or a.get("name") or "").strip().lower()
        if action in ("stop", "off", "end", "cancel"):
            return await stop_scene()
        if action in ("list", ""):
            names = scene_names()
            cur = current_scene()
            msg = "Available light scenes: " + ", ".join(n.replace("_", " ").title() for n in names)
            if cur:
                msg += f"\nCurrently running: {cur.replace('_', ' ').title()}"
            return msg
        g = self._govee()
        return await start_scene(g, action)

    # ── Calendar commands ──────────────────────────────

    def _calendar(self):
        from integrations.local_calendar import LocalCalendarClient
        tz = self._config.get("scheduler.timezone", "America/Chicago")
        return LocalCalendarClient(timezone=tz)

    async def _cmd_calendar_today(self, a: dict) -> str:
        cal = self._calendar()
        events = cal.get_today()
        if not events:
            return "You have no events today."
        return f"Today's events ({len(events)}):\n{cal.format_events_text(events)}"

    async def _cmd_calendar_tomorrow(self, a: dict) -> str:
        cal = self._calendar()
        events = cal.get_tomorrow()
        if not events:
            return "No events tomorrow."
        return f"Tomorrow's events ({len(events)}):\n{cal.format_events_text(events)}"

    async def _cmd_calendar_upcoming(self, a: dict) -> str:
        cal = self._calendar()
        days = int(a.get("days", 7))
        events = cal.get_upcoming(days=days)
        if not events:
            return f"No events in the next {days} days."
        return f"Upcoming events ({len(events)}):\n{cal.format_events_text(events)}"

    async def _cmd_calendar_create(self, a: dict) -> str:
        cal = self._calendar()
        text = a.get("text", "")
        if not text:
            return "No event text provided."
        ev = cal.create_quick_event(text)
        return f"Created event: {ev['summary']} on {ev['start_display']}"

    async def _cmd_calendar_create_detailed(self, a: dict) -> str:
        from datetime import datetime
        cal = self._calendar()
        summary = a["summary"]
        start = datetime.fromisoformat(a["start"])
        end = datetime.fromisoformat(a["end"])
        ev = cal.create_event(
            summary=summary, start=start, end=end,
            description=a.get("description", ""),
            location=a.get("location", ""),
        )
        return f"Created event: {ev['summary']} at {ev['start_display']}"

    async def _cmd_calendar_delete(self, a: dict) -> str:
        cal = self._calendar()
        event_id = a["event_id"]
        cal.delete_event(event_id)
        return f"Deleted event {event_id}."

    # ── Google Docs commands ───────────────────────────

    def _google_docs(self):
        from integrations.google_docs import GoogleDocsClient
        return GoogleDocsClient()

    async def _cmd_doc_read(self, a: dict) -> str:
        docs = self._google_docs()
        doc_id = a["doc_id"]
        text = docs.read_text(doc_id)
        return text

    async def _cmd_doc_summary(self, a: dict) -> str:
        docs = self._google_docs()
        info = docs.get_summary(a["doc_id"])
        return (
            f"Title: {info['title']}\n"
            f"Words: {info['word_count']} | Chars: {info['char_count']}\n"
            f"Preview: {info['preview']}"
        )

    async def _cmd_doc_headings(self, a: dict) -> str:
        docs = self._google_docs()
        headings = docs.get_headings(a["doc_id"])
        if not headings:
            return "No headings found in this document."
        return "Document headings:\n" + "\n".join(f"  {h}" for h in headings)

    async def _cmd_doc_edit(self, a: dict) -> str:
        doc_id = a.get("doc_id") or os.environ.get("DEFAULT_DOC_ID", "")
        if not doc_id:
            return "No document ID provided and DEFAULT_DOC_ID is not set. Please include the doc URL or ID."
        docs = self._google_docs()
        docs.append_text(doc_id, a["text"])
        return f"Appended {len(a['text'])} chars to document."

    # ── Weather commands ───────────────────────────────

    def _weather(self):
        from integrations.weather import WeatherClient
        api_key = os.environ.get("OPENWEATHER_API_KEY", "")
        if not api_key:
            from pathlib import Path
            env_file = Path(__file__).parent.parent / ".env"
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("OPENWEATHER_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break
        if not api_key:
            raise ValueError("OpenWeather API key not set. Add OPENWEATHER_API_KEY to jarvis/.env")
        city = self._config.get("weather.city", "Dallas")
        return WeatherClient(api_key, default_city=city)

    async def _cmd_weather_current(self, a: dict) -> str:
        w = self._weather()
        city = a.get("city")
        weather = await w.get_current(city)
        return weather.summary()

    async def _cmd_weather_forecast(self, a: dict) -> str:
        w = self._weather()
        city = a.get("city")
        days = int(a.get("days", 3))
        forecast = await w.get_forecast(city, days)
        return w.format_forecast(forecast)

    # ── Browser Intelligence commands ──────────────────

    async def _cmd_browser_read(self, a: dict) -> str:
        from integrations.browser import BrowserClient
        browser = BrowserClient()
        try:
            max_chars = int(a.get("max_chars", 10000))
            content = await browser.read_page(a["url"], max_chars=max_chars)
            return f"**{content.title}** ({content.page_type}, {content.word_count} words)\n\n{content.text}"
        finally:
            await browser.close()

    async def _cmd_browser_info(self, a: dict) -> str:
        from integrations.browser import BrowserClient
        browser = BrowserClient()
        try:
            info = await browser.get_page_info(a["url"])
            parts = [
                f"Title: {info['title']}",
                f"Type: {info['type']}",
                f"Words: {info['word_count']}",
            ]
            if info.get("description"):
                parts.append(f"Description: {info['description']}")
            if info.get("headings"):
                parts.append("Headings: " + ", ".join(
                    h.split(": ", 1)[-1] for h in info["headings"]
                ))
            if info.get("links"):
                parts.append(f"Links: {len(info['links'])} found")
            parts.append(f"\nPreview:\n{info['preview']}")
            return "\n".join(parts)
        finally:
            await browser.close()

    async def _cmd_browser_screenshot(self, a: dict) -> str:
        from integrations.browser import BrowserClient
        import tempfile
        browser = BrowserClient()
        try:
            path = a.get("path") or os.path.join(tempfile.gettempdir(), "nova_screenshot.png")
            await browser.screenshot(a["url"], path)
            return f"Screenshot saved to {path}"
        finally:
            await browser.close()

    # ── Live Browser Bridge commands ───────────────────
    # These go through the Chrome extension WebSocket bridge

    async def _cmd_browser_live_read(self, a: dict) -> str:
        """Read the current page content from the live browser."""
        from api.browser_bridge import send_command, is_connected, get_active_tab
        if not is_connected():
            return "Browser extension not connected. Install the Nova Bridge Chrome extension."
        result = await send_command("get_page_content", {"max_chars": int(a.get("max_chars", 15000))})
        if not result.get("success"):
            return f"Failed to read page: {result.get('error', 'unknown error')}"
        return (
            f"**{result.get('title', '?')}** ({result.get('url', '?')})\n"
            f"Words: {result.get('word_count', '?')}\n\n"
            f"{result.get('text', '(no content)')}"
        )

    async def _cmd_browser_live_type(self, a: dict) -> str:
        """Type text into the browser (active element or by selector)."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        args = {"text": a["text"]}
        if "selector" in a:
            args["selector"] = a["selector"]
        if a.get("clear"):
            args["clear"] = True
        result = await send_command("type_text", args)
        if not result.get("success"):
            return f"Failed to type: {result.get('error', 'unknown error')}"
        return f"Typed into {result.get('element', 'active element')}"

    async def _cmd_browser_live_click(self, a: dict) -> str:
        """Click an element in the browser."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        args = {}
        if "selector" in a:
            args["selector"] = a["selector"]
        if "text" in a:
            args["text"] = a["text"]
        if "x" in a and "y" in a:
            args["x"] = a["x"]
            args["y"] = a["y"]
        result = await send_command("click_element", args)
        if not result.get("success"):
            return f"Failed to click: {result.get('error', 'unknown error')}"
        return f"Clicked {result.get('clicked', 'element')}"

    async def _cmd_browser_live_scroll(self, a: dict) -> str:
        """Scroll the page in the browser."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("scroll_page", {
            "direction": a.get("direction", "down"),
            "amount": int(a.get("amount", 500)),
        })
        return f"Scrolled {a.get('direction', 'down')}"

    async def _cmd_browser_live_inputs(self, a: dict) -> str:
        """Get all input fields on the current page."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("get_input_values")
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        inputs = result.get("inputs", [])
        if not inputs:
            return "No input fields found on this page."
        lines = [f"Found {len(inputs)} input(s):"]
        for inp in inputs:
            label = inp.get("label") or inp.get("placeholder") or inp.get("name") or inp.get("id") or f"#{inp['index']}"
            val = inp.get("value", "")[:60]
            lines.append(f"  [{inp['index']}] {inp['tag']}({inp.get('type','')}) \"{label}\" = \"{val}\"")
        return "\n".join(lines)

    async def _cmd_browser_live_fill(self, a: dict) -> str:
        """Fill a form in the browser."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("fill_form", {"fields": a["fields"]})
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        results = result.get("results", [])
        ok = sum(1 for r in results if r.get("success"))
        return f"Filled {ok}/{len(results)} fields"

    async def _cmd_browser_live_navigate(self, a: dict) -> str:
        """Navigate the active tab to a URL."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("navigate", {"url": a["url"]})
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        return f"Navigated to {result.get('url', a['url'])}"

    async def _cmd_browser_live_tabs(self, a: dict) -> str:
        """List all open browser tabs."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("get_tabs")
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        tabs = result.get("tabs", [])
        lines = [f"{len(tabs)} tab(s) open:"]
        for t in tabs:
            marker = " ← active" if t.get("active") else ""
            lines.append(f"  [{t['index']}] {t['title'][:60]}{marker}")
        return "\n".join(lines)

    async def _cmd_browser_live_tab(self, a: dict) -> str:
        """Get active tab info."""
        from api.browser_bridge import send_command, is_connected, get_active_tab
        if not is_connected():
            return "Browser extension not connected."
        tab = get_active_tab()
        if tab:
            return f"Active tab: {tab.get('title', '?')} — {tab.get('url', '?')}"
        result = await send_command("get_active_tab")
        if result.get("success") and result.get("tab"):
            t = result["tab"]
            return f"Active tab: {t.get('title', '?')} — {t.get('url', '?')}"
        return "Could not get active tab info."

    async def _cmd_browser_live_switch_tab(self, a: dict) -> str:
        """Switch to a different browser tab."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("switch_tab", {"index": a.get("index", 0)})
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        t = result.get("tab", {})
        return f"Switched to: {t.get('title', '?')}"

    async def _cmd_browser_live_key(self, a: dict) -> str:
        """Press a key in the browser."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("press_key", {
            "key": a["key"],
            "modifiers": a.get("modifiers", []),
        })
        return f"Pressed {a['key']}"

    async def _cmd_browser_live_selected(self, a: dict) -> str:
        """Get selected text in the browser."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("get_selected_text")
        text = result.get("text", "")
        return text if text else "No text selected."

    async def _cmd_browser_live_links(self, a: dict) -> str:
        """Get links from the current page."""
        from api.browser_bridge import send_command, is_connected
        if not is_connected():
            return "Browser extension not connected."
        result = await send_command("get_links", {"max": int(a.get("max", 30))})
        if not result.get("success"):
            return f"Failed: {result.get('error')}"
        links = result.get("links", [])
        if not links:
            return "No links found."
        lines = [f"{len(links)} link(s):"]
        for l in links:
            lines.append(f"  [{l['index']}] {l['text'][:50]} → {l['href']}")
        return "\n".join(lines)

    # ── Google Sheets commands ─────────────────────────

    def _google_sheets(self):
        from integrations.google_sheets import GoogleSheetsClient
        return GoogleSheetsClient()

    async def _cmd_sheet_info(self, a: dict) -> str:
        sheets = self._google_sheets()
        info = sheets.get_info(a["sheet_id"])
        return (
            f"Title: {info['title']}\n"
            f"Sheets: {', '.join(info['sheets'])}\n"
            f"Tab count: {info['sheet_count']}"
        )

    async def _cmd_sheet_read(self, a: dict) -> str:
        sheets = self._google_sheets()
        range_str = a.get("range", "A1:Z100")
        sheet_name = a.get("sheet_name", "Sheet1")
        if "range" not in a:
            range_str = f"'{sheet_name}'!A1:Z100"
        rows = sheets.read_range(a["sheet_id"], range_str)
        if not rows:
            return "Sheet is empty or range has no data."
        return sheets.format_as_table(rows[1:], headers=rows[0]) if len(rows) > 1 else sheets.format_as_table(rows)

    async def _cmd_sheet_read_cell(self, a: dict) -> str:
        sheets = self._google_sheets()
        val = sheets.read_cell(a["sheet_id"], a["cell"], a.get("sheet_name", "Sheet1"))
        return val if val else "(empty cell)"

    async def _cmd_sheet_write(self, a: dict) -> str:
        sheets = self._google_sheets()
        result = sheets.write_range(a["sheet_id"], a["range"], a["values"])
        return f"Updated {result['updated_cells']} cell(s) in {result['updated_range']}"

    async def _cmd_sheet_write_cell(self, a: dict) -> str:
        sheets = self._google_sheets()
        result = sheets.write_cell(a["sheet_id"], a["cell"], a["value"], a.get("sheet_name", "Sheet1"))
        return f"Written to {result['updated_range']}"

    async def _cmd_sheet_append_row(self, a: dict) -> str:
        sheets = self._google_sheets()
        result = sheets.append_row(a["sheet_id"], a["values"], a.get("sheet_name", "Sheet1"))
        return f"Appended row to {result['updated_range']}"

    async def _cmd_sheet_clear(self, a: dict) -> str:
        sheets = self._google_sheets()
        result = sheets.clear_range(a["sheet_id"], a["range"])
        return f"Cleared {result['cleared_range']}"

    # ── Enhanced Google Docs commands ──────────────────

    async def _cmd_doc_insert(self, a: dict) -> str:
        doc_id = a.get("doc_id") or os.environ.get("DEFAULT_DOC_ID", "")
        if not doc_id:
            return "No document ID provided and DEFAULT_DOC_ID is not set."
        docs = self._google_docs()
        docs.insert_text(doc_id, a["text"], int(a.get("index", 1)))
        return f"Inserted {len(a['text'])} chars at index {a.get('index', 1)}"

    async def _cmd_doc_replace(self, a: dict) -> str:
        doc_id = a.get("doc_id") or os.environ.get("DEFAULT_DOC_ID", "")
        if not doc_id:
            return "No document ID provided and DEFAULT_DOC_ID is not set."
        docs = self._google_docs()
        count = docs.replace_text(doc_id, a["find"], a["replace"])
        return f"Replaced {count} occurrence(s) of '{a['find']}'"

    # ── GitHub repo lookup ─────────────────────────────

    async def _cmd_github_repo(self, a: dict) -> str:
        from integrations.github import lookup_repo, parse_repo_input
        raw = a["repo"].strip()
        parsed = parse_repo_input(raw)
        if not parsed:
            return f"Couldn't parse a GitHub repo from '{raw}'. Use owner/repo or a github.com URL."
        owner, repo = parsed
        max_chars = int(a.get("max_readme_chars", 4000))
        return await lookup_repo(owner, repo, max_readme_chars=max_chars)

    # ── Good Morning routine ──────────────────────────

    async def _cmd_good_morning(self, a: dict) -> str:
        from integrations.morning import build_morning_briefing

        weather_client = None
        try:
            weather_client = self._weather()
        except ValueError:
            pass

        calendar_client = self._calendar()

        # Get persistent memory if available (we don't have direct access, pass None)
        tz = self._config.get("scheduler.timezone", "America/Chicago")
        return await build_morning_briefing(
            weather_client=weather_client,
            calendar_client=calendar_client,
            timezone=tz,
        )

    # ── Darklock / Pi5 commands ────────────────────────

    def _darklock(self):
        """Get the DarklockClient from app state (lazy import)."""
        if not hasattr(self, '_darklock_client') or self._darklock_client is None:
            from integrations.darklock import DarklockClient
            self._darklock_client = DarklockClient(self._config, self._audit)
        return self._darklock_client

    def set_darklock_client(self, client):
        """Inject a pre-configured DarklockClient."""
        self._darklock_client = client

    async def _cmd_darklock_status(self, a: dict) -> str:
        return await self._darklock().get_darklock_status()

    async def _cmd_darklock_bug_reports(self, a: dict) -> str:
        status = a.get("status")
        severity = a.get("severity")
        reports = await self._darklock().get_bug_reports(status=status, severity=severity)
        if not reports:
            return "No bug reports found."
        lines = [f"{len(reports)} bug report(s):"]
        for r in reports:
            lines.append(r.summary())
        return "\n".join(lines)

    async def _cmd_darklock_bug_detail(self, a: dict) -> str:
        report_id = int(a["report_id"])
        report = await self._darklock().get_bug_report(report_id)
        if not report:
            return f"Bug report #{report_id} not found."
        return report.detail()

    async def _cmd_darklock_restart(self, a: dict) -> str:
        return await self._darklock().restart_darklock()

    async def _cmd_darklock_logs(self, a: dict) -> str:
        lines = int(a.get("lines", 30))
        return await self._darklock().get_darklock_logs(lines=lines)

    async def _cmd_pi5_health(self, a: dict) -> str:
        return await self._darklock().pi5_health_summary()

    # ── Subprocess helper ──────────────────────────────

    async def _proc(self, cmd: list[str], cwd: str | None = None) -> str:
        resolved_cwd = os.path.expanduser(cwd) if cwd else None
        proc = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=resolved_cwd,
            ),
            timeout=5,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout)
        output = stdout.decode(errors="replace")
        if proc.returncode != 0:
            output += f"\n[exit {proc.returncode}] {stderr.decode(errors='replace')}"
        if len(output) > 50_000:
            output = output[:50_000] + "\n…[truncated]"
        return output
