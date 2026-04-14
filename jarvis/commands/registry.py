"""
Nova — Command Registry
================================
Whitelist of every command the AI is allowed to request.
Each command has a name, description, risk level, and required/optional args.
"""

from dataclasses import dataclass, field


@dataclass
class CommandDef:
    name: str
    description: str
    risk: str  # "low" | "medium" | "high"
    required_args: list[str] = field(default_factory=list)
    optional_args: list[str] = field(default_factory=list)
    requires_approval: bool = False


class CommandRegistry:
    """Central registry of all allowed commands."""

    def __init__(self):
        self._commands: dict[str, CommandDef] = {}
        self._register_defaults()

    def _register_defaults(self):
        defs = [
            # ── File operations ────────────────────────
            CommandDef("file_read", "Read contents of a file", "low",
                       required_args=["path"]),
            CommandDef("file_write", "Write content to a file (restricted dirs)", "medium",
                       required_args=["path", "content"], requires_approval=True),
            CommandDef("file_list", "List files in a directory", "low",
                       required_args=["path"]),
            CommandDef("file_search", "Search for files by glob pattern", "low",
                       required_args=["path", "pattern"]),

            # ── Git operations ─────────────────────────
            CommandDef("git_status", "Show git status", "low",
                       required_args=["path"]),
            CommandDef("git_log", "Show recent commits", "low",
                       required_args=["path"], optional_args=["limit"]),
            CommandDef("git_diff", "Show git diff", "low",
                       required_args=["path"], optional_args=["file"]),
            CommandDef("git_commit", "Stage all and commit", "medium",
                       required_args=["path", "message"], requires_approval=True),
            CommandDef("git_branch", "List or create branches", "low",
                       required_args=["path"], optional_args=["name"]),

            # ── System info ────────────────────────────
            CommandDef("system_status", "CPU, memory, disk usage", "low"),
            CommandDef("system_time", "Current date and time", "low"),
            CommandDef("system_processes", "Top processes by CPU", "low"),

            # ── Script execution ───────────────────────
            CommandDef("run_script", "Run a pre-approved script (sandboxed)", "high",
                       required_args=["script"], optional_args=["args"],
                       requires_approval=True),

            # ── Terminal / Shell ────────────────────────
            CommandDef("run_command", "Run a shell command and return its output", "medium",
                       required_args=["command"], optional_args=["cwd"]),
            CommandDef("open_terminal", "Open a terminal window", "low"),

            # ── Project management ─────────────────────
            CommandDef("project_scan", "Scan and summarize a project directory", "low",
                       required_args=["path"]),
            CommandDef("project_todos", "Extract TODO/FIXME comments", "low",
                       required_args=["path"]),

            # ── Task tracking ──────────────────────────
            CommandDef("task_add", "Add a new task", "low",
                       required_args=["title"], optional_args=["description", "priority"]),
            CommandDef("task_list", "List tasks", "low",
                       optional_args=["status"]),
            CommandDef("task_update", "Update task status", "low",
                       required_args=["task_id", "status"]),

            # ── Self-improvement ───────────────────────
            CommandDef("suggest_improvement", "Suggest code change (diff preview)", "high",
                       required_args=["file", "description"],
                       requires_approval=True),

            # ── Memory ─────────────────────────────────
            CommandDef("remember", "Store a key-value in memory", "low",
                       required_args=["key", "value"]),
            CommandDef("recall", "Recall a value from memory", "low",
                       required_args=["key"]),

            # ── Browser / Web ──────────────────────────
            CommandDef("open_url", "Open a URL in the user's default browser", "low",
                       required_args=["url"]),
            CommandDef("web_search", "Search the web (opens browser with search query)", "low",
                       required_args=["query"]),
            CommandDef("youtube_search", "Search YouTube and open results in browser", "low",
                       required_args=["query"]),
            CommandDef("youtube_play", "Play a specific YouTube search query (opens first-ish result)", "low",
                       required_args=["query"]),
            CommandDef("site_search", "Search within a specific website (Amazon, eBay, etc.)", "low",
                       required_args=["site", "query"]),
            CommandDef("web_read", "Fetch and read the text content of a webpage", "low",
                       required_args=["url"], optional_args=["max_chars"]),

            # ── App / Program launcher ─────────────────
            CommandDef("open_app", "Open an application by name", "low",
                       required_args=["name"]),

            # ── File content search ────────────────────
            CommandDef("grep_files", "Search file contents for a string/regex", "low",
                       required_args=["path", "query"], optional_args=["ext"]),
            CommandDef("find_files", "Find files by name pattern anywhere", "low",
                       required_args=["pattern"], optional_args=["path"]),

            # ── Media / Volume ─────────────────────────
            CommandDef("volume_set", "Set system volume 0-100", "low",
                       required_args=["level"]),
            CommandDef("volume_get", "Get current system volume", "low"),
            CommandDef("media_play_pause", "Toggle play/pause media", "low"),
            CommandDef("media_next", "Skip to next track", "low"),
            CommandDef("media_prev", "Go to previous track", "low"),

            # ── Spotify ────────────────────────────────
            CommandDef("spotify_play", "Play a song/artist/album/playlist on Spotify by search query", "low",
                       required_args=["query"], optional_args=["type"]),
            CommandDef("spotify_pause", "Pause Spotify playback", "low"),
            CommandDef("spotify_resume", "Resume Spotify playback", "low"),
            CommandDef("spotify_next", "Skip to next track on Spotify", "low"),
            CommandDef("spotify_prev", "Go to previous track on Spotify", "low"),
            CommandDef("spotify_current", "Get currently playing track on Spotify", "low"),
            CommandDef("spotify_volume", "Set Spotify volume 0-100", "low",
                       required_args=["level"]),
            CommandDef("spotify_shuffle", "Toggle Spotify shuffle on/off", "low",
                       required_args=["state"]),
            CommandDef("spotify_repeat", "Set Spotify repeat mode (track/context/off)", "low",
                       optional_args=["mode"]),
            CommandDef("spotify_queue", "Add a track to the Spotify queue", "low",
                       required_args=["query"]),
            CommandDef("spotify_search", "Search Spotify for tracks/artists/albums/playlists", "low",
                       required_args=["query"], optional_args=["type", "limit"]),
            CommandDef("spotify_devices", "List available Spotify playback devices", "low"),
            CommandDef("spotify_transfer", "Transfer Spotify playback to a different device", "low",
                       required_args=["device"]),
            CommandDef("spotify_recent", "Get recently played tracks on Spotify", "low",
                       optional_args=["limit"]),

            # ── Screenshot ─────────────────────────────
            CommandDef("screenshot", "Take a screenshot and save it", "low",
                       optional_args=["path"]),

            # ── Clipboard ──────────────────────────────
            CommandDef("clipboard_read", "Read current clipboard contents", "low"),
            CommandDef("clipboard_write", "Write text to clipboard", "low",
                       required_args=["text"]),

            # ── Timer / Reminder ───────────────────────
            CommandDef("set_timer", "Set a countdown timer (seconds)", "low",
                       required_args=["seconds"], optional_args=["label"]),

            # ── Notifications ──────────────────────────
            CommandDef("notify", "Send a desktop notification", "low",
                       required_args=["title"], optional_args=["body"]),

            # ── Govee Smart Lights ─────────────────────
            CommandDef("govee_on", "Turn on Govee light (optional: device name)", "low",
                       optional_args=["device"]),
            CommandDef("govee_off", "Turn off Govee light (optional: device name)", "low",
                       optional_args=["device"]),
            CommandDef("govee_brightness", "Set Govee light brightness 0-100", "low",
                       required_args=["brightness"], optional_args=["device"]),
            CommandDef("govee_color", "Set Govee light color (name like red/blue or hex #FF0000)", "low",
                       required_args=["color"], optional_args=["device"]),
            CommandDef("govee_color_temp", "Set Govee light color temperature in Kelvin", "low",
                       required_args=["temperature"], optional_args=["device"]),
            CommandDef("govee_status", "Get Govee light status (on/off, brightness, color)", "low",
                       optional_args=["device"]),
            CommandDef("govee_list", "List all Govee light devices", "low"),
            CommandDef("govee_scene", "Start/stop/list cinematic light scenes", "low",
                       optional_args=["scene", "name"]),

            # ── Google Calendar ────────────────────────
            CommandDef("calendar_today", "Get today's calendar events", "low"),
            CommandDef("calendar_tomorrow", "Get tomorrow's calendar events", "low"),
            CommandDef("calendar_upcoming", "Get upcoming events (next N days)", "low",
                       optional_args=["days"]),
            CommandDef("calendar_create", "Create a calendar event (natural language)", "low",
                       required_args=["text"]),
            CommandDef("calendar_create_detailed", "Create event with specific times", "medium",
                       required_args=["summary", "start", "end"],
                       optional_args=["description", "location"]),
            CommandDef("calendar_delete", "Delete a calendar event by ID", "medium",
                       required_args=["event_id"], requires_approval=True),

            # ── Google Docs ────────────────────────────
            CommandDef("doc_read", "Read a Google Doc by ID or URL", "low",
                       required_args=["doc_id"]),
            CommandDef("doc_summary", "Get summary of a Google Doc", "low",
                       required_args=["doc_id"]),
            CommandDef("doc_headings", "Get headings from a Google Doc", "low",
                       required_args=["doc_id"]),
            CommandDef("doc_edit", "Append text to a Google Doc (requires approval)", "medium",
                       required_args=["doc_id", "text"], requires_approval=True),

            # ── Weather ────────────────────────────────
            CommandDef("weather_current", "Get current weather conditions", "low",
                       optional_args=["city"]),
            CommandDef("weather_forecast", "Get multi-day weather forecast", "low",
                       optional_args=["city", "days"]),

            # ── Browser Intelligence ───────────────────
            CommandDef("browser_read", "Read and extract content from a webpage", "low",
                       required_args=["url"], optional_args=["max_chars"]),
            CommandDef("browser_info", "Get structured info about a webpage (headings, links, type)", "low",
                       required_args=["url"]),
            CommandDef("browser_screenshot", "Take a screenshot of a webpage", "low",
                       required_args=["url"], optional_args=["path"]),

            # ── GitHub ──────────────────────────────────
            CommandDef("github_repo", "Look up a GitHub repository and summarize it", "low",
                       required_args=["repo"], optional_args=["max_readme_chars"]),

            # ── Good Morning ───────────────────────────
            CommandDef("good_morning", "Run the morning briefing routine", "low"),

            # ── Darklock / Pi5 ─────────────────────────
            CommandDef("darklock_status", "Check Darklock server and Pi5 health status", "low"),
            CommandDef("darklock_bug_reports", "List bug reports from Darklock admin dashboard", "low",
                       optional_args=["status", "severity"]),
            CommandDef("darklock_bug_detail", "Get details of a specific bug report", "low",
                       required_args=["report_id"]),
            CommandDef("darklock_restart", "Restart Darklock service on Pi5 via SSH", "high",
                       requires_approval=True),
            CommandDef("darklock_logs", "Get recent Darklock service logs from Pi5", "low",
                       optional_args=["lines"]),
            CommandDef("pi5_health", "Run full health check on Raspberry Pi 5", "low"),
        ]
        for d in defs:
            self._commands[d.name] = d

    def get(self, name: str) -> CommandDef | None:
        return self._commands.get(name)

    def exists(self, name: str) -> bool:
        return name in self._commands

    def list_commands(self) -> list[dict]:
        return [
            {
                "name": c.name,
                "description": c.description,
                "risk": c.risk,
                "required_args": c.required_args,
                "optional_args": c.optional_args,
                "requires_approval": c.requires_approval,
            }
            for c in self._commands.values()
        ]
