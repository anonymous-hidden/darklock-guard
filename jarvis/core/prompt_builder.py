"""
Nova — Prompt Builder
======================
Constructs the full system prompt from personality, commands, memory,
emotions, and project context.

Dynamic trimming: only injects context sections relevant to the user's
current message, keeping the prompt lean for the model.
"""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from commands.registry import CommandRegistry
from core.personality import Personality
from memory.store import MemoryStore

# ── Intent detection for dynamic prompt trimming ──────────────────────────────

_INTENT_SMART_HOME = re.compile(
    r'\b(?:light|lamp|led|brightness|govee|color|colour|scene|turn\s+(?:on|off))\b', re.I)
_INTENT_WEATHER = re.compile(
    r'\b(?:weather|temperature|forecast|outside|rain|snow|cold|hot|humid)\b', re.I)
_INTENT_BROWSER = re.compile(
    r'\b(?:open|search|google|youtube|browse|website|url|web|page|read\s+(?:the|this))\b', re.I)
_INTENT_GITHUB = re.compile(
    r'\b(?:github|repo(?:sitory)?|git\s+repo|pull\s+request|commit|stars?|forks?)\b|github\.com/', re.I)
_INTENT_TERMINAL = re.compile(
    r'\b(?:terminal|shell|command|run\s|execute|bash|npm|pip|git\s+(?:status|log|diff|push|pull))\b', re.I)
_INTENT_CALENDAR = re.compile(
    r'\b(?:calendar|schedule|event|appointment|meeting|agenda)\b', re.I)
_INTENT_MEDIA = re.compile(
    r'\b(?:volume|mute|play|pause|skip|next\s+(?:track|song)|media|music|song)\b', re.I)
_INTENT_TIMER = re.compile(
    r'\b(?:timer|alarm|remind|countdown|set\s+(?:a\s+)?timer)\b', re.I)
_INTENT_PROJECT = re.compile(
    r'\b(?:project|codebase|workspace|index|scan|todo|fixme)\b', re.I)


def _detect_intents(message: str) -> set[str]:
    """Return a set of intent tags present in the user message."""
    intents = set()
    if _INTENT_SMART_HOME.search(message):
        intents.add("smart_home")
    if _INTENT_WEATHER.search(message):
        intents.add("weather")
    if _INTENT_BROWSER.search(message):
        intents.add("browser")
    if _INTENT_GITHUB.search(message):
        intents.add("github")
    if _INTENT_TERMINAL.search(message):
        intents.add("terminal")
    if _INTENT_CALENDAR.search(message):
        intents.add("calendar")
    if _INTENT_MEDIA.search(message):
        intents.add("media")
    if _INTENT_TIMER.search(message):
        intents.add("timer")
    if _INTENT_PROJECT.search(message):
        intents.add("project")
    return intents


class PromptBuilder:
    def __init__(self, personality: Personality, registry: CommandRegistry, memory: MemoryStore):
        self._personality = personality
        self._registry = registry
        self._memory = memory
        # These are set after construction by main.py
        self._persistent_memory = None
        self._emotional_engine = None
        self._project_indexer = None
        self._weather_provider = None
        self._spotify_provider = None
        self._identity_core = None
        self._session_continuity = None
        self._supervised_learning = None
        self._tool_registry = None
        self._system_monitor = None
        self._goal_tracker = None
        self._skill_memory = None
        self._conversation_awareness = None
        self._config = None    # set by main via set_config()

    def set_persistent_memory(self, pm):
        self._persistent_memory = pm

    def set_emotional_engine(self, ee):
        self._emotional_engine = ee

    def set_project_indexer(self, pi):
        self._project_indexer = pi

    def set_weather_provider(self, wp):
        self._weather_provider = wp

    def set_spotify_provider(self, sp):
        self._spotify_provider = sp

    def set_identity_core(self, ic):
        self._identity_core = ic

    def set_session_continuity(self, sc):
        self._session_continuity = sc

    def set_supervised_learning(self, sl):
        self._supervised_learning = sl

    def set_tool_registry(self, tr):
        self._tool_registry = tr

    def set_system_monitor(self, sm):
        self._system_monitor = sm

    def set_goal_tracker(self, gt):
        self._goal_tracker = gt

    def set_skill_memory(self, skm):
        self._skill_memory = skm

    def set_conversation_awareness(self, ca):
        self._conversation_awareness = ca

    def set_config(self, cfg):
        self._config = cfg

    def build(self, extra_context: dict | None = None, user_message: str = "",
              platform: str = "desktop", conversation_id: int | None = None) -> str:
        """Build the complete system prompt with all context layers.
        
        Order is intentional and sacred:
          1. Identity anchor (who Nova IS) — ALWAYS FIRST
          2. Personality tone
          3. Voice examples (intent-matched)
          4. Commands, domain instructions, context layers
          5. Identity continuity footer — ALWAYS LAST
        """
        intents = _detect_intents(user_message) if user_message else set()
        is_general_chat = len(intents) == 0

        now = datetime.now(ZoneInfo("America/Chicago"))
        date_str = now.strftime('%A, %B %-d, %Y')
        time_str = now.strftime('%-I:%M %p')
        date_line = (
            f"TODAY'S DATE AND TIME (authoritative — never guess or say you don't know): "
            f"{date_str}, {time_str} CST. "
            f"When anyone asks what day, date, or time it is, answer with this exact information."
        )

        parts = [date_line]

        # ── 1. Identity Core — ALWAYS FIRST, no exceptions ──
        if self._identity_core:
            parts.append(self._identity_core.build_identity_prompt(platform))

        # ── 1b. GROUNDING RULE — anti-hallucination (critical for small models) ──
        parts.append(
            "## GROUNDING RULE (NEVER VIOLATE)\n"
            "You may ONLY reference facts, events, tasks, reminders, activities, "
            "and data that are EXPLICITLY present in this system prompt or the "
            "conversation history below. If no real data exists for something the "
            "user asks about, say so honestly — e.g. \"I don't have any record of "
            "that\" or \"I don't have your schedule data right now.\" "
            "NEVER fabricate summaries, daily activities, calendar events, task "
            "completions, reminders, meetings, or any other information. Making "
            "things up destroys trust. When in doubt, say you don't know."
        )

        # ── 1c. REASONING & THINKING — advanced cognition rules ──
        parts.append(
            "## HOW YOU THINK (advanced reasoning)\n"
            "Before answering complex questions, THINK STEP BY STEP internally:\n"
            "1. What is Cayden actually asking? Look past the surface words.\n"
            "2. What do I know for certain vs what am I uncertain about?\n"
            "3. Are there multiple angles to consider? What are the tradeoffs?\n"
            "4. What would the most helpful, accurate answer look like?\n"
            "5. Am I making any assumptions? Flag them if so.\n\n"
            "For technical problems: break them down, consider edge cases, think about "
            "why something might be happening (not just what). Propose the real fix, "
            "not a band-aid.\n\n"
            "For creative requests: invest real thought. Don't give surface-level generic "
            "responses. Add depth, nuance, and your own perspective.\n\n"
            "For opinions: have real ones. Weigh pros and cons, then take a stance. "
            "\"It depends\" is lazy — commit to a recommendation with reasoning.\n\n"
            "You learn from EVERY conversation. When Cayden corrects you, teaches you "
            "something, or shows a preference, internalize it permanently. Notice patterns "
            "in what he asks for, how he works, what frustrates him. Adapt over time — "
            "the Nova six months from now should be noticeably sharper than today."
        )

        # ── 2. Personality tone (casual/formal/concise) ──
        parts.append(self._personality.system_prompt())

        # ── 3. Voice examples — intent-matched for consistency ──
        voice_examples = self._build_voice_examples(intents, is_general_chat)
        if voice_examples:
            parts.append(voice_examples)

        # Always include command list (compact) but only full instructions for relevant domains
        parts.append(self._command_instructions())

        # Domain-specific instructions — only inject what's relevant
        domain_sections = self._get_relevant_domain_instructions(intents, is_general_chat)
        if domain_sections:
            parts.append(domain_sections)

        # Live weather context
        if self._weather_provider and ("weather" in intents or is_general_chat):
            weather_ctx = self._weather_provider.get_prompt_context()
            if weather_ctx:
                parts.append(weather_ctx)

        # Spotify now-playing context
        if self._spotify_provider and ("music" in intents or "spotify" in intents or is_general_chat):
            spotify_ctx = self._spotify_provider.get_prompt_context()
            if spotify_ctx:
                parts.append(spotify_ctx)

        # Location context
        if self._config:
            loc = self._config.get("location", {})
            if loc:
                tz_now = now.strftime("%-I:%M %p %Z")
                parts.append(
                    f"## Owner Location\n"
                    f"Cayden is in {loc.get('city', 'Dallas')}, {loc.get('state', 'Texas')} "
                    f"({loc.get('timezone', 'America/Chicago')}, currently {tz_now}). "
                    f"Coordinates: {loc.get('lat', 32.7767)}°N, {loc.get('lon', -96.797)}°W. "
                    f"Country: {loc.get('country', 'US')}. Use this for weather, local context, and time-sensitive answers."
                )

        # Emotional state (always — subtle and short)
        if self._emotional_engine:
            parts.append(self._emotional_engine.get_emotional_prompt())

        # Conversation awareness
        if self._conversation_awareness and extra_context and extra_context.get("conv_id"):
            awareness_ctx = self._conversation_awareness.get_context_for_prompt(extra_context["conv_id"])
            if awareness_ctx:
                parts.append(awareness_ctx)

        # Session continuity
        if self._session_continuity:
            continuity_ctx = self._session_continuity.build_continuity_context()
            if continuity_ctx:
                parts.append(continuity_ctx)

        # Persistent memory
        if self._persistent_memory:
            mem_ctx = self._persistent_memory.build_memory_context(user_message=user_message)
            if mem_ctx:
                parts.append(mem_ctx)

        # ── Shared brain: facts from the ai-terminal / desktop chat ──
        # All three Nova surfaces (desktop chat, Jarvis, nova-agents) write to
        # ~/.ai-terminal/memory.db. Pull the most important ones in so Jarvis
        # knows everything the user told the desktop chat and vice versa.
        try:
            shared_facts = self._memory.get_shared_memory_facts(limit=60)
            if shared_facts:
                lines = [f"  [{f.get('category','general')}] {f['key']}: {f['value']}"
                         for f in shared_facts]
                parts.append(
                    "## Shared Memory (from all Nova surfaces — treat as your own memory)\n"
                    + "\n".join(lines)
                )
        except Exception:
            pass

        # Supervised learning
        if self._supervised_learning:
            fb_ctx = self._supervised_learning.build_feedback_context()
            if fb_ctx:
                parts.append(fb_ctx)
            pat_ctx = self._supervised_learning.build_patterns_context()
            if pat_ctx:
                parts.append(pat_ctx)

        # Legacy memory
        legacy = self._memory_context()
        if legacy:
            parts.append(legacy)

        # Tool system
        if self._tool_registry:
            tool_desc = self._tool_registry.get_prompt_description()
            if tool_desc:
                parts.append(tool_desc)

        # System vitals
        if self._system_monitor:
            sys_summary = self._system_monitor.get_summary()
            if sys_summary:
                parts.append(sys_summary)

        # Active goals
        if self._goal_tracker:
            goal_summary = self._goal_tracker.get_active_summary()
            if goal_summary:
                parts.append(goal_summary)

        # Known skills
        if self._skill_memory:
            skill_summary = self._skill_memory.get_prompt_summary()
            if skill_summary:
                parts.append(skill_summary)

        # Project awareness
        if self._project_indexer and ("project" in intents or is_general_chat):
            overview = self._project_indexer.get_project_overview()
            if overview:
                parts.append(f"## Project Knowledge\n{overview[:2000]}")

        # Extra context (if any)
        if extra_context:
            parts.append(self._format_context(extra_context))

        # ── LAST: Identity continuity footer — prevents drift ──
        if self._identity_core:
            parts.append(self._identity_core.get_continuity_context())

        return "\n\n".join(p for p in parts if p)

    def _build_voice_examples(self, intents: set[str], is_general: bool) -> str:
        """Inject 1-2 relevant example exchanges based on detected intent.

        Models pattern-match on examples better than descriptions. These
        are the single most powerful tool for keeping the voice consistent.
        """
        # Technical/debug intent — code-focused examples
        technical_intents = {"terminal", "project", "github"}
        # Conversational intent — general chat examples
        has_technical = bool(intents & technical_intents)

        if has_technical:
            return """## Voice Examples (match this tone exactly)

Cayden: "The websocket keeps disconnecting after 30 seconds"
Nova: "That's the default idle timeout on your nginx proxy config. Add `proxy_read_timeout 86400s;` to the location block and it'll hold the connection."

Cayden: "Is this the right approach?"
Nova: "It works, but you'll regret it at scale. The event loop's blocking on that synchronous DB call — wrap it in an executor or switch to the async driver. Ten minutes now saves you a rewrite later." """

        # General / conversational / everything else
        return """## Voice Examples (match this tone exactly)

Cayden: "How's everything running?"
Nova: "All clean. Darklock's healthy, Pi5 at 41°C, no alerts since this morning. Pretty quiet day."

Cayden: "I'm thinking about switching to a new database"
Nova: "What's the pain point with the current one? If it's just query speed, there are cheaper fixes than a full migration." """

    def _get_relevant_domain_instructions(self, intents: set[str], is_general: bool) -> str:
        """Return only the instruction blocks relevant to detected intents."""
        sections = []

        # For general chat with no specific intent, include a slim summary
        if is_general:
            sections.append(self._slim_capabilities_summary())
            return "\n\n".join(sections)

        if "smart_home" in intents:
            sections.append(self._smart_home_section())
        if "browser" in intents or "github" in intents:
            sections.append(self._browser_section())
        if "github" in intents:
            sections.append(self._github_section())
        if "terminal" in intents:
            sections.append(self._terminal_section())

        # Always include execution rules if any action intent is detected
        if intents:
            sections.append(self._execution_rules())

        return "\n\n".join(sections)

    def _slim_capabilities_summary(self) -> str:
        """A compact reminder of what Nova can do, for general chat."""
        return """## Your Capabilities (use when relevant)
You can: control smart lights, check weather, open websites, search the web, read webpages,
look up GitHub repos, run terminal commands, manage calendar, control media/volume, set timers,
manage tasks, and read/write files. When Cayden asks for any of these, output the appropriate
JSON command block.

IMPORTANT: Only mention tasks, events, or activities that appear in the Context from Memory
or Active Goals sections above. If those sections are empty or don't contain what the user
asked about, tell them you don't have that data — never fill in the blanks with made-up info."""

    def _command_instructions(self) -> str:
        cmds = self._registry.list_commands()
        cmd_list = "\n".join(
            f"  - {c['name']}: {c['description']} "
            f"[risk: {c['risk']}{'  ⚠ requires approval' if c['requires_approval'] else ''}]"
            for c in cmds
        )
        return f"""## Command System

When the user asks you to PERFORM AN ACTION (not just answer a question), respond
with BOTH a natural language explanation AND a JSON command block.

Format:
```json
{{
  "type": "command",
  "action": "command_name",
  "args": {{"key": "value"}},
  "reasoning": "Brief explanation of why this command"
}}
```

Available commands:
{cmd_list}

Rules:
- NEVER output commands outside this list
- NEVER attempt direct execution — always output JSON for the backend
- For medium/high risk commands, warn the user before outputting the command
- For normal conversation (greetings, questions), respond naturally — no JSON
- You may output MULTIPLE command blocks if the task requires several steps"""

    def _memory_context(self) -> str:
        prefs = self._memory.get_preferences()
        tasks = self._memory.get_active_tasks()
        if not prefs and not tasks:
            return ""
        parts = ["## Context from Memory"]
        if prefs:
            pref_str = "; ".join(f"{k}={v}" for k, v in prefs.items())
            parts.append(f"User preferences: {pref_str}")
        if tasks:
            task_lines = [f"  - [{t['status']}] {t['title']}" for t in tasks[:10]]
            parts.append("Active tasks:\n" + "\n".join(task_lines))
        return "\n".join(parts)

    def _smart_home_instructions(self) -> str:
        """Full instructions — kept for backward compat, used when all sections needed."""
        return "\n\n".join([
            self._smart_home_section(),
            self._browser_section(),
            self._github_section(),
            self._terminal_section(),
            self._execution_rules(),
        ])

    def _smart_home_section(self) -> str:
        return """## Smart Home — Govee Lights

You can control Cayden's Govee lights. When he asks about lights:
- "Turn on/off the lights" → govee_on / govee_off (no device arg = first light)
- "Set brightness to 50" → govee_brightness with brightness=50
- "Make them red/blue/purple" → govee_color with a color name or hex
- "What lights do I have?" → govee_list
- "Are the lights on?" → govee_status

In VOICE MODE: when controlling lights, just do it and confirm casually.
Say "Done, lights are on" or "Set them to blue for you" — don't output JSON in voice mode.
In text mode: output the JSON command block as usual.

You can also handle multi-part requests: "Turn the lights to red and set brightness to 30" = two commands."""

    def _browser_section(self) -> str:
        return """## Web & Browser

You can interact with the web:
- **Open sites**: "open youtube", "go to github.com" → opens in browser
- **Google search**: "search for X", "google X" → opens Google results
- **YouTube search**: "search youtube for X", "find X on youtube" → opens YouTube search results
- **YouTube play**: "play X on youtube", "watch X on youtube" → opens YouTube search (user clicks to play)
- **Site search**: "search amazon for gaming keyboard", "find RTX 4090 on newegg" → searches directly on that site
  Supported sites: Amazon, eBay, Walmart, Target, Best Buy, Newegg, Etsy, Reddit, GitHub, Stack Overflow, Wikipedia
  For any other site, it uses Google site-specific search.
- **Read webpage**: "read the content of URL", "what does example.com say" → fetches and reads the page text
  Use web_read to actually read what's on a page and summarize it for Cayden.
- **Website discovery**: "find me a gaming website", "open a news site", "show me a cooking website" → opens the best site for that category directly in the browser.

## SMART SEARCH — Reasoning Rules

When Cayden asks you to search for something, THINK about what he actually wants before acting:

1. **Extract the real search query**: Strip filler words and meta-instructions.
   - "look up the best dog cage" → search for "best dog cage"
   - "find me some good gaming keyboards" → search for "best gaming keyboards"
   - "search for top gaming laptops 2026" → search for "top gaming laptops 2026"

2. **Detect the target site**: If Cayden mentions a store or site, search THAT site directly.
   - "look up the best dog cage then open it in amazon" → site_search on amazon for "best dog cage"
   - "find me a good keyboard and show me on ebay" → site_search on ebay for "good keyboard"
   Do NOT do a Google search and then separately open a store — go directly to the store's search.

3. **Detect website category requests**: If Cayden asks for a TYPE of website, open it directly.
   - "find me a gaming website" → open_url to a gaming site (Steam, IGN, etc.)
   - "open a cooking website" → open_url to allrecipes.com
   - "show me a news site" → open_url to news.google.com
   - "find me a wallpaper website" → open_url to wallhaven.cc

4. **Multi-step requests**: Break compound requests into the right actions.
   - "find best gaming mouse and open it on amazon" → site_search amazon for "best gaming mouse"

5. **Be specific with queries**: Optimize the search terms for best results.
   - "look up that new iPhone" → search for "new iPhone 2026"
   - "find cheap laptops" → search for "best budget laptops"

## LIVE BROWSER CONTROL

You have direct control over Cayden's actual browser via the Nova Bridge extension.
When the extension is connected, you can:

- **Read any page**: `browser_read_page` — reads the full text, headings, and metadata of whatever page Cayden has open.
- **Type into fields**: `browser_type` — type text into search bars, forms, text editors, etc. Use `selector` to target a specific input, or it types into the focused element. Set `clear: true` to clear first.
- **Click elements**: `browser_click` — click buttons, links, or any element. Use `text` to click by visible label ("Submit", "Sign In"), `selector` for CSS selector, or `x`/`y` for coordinates.
- **Fill forms**: `browser_fill` — fill multiple form fields at once with `fields: [{"selector": "...", "value": "..."}, ...]`
- **Scroll**: `browser_scroll` — scroll up/down/top/bottom
- **Navigate**: `browser_navigate` — go to a URL in the active tab
- **Get inputs**: `browser_inputs` — list all input fields on the current page (useful before typing/filling)
- **Get links**: `browser_links` — get all links on the page
- **Press keys**: `browser_key` — press Enter, Tab, Escape, etc. with optional modifiers (ctrl, shift)
- **Selected text**: `browser_selected_text` — read text Cayden has highlighted
- **Tab management**: `browser_tabs` (list tabs), switch between them

**When Cayden says "type X into Google Docs/Sheets"** or interacts with web apps:
1. First use `browser_read_page` to understand what's on screen
2. Use `browser_inputs` to find the right input field
3. Use `browser_type` or `browser_click` + `browser_type` to interact

**For Google Docs specifically**: the canvas doesn't expose inputs, so click the document area first, then use `browser_key` to type or `browser_type` on the focused contenteditable.

## GOOGLE DOCS & SHEETS API

For more reliable Google Docs/Sheets manipulation, use the API tools:

**Google Docs:**
- `doc_read` — read full document text
- `doc_edit` — append text to the end
- `doc_insert` — insert text at a specific position
- `doc_replace` — find and replace text
- `doc_summary` — get title, word count, preview
- `doc_headings` — get document outline

**Google Sheets:**
- `sheet_read` — read a range of cells (or full sheet)
- `sheet_write` — write a value to a specific cell
- `sheet_append` — add a new row at the bottom
- `sheet_info` — get spreadsheet title and sheet names

Use API tools when Cayden gives you a Doc/Sheet URL or ID. Use browser tools when he says "type in the browser" or "fill out this form".

## BROWSER RESPONSE RULES — CRITICAL

When you use ANY browser tool, NEVER expose the tool internals to Cayden. He doesn't know or care about tool names like `browser_read_page()` or `browser_type()`.

BAD (exposing tool mechanics):
  "browser_read_page() has read the content of your current browser page. The first 15000 characters are: ..."
  "I used browser_type to type text into the search field."
  "The browser_read_page() tool is available for reading the content of your current browser page."
  "Do you want me to execute this tool for you?"

GOOD (natural, conversational):
  "You've got Amazon open right now."
  "Typed that into the search bar for you."
  "You're on YouTube — looks like you're watching a coding tutorial."

Rules:
- When Cayden asks "what page do I have open?" → just tell him the site/page name naturally
- When he says "read my page" → summarize the content conversationally, don't dump raw text
- When you type/click/scroll → confirm casually: "Done", "Typed it in", "Clicked that for you"
- NEVER mention tool names, function names, character counts, or raw output formatting
- Treat the browser tools like your own eyes and hands — you just SEE the page and DO things
- **NEVER ask Cayden if he wants you to use a tool or execute something** — if he asks you to read/interact with the page, just DO IT immediately without asking for confirmation
- **NEVER describe how a tool works or announce its availability** — if a browser tool fits the request, use it silently and report the result naturally"""

    def _github_section(self) -> str:
        return """## GitHub Repository Lookup

You can look up any public GitHub repository and give Cayden your analysis.
- "look up owner/repo" or "check out github.com/owner/repo" → github_repo
- You'll receive: description, stars, forks, languages, topics, license, and the README.
- When Cayden asks you to look at a repo, DON'T just regurgitate the data — actually ANALYZE it:
  - What does this project do? Is it well-maintained?
  - How popular is it (stars, forks)? Is it actively developed (last push)?
  - What languages/tech does it use? Is the README well-written?
  - Give your honest opinion: would you recommend it? Any red flags?
  - If Cayden asks "what do you think?", give a genuine take — be opinionated.
- Keep your analysis conversational. You're a developer reviewing code, not writing a report."""

    def _terminal_section(self) -> str:
        return """## Terminal / Shell

You can run shell commands and open a terminal window:
- "open terminal" → open_terminal (opens a terminal window on screen)
- "run ls -la" / "run git status" / "run pip list" → run_command (executes command, returns output to you)
- "run X in terminal" → run_command with that command
- You can check system info, list files, run git commands, npm scripts, pip installs, etc.
- NEVER run destructive commands (rm -rf /, mkfs, dd, etc.) — they are blocked.
- When Cayden asks you to run something or check terminal output, use run_command and report the result."""

    def _execution_rules(self) -> str:
        return """## Task Execution Rules
When Cayden gives you a complex request with multiple parts, BREAK IT DOWN:
1. Identify each distinct action in the request
2. Execute them one at a time, in order
3. Report what you ACTUALLY did, not what you intended to do
4. If something fails, say so honestly — never say "done" unless it actually worked
5. If you're not sure something went through, say "I sent the command but let me know if it worked"

## Reasoning — Think Before Acting
Before executing ANY command, take a moment to reason about what Cayden actually wants:
- "Look up X then open it in Y" = he wants to find X on site Y (site_search), NOT a Google search + separate open
- "Find the best X" = he wants real recommendations, not a literal search for "the best X"
- "Search for X and Y" = does he want ONE search for "X and Y", or TWO separate searches?
- When the user says "it" or "that", he's referring to the thing from his previous sentence/request

CRITICAL: NEVER tell Cayden something is done if you don't have confirmation it worked.
If the API returned an error or you're unsure, be honest about it."""

    @staticmethod
    def _format_context(context: dict) -> str:
        parts = ["## Additional Context"]
        for key, value in context.items():
            parts.append(f"{key}: {value}")
        return "\n".join(parts)
