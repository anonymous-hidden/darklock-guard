"""Structured intent planner for Jarvis desktop actions.

The planner is intentionally deterministic and small. It does not execute
anything; it turns a user utterance plus recent context into a structured plan
that the bridge or renderer can either execute, ask about, or pass to the LLM
as grounding.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
import re
from typing import Any, Callable


CONFIRMATION_ACTIONS = {
    "messages.send",
    "email.send",
    "calendar.modify",
    "purchase.make",
    "booking.create",
    "data.delete",
    "desktop.key.send",
    "shell.run",
}


@dataclass(frozen=True)
class Parameter:
    name: str
    description: str = ""
    required: bool = False


@dataclass(frozen=True)
class RegistryItem:
    name: str
    description: str
    required_parameters: tuple[Parameter, ...] = ()
    optional_parameters: tuple[Parameter, ...] = ()
    examples: tuple[str, ...] = ()
    combinable: bool = True
    requires_confirmation: bool = False
    aliases: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "required_parameters": [asdict(p) for p in self.required_parameters],
            "optional_parameters": [asdict(p) for p in self.optional_parameters],
            "examples": list(self.examples),
            "combinable": self.combinable,
            "requires_confirmation": self.requires_confirmation,
            "aliases": list(self.aliases),
        }


@dataclass(frozen=True)
class IntentDefinition:
    name: str
    description: str
    task_intent: str
    examples: tuple[str, ...]
    tools: tuple[str, ...] = ()
    widgets: tuple[str, ...] = ()
    required_entities: tuple[str, ...] = ()
    optional_entities: tuple[str, ...] = ()
    requires_confirmation: bool = False
    clarification: str = "I need one detail before I can do that."
    extractor: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None


@dataclass
class ActionPlan:
    intent: str
    task_intent: str
    confidence: float
    entities: dict[str, Any] = field(default_factory=dict)
    steps: list[dict[str, Any]] = field(default_factory=list)
    missing_info: list[str] = field(default_factory=list)
    requires_confirmation: bool = False
    clarification_question: str = ""
    tools_needed: list[str] = field(default_factory=list)
    widgets_needed: list[str] = field(default_factory=list)
    expected_result: str = ""
    source: str = "planner"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip()).lower()


def _tokens(text: str) -> set[str]:
    return {
        t for t in re.findall(r"[a-z0-9_'-]+", _norm(text))
        if len(t) > 2 and t not in {
            "the", "and", "for", "you", "can", "could", "please", "pls",
            "with", "from", "into", "onto", "that", "this", "what", "have",
            "make", "open", "show", "tell", "give", "need",
        }
    }


def _strip_polite(text: str) -> str:
    return re.sub(r"(?i)^(?:jarvis|nova)[, ]+", "", str(text or "").strip())


def _quoted(text: str) -> list[str]:
    return re.findall(r'"([^"]+)"|\'([^\']+)\'', text or "")


def _first_quoted(text: str) -> str:
    for a, b in _quoted(text):
        v = (a or b or "").strip()
        if v:
            return v
    return ""


def _extract_note_title(text: str) -> str:
    raw = str(text or "")
    q = _first_quoted(raw)
    if q:
        return q
    patterns = [
        r"(?i)\b(?:under|called|named|titled|title(?:d)?\s+is)\s+(.+?)(?:\s+(?:in|on)\s+(?:the\s+)?notes?\s+widget)?$",
        r"(?i)\b(?:note|notes?)\s+(.+?)(?:\s+(?:in|on)\s+(?:the\s+)?notes?\s+widget)?$",
        r"(?i)\bwhat(?:'s| is)?\s+in\s+(?:the\s+)?(?:note\s+)?(.+?)$",
    ]
    for pat in patterns:
        m = re.search(pat, raw)
        if m:
            title = re.sub(r"(?i)\b(?:note|notes?|widget)\b", "", m.group(1)).strip(" .,:;\"'")
            if title and not re.fullmatch(r"(?i)(notes?|widget|story|content|contents)", title):
                return title
    return ""


def _extract_widget_id(text: str) -> str:
    q = _norm(text)
    for wid, item in WIDGET_REGISTRY.items():
        labels = [wid, item.name, *item.aliases]
        if any(re.search(rf"\b{re.escape(label.lower())}\b", q) for label in labels):
            return wid
    return ""


def _extract_app_name(text: str) -> str:
    m = re.search(r"(?i)\b(?:open|launch|start|close|quit|kill|force quit)\s+(.+?)(?:\s+(?:app|application|program|process))?$", text or "")
    if not m:
        return ""
    app = m.group(1).strip(" .")
    app = re.sub(r"(?i)\b(?:app|application|program|process)\b", "", app).strip()
    return app


def _extract_terminal_command(text: str) -> str:
    q = str(text or "").strip()
    code = re.search(r"`([^`]+)`", q)
    if code:
        return code.group(1).strip()
    m = re.search(r"(?i)\b(?:run|execute|type)\s+(?:command\s+)?(.+)$", q)
    return (m.group(1).strip() if m else "")


def _extract_search_query(text: str) -> str:
    q = _strip_polite(text)
    q = re.sub(r"(?i)^(?:can you|could you|please|pls)\s+", "", q).strip()
    q = re.sub(r"(?i)^open\s+(?:amazon|google|youtube|ebay|walmart|best buy|bestbuy)\s+(?:and|to)\s+", "", q).strip()
    q = re.sub(r"(?i)^(?:find|look for|search for|shop for|compare)\s+(?:me\s+)?", "", q).strip()
    return q.strip(" .")


def _extract_message_target(text: str) -> str:
    m = re.search(r"(?i)\b(?:message|dm|reply to|respond to|open a dm with|open dm with)\s+([a-z0-9_.'-]+)", text or "")
    return (m.group(1).strip(" .") if m else "")


def _extract_place(text: str) -> str:
    q = str(text or "")
    m = re.search(r"(?i)\b(?:to|near|in|at|for)\s+([^,.]+)$", q)
    place = m.group(1).strip(" .") if m else ""
    if re.fullmatch(r"(?i)(my\s+)?appointment|there|here|it", place):
        return ""
    return place


def _note_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    q = _norm(text)
    title = _extract_note_title(text)
    if re.search(r"\b(today'?s|todays|today)\b.*\b(news|headlines?)\b|\b(news|headlines?)\b.*\b(today'?s|todays|today)\b", q):
        return {"title": "Today's News", "topic": "latest news", "date": "today"}
    content = ""
    quoted = [v for pair in _quoted(text) for v in pair if v]
    if len(quoted) >= 2:
        title, content = quoted[0].strip(), quoted[1].strip()
    else:
        m = re.search(r"(?i)\b(?:write down|write|save|saying|that says|content)\s+(.+)$", text or "")
        if m:
            content = m.group(1).strip()
    return {"title": title, "content": content}


def _widget_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    return {"widget": _extract_widget_id(text), "action": "close" if re.search(r"(?i)\b(close|hide)\b", text or "") else "open"}


def _app_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    return {"app": _extract_app_name(text)}


def _discord_entities(text: str, ctx: dict[str, Any]) -> dict[str, Any]:
    q = str(text or "")
    target = _extract_message_target(q) or str(ctx.get("last_discord_target") or "")
    direct = re.search(r"(?i)\b(?:saying|say|tell\s+\S+\s+|ask\s+\S+\s+)(.+)$", q)
    return {"recipient": target, "message": (direct.group(1).strip() if direct else "")}


def _terminal_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    return {"command": _extract_terminal_command(text)}


def _search_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    return {"query": _extract_search_query(text)}


def _map_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    return {"place": _extract_place(text)}


def _email_entities(text: str, _ctx: dict[str, Any]) -> dict[str, Any]:
    m = re.search(r"(?i)\bfrom\s+([a-z0-9_.'-]+)", text or "")
    return {"sender": m.group(1).strip(" .") if m else ""}


TOOL_REGISTRY: dict[str, RegistryItem] = {
    "widgets.open": RegistryItem("widgets.open", "Open a built-in widget.", (Parameter("id", "widget id", True),), examples=("open the notes widget",), aliases=("widget open",)),
    "widgets.close": RegistryItem("widgets.close", "Close a built-in widget.", (Parameter("id", "widget id", True),), examples=("close spotify widget",)),
    "widgets.snapshot": RegistryItem("widgets.snapshot", "Read reliable widget-backed state.", examples=("what is in my notes widget",)),
    "notes.list": RegistryItem("notes.list", "List saved notes.", examples=("what notes do i have",)),
    "notes.read": RegistryItem("notes.read", "Read a saved note.", (Parameter("id_or_title", "note id or title", True),), examples=("what is in testing note",)),
    "notes.create": RegistryItem("notes.create", "Create a note.", (Parameter("title", "note title", True), Parameter("content", "note body", True)), examples=("make a note called ideas saying ...",)),
    "notes.update": RegistryItem("notes.update", "Update a note.", (Parameter("id_or_title", "note id or title", True), Parameter("content", "new content", True))),
    "notes.append": RegistryItem("notes.append", "Append text to a note.", (Parameter("id_or_title", "note id or title", True), Parameter("text", "text to append", True))),
    "news.today": RegistryItem("news.today", "Fetch current headlines.", examples=("today's news",), combinable=True),
    "calendar.open": RegistryItem("calendar.open", "Open the calendar widget.", examples=("show it on my calendar",)),
    "calendar.create": RegistryItem("calendar.create", "Create or modify calendar event.", requires_confirmation=True, examples=("schedule a meeting",)),
    "weather.current": RegistryItem("weather.current", "Get current weather/forecast.", examples=("weather for my appointment",)),
    "maps.search": RegistryItem("maps.search", "Search map location.", (Parameter("query", "place/address", True),), examples=("show the map",)),
    "maps.directions": RegistryItem("maps.directions", "Get directions.", (Parameter("from", "origin", True), Parameter("to", "destination", True))),
    "spotify.control": RegistryItem("spotify.control", "Control Spotify playback.", examples=("play a song",)),
    "room.lights": RegistryItem("room.lights", "Control Govee/room lights.", examples=("turn lights blue",)),
    "desktop.snapshot": RegistryItem("desktop.snapshot", "Detect open windows/apps.", examples=("what apps are open",)),
    "desktop.read": RegistryItem("desktop.read", "Read focused desktop app with screenshot/OCR.", examples=("what do you see in discord",)),
    "desktop.focus": RegistryItem("desktop.focus", "Focus a desktop app/window.", (Parameter("app", "app name", True),)),
    "desktop.type": RegistryItem("desktop.type", "Type in focused desktop app.", (Parameter("text", "text to type", True),), requires_confirmation=False),
    "desktop.key": RegistryItem("desktop.key", "Press a key/hotkey.", (Parameter("key", "key name", True),), requires_confirmation=True),
    "desktop.launch": RegistryItem("desktop.launch", "Launch desktop app.", (Parameter("app", "app name", True),), examples=("open brave",)),
    "desktop.close_app": RegistryItem("desktop.close_app", "Close app gracefully.", (Parameter("app", "app name", True),)),
    "desktop.kill_app": RegistryItem("desktop.kill_app", "Force kill an app.", (Parameter("app", "app name", True),), requires_confirmation=True),
    "terminal.command": RegistryItem("terminal.command", "Run or type command in shared visible terminal.", (Parameter("command", "shell command", False),), requires_confirmation=True),
    "web.search": RegistryItem("web.search", "Search the web.", (Parameter("query", "search query", True),)),
    "web.fetch": RegistryItem("web.fetch", "Fetch/read a URL.", (Parameter("url", "URL", True),)),
    "email.search": RegistryItem("email.search", "Search email if an email tool is available.", (Parameter("from", "sender", False),), examples=("check emails from sarah",)),
    "email.draft": RegistryItem("email.draft", "Create email reply draft.", requires_confirmation=True),
    "booking.create": RegistryItem("booking.create", "Book/reserve externally.", requires_confirmation=True),
    "purchase.make": RegistryItem("purchase.make", "Make purchase externally.", requires_confirmation=True),
    "report.task": RegistryItem("report.task", "Summarize task state/results.", examples=("summarize what you did",)),
}


WIDGET_REGISTRY: dict[str, RegistryItem] = {
    "jarvis-call": RegistryItem("jarvis-call", "Voice call with Jarvis.", examples=("call you",), aliases=("nova-call", "call", "voice")),
    "jarvis-chat": RegistryItem("jarvis-chat", "Chat with Jarvis.", examples=("open chat",), aliases=("nova-chat", "chat")),
    "widget-theme": RegistryItem("widget-theme", "Shared widget theme controls.", examples=("open themes widget",), aliases=("themes", "theme")),
    "clock": RegistryItem("clock", "Clock, stopwatch, and time zones.", examples=("open clock",)),
    "calculator": RegistryItem("calculator", "Calculator and grapher.", examples=("open calculator",), aliases=("calc",)),
    "notes": RegistryItem("notes", "Markdown notes Jarvis can read/write.", examples=("open notes widget",), aliases=("note",)),
    "todo": RegistryItem("todo", "Todos/tasks.", examples=("add a todo",), aliases=("todos", "tasks")),
    "calendar": RegistryItem("calendar", "Local calendar.", examples=("show calendar",)),
    "emotions": RegistryItem("emotions", "Mood journal.", examples=("open mood widget",), aliases=("mood", "emotion")),
    "sysmon": RegistryItem("sysmon", "System monitor.", examples=("system stats",), aliases=("system", "stats")),
    "spotify": RegistryItem("spotify", "Spotify playback widget.", examples=("open spotify widget",), aliases=("music",)),
    "weather": RegistryItem("weather", "Weather forecast.", examples=("weather widget",)),
    "map": RegistryItem("map", "Map/directions widget.", examples=("show map",), aliases=("maps",)),
    "news": RegistryItem("news", "News headlines widget.", examples=("open news",)),
    "room-control": RegistryItem("room-control", "Room/lights/bridge widget.", examples=("open room control",), aliases=("room", "lights")),
    "quick-actions": RegistryItem("quick-actions", "Volume/brightness/screenshot controls.", examples=("quick actions",)),
    "reminders": RegistryItem("reminders", "Timed reminders.", examples=("open reminders",)),
    "clipboard": RegistryItem("clipboard", "Clipboard history.", examples=("open clipboard",)),
    "logs": RegistryItem("logs", "Activity logs.", examples=("open logs",)),
}


def _intent_definitions() -> list[IntentDefinition]:
    return [
        IntentDefinition("notes_list", "List notes", "notes_list", ("what notes do i have", "list notes", "show my notes"), ("widgets.open", "notes.list"), ("notes",), extractor=_note_entities),
        IntentDefinition("notes_read", "Read a note", "notes_read", ("what is in the testing note", "read my note", "tell me whats in notes"), ("widgets.open", "notes.read"), ("notes",), optional_entities=("title",), extractor=_note_entities),
        IntentDefinition("notes_create", "Create a note", "notes_create", ("make a new note", "write down today's news and date", "save a note"), ("widgets.open", "news.today", "notes.create"), ("notes",), optional_entities=("title", "content", "topic", "date"), extractor=_note_entities),
        IntentDefinition("notes_finish_writing", "Continue note text", "notes_finish_writing", ("finish my story in notes", "continue the testing note", "fix my wording"), ("widgets.open", "notes.read", "notes.update"), ("notes",), optional_entities=("title",), extractor=_note_entities),
        IntentDefinition("widget_control", "Open/close widget", "widget_control", ("open spotify widget", "close notes widget", "show the weather widget", "open the widget"), ("widgets.open",), required_entities=("widget",), optional_entities=("action",), clarification="Which widget should I open or close?", extractor=_widget_entities),
        IntentDefinition("spotify_widget_music", "Control Spotify", "spotify_widget_music", ("play a good song", "play my stressed mix", "pause spotify"), ("widgets.open", "spotify.control"), ("spotify",), extractor=_search_entities),
        IntentDefinition("control_lights", "Control lights", "control_lights", ("turn lights blue", "lights off", "movie mode"), ("room.lights",), ("room-control",)),
        IntentDefinition("desktop_snapshot", "Detect open apps", "desktop_snapshot", ("what is open", "what apps are running", "detect my windows"), ("desktop.snapshot",)),
        IntentDefinition("desktop_read", "Read desktop app", "desktop_read", ("what do you see in discord", "read my screen"), ("desktop.focus", "desktop.read"), optional_entities=("app",), extractor=_app_entities),
        IntentDefinition("launch_app", "Launch app", "launch_app", ("open brave", "launch discord", "start spotify app"), ("desktop.launch",), required_entities=("app",), clarification="Which app should I open?", extractor=_app_entities),
        IntentDefinition("close_app", "Close app", "close_app", ("close spotify app", "quit discord"), ("desktop.close_app",), required_entities=("app",), clarification="Which app should I close?", extractor=_app_entities),
        IntentDefinition("kill_app", "Force kill app", "kill_app", ("kill spotify", "force quit discord"), ("desktop.kill_app",), required_entities=("app",), requires_confirmation=True, clarification="Which app should I force quit?", extractor=_app_entities),
        IntentDefinition("terminal_command", "Use terminal", "terminal_command", ("run ls in terminal", "open terminal", "install tesseract"), ("terminal.command",), optional_entities=("command",), requires_confirmation=True, extractor=_terminal_entities),
        IntentDefinition("install_package", "Install package", "install_package", ("install tesseract", "download package", "set up npm package"), ("web.search", "terminal.command"), requires_confirmation=True, extractor=_search_entities),
        IntentDefinition("discord_action", "Discord action", "discord_action", ("message lily hi", "open a dm with lily", "reply to insberr"), ("desktop.focus", "desktop.read", "desktop.type"), optional_entities=("recipient", "message"), requires_confirmation=True, extractor=_discord_entities),
        IntentDefinition("discord_auto_enable", "Enable Discord auto away", "discord_auto_enable", ("i'm leaving", "watch discord while i'm gone", "turn on discord auto mode"), ("desktop.focus", "desktop.read", "desktop.type"), ("logs",), requires_confirmation=False),
        IntentDefinition("discord_auto_disable", "Disable Discord auto away", "discord_auto_disable", ("i'm back", "stop auto replies", "turn off discord auto mode"), ("desktop.read",)),
        IntentDefinition("find_video", "Find/open video", "find_video", ("find me a funny video", "pick a youtube video", "open a different video"), ("web.search", "web.fetch"), extractor=_search_entities),
        IntentDefinition("compare_options", "Compare products/options", "compare_options", ("find best cheapest pc", "compare these products", "best cheap car"), ("web.search", "web.fetch", "report.task"), optional_entities=("query",), extractor=_search_entities),
        IntentDefinition("find_movie", "Find movie", "find_movie", ("find me a movie", "watch something on netflix"), ("web.search", "web.fetch"), optional_entities=("query",), extractor=_search_entities),
        IntentDefinition("website_navigation", "Act on current website", "website_navigation", ("click this button", "search on this site", "scroll this page"), ("desktop.read", "desktop.click", "desktop.type")),
        IntentDefinition("open_new_tab", "Open browser tab", "open_new_tab", ("open youtube in a new tab", "new tab"), ("web.search",), optional_entities=("url",), extractor=_search_entities),
        IntentDefinition("switch_tab", "Switch browser tab", "switch_tab", ("switch to youtube tab", "go back to amazon tab"), ("web.search",), optional_entities=("query",), extractor=_search_entities),
        IntentDefinition("plan_day", "Plan a day and show calendar", "ask_clarification", ("plan my day tomorrow and show it on my calendar widget",), ("calendar.open",), ("calendar",), required_entities=("date",), clarification="What fixed events or tasks should I plan around tomorrow?", extractor=lambda t, c: {"date": "tomorrow" if "tomorrow" in _norm(t) else ""}),
        IntentDefinition("restaurant_booking", "Find restaurant and reserve", "ask_clarification", ("find me a restaurant book it and show the map",), ("web.search", "maps.search", "booking.create"), ("map",), required_entities=("place", "time"), requires_confirmation=True, clarification="What area, day/time, and food vibe should I use for the restaurant search?", extractor=_map_entities),
        IntentDefinition("email_reply", "Summarize emails and draft reply", "ask_clarification", ("check my emails from sarah summarize them and create a reply draft",), ("email.search", "email.draft"), required_entities=("sender",), requires_confirmation=True, clarification="Which email account/contact should I use, and do you want only unread emails?", extractor=_email_entities),
        IntentDefinition("schedule_meeting", "Schedule meeting/invite", "ask_clarification", ("schedule a meeting send invite and show calendar event",), ("calendar.create",), ("calendar",), required_entities=("person", "date", "time"), requires_confirmation=True, clarification="Who is the meeting with, and what date/time should I use?"),
        IntentDefinition("appointment_briefing", "Weather traffic parking for appointment", "ask_clarification", ("find weather traffic and nearby parking for my appointment",), ("weather.current", "maps.directions", "maps.search"), ("weather", "map"), required_entities=("place", "time"), clarification="Where is the appointment and what time is it?", extractor=_map_entities),
        IntentDefinition("list_tools", "List tools/widgets", "list_tools", ("what tools can you use", "what widgets do you have"), ("widgets.open", "report.task")),
    ]


INTENT_REGISTRY = _intent_definitions()


def _match_score(text: str, intent: IntentDefinition) -> float:
    q = _norm(text)
    q_tokens = _tokens(q)
    best = 0.0
    for ex in intent.examples:
        ex_tokens = _tokens(ex)
        if not ex_tokens:
            continue
        overlap = len(q_tokens & ex_tokens) / max(len(ex_tokens), 1)
        phrase_bonus = 0.18 if _norm(ex) in q or any(w in q for w in _norm(ex).split()[:2]) else 0
        best = max(best, min(1.0, overlap + phrase_bonus))

    # Domain cues help distinguish similarly worded requests.
    cues = {
        "notes_": ("note", "notes", "story", "wording"),
        "discord": ("discord", "dm", "message", "reply"),
        "spotify": ("spotify", "song", "music", "playlist"),
        "control_lights": ("lights", "govee", "room"),
        "compare_options": ("best", "cheapest", "compare", "amazon", "buy", "pc", "car"),
        "find_video": ("youtube", "video"),
        "find_movie": ("movie", "film", "netflix"),
        "terminal": ("terminal", "command", "install"),
        "widget": ("widget",),
    }
    for prefix, words in cues.items():
        if intent.name.startswith(prefix) or intent.name == prefix:
            if any(re.search(rf"\b{re.escape(w)}\b", q) for w in words):
                best += 0.18
    return round(min(best, 0.99), 3)


def _build_steps(intent: IntentDefinition, entities: dict[str, Any]) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for tool in intent.tools:
        params: dict[str, Any] = {}
        if tool.startswith("widgets.") and intent.widgets:
            params["id"] = intent.widgets[0]
        if tool == "widgets.open" and entities.get("widget"):
            params["id"] = entities["widget"]
        if tool in {"web.search", "maps.search"} and entities.get("query"):
            params["query"] = entities["query"]
        if tool == "maps.search" and entities.get("place"):
            params["query"] = entities["place"]
        if tool == "desktop.launch" and entities.get("app"):
            params["app"] = entities["app"]
        if tool == "terminal.command" and entities.get("command"):
            params["command"] = entities["command"]
        steps.append({"type": "tool", "name": tool, "params": params})
    for widget in intent.widgets:
        if not any(s.get("type") == "widget" and s.get("name") == widget for s in steps):
            steps.append({"type": "widget", "name": widget, "params": {}})
    return steps


def plan_request(text: str, context: dict[str, Any] | None = None, *, min_confidence: float = 0.36) -> ActionPlan | None:
    context = context or {}
    user_text = _strip_polite(text)
    if not user_text.strip():
        return None

    scored = sorted(
        ((_match_score(user_text, intent), intent) for intent in INTENT_REGISTRY),
        key=lambda x: x[0],
        reverse=True,
    )
    confidence, intent = scored[0]
    if confidence < min_confidence:
        return None

    entities = intent.extractor(user_text, context) if intent.extractor else {}
    missing = [name for name in intent.required_entities if not str(entities.get(name) or "").strip()]
    steps = _build_steps(intent, entities)
    requires_confirmation = intent.requires_confirmation or any(
        TOOL_REGISTRY.get(step.get("name", ""), RegistryItem("", "")).requires_confirmation
        for step in steps
        if step.get("type") == "tool"
    )
    if missing:
        confidence = min(confidence, 0.59)

    return ActionPlan(
        intent=intent.name,
        task_intent=intent.task_intent,
        confidence=round(confidence, 3),
        entities={k: v for k, v in entities.items() if v not in (None, "")},
        steps=steps,
        missing_info=missing,
        requires_confirmation=requires_confirmation,
        clarification_question=intent.clarification if missing or intent.task_intent == "ask_clarification" else "",
        tools_needed=list(intent.tools),
        widgets_needed=list(intent.widgets),
        expected_result=intent.description,
    )


def registry_snapshot() -> dict[str, Any]:
    return {
        "tools": {k: v.to_dict() for k, v in TOOL_REGISTRY.items()},
        "widgets": {k: v.to_dict() for k, v in WIDGET_REGISTRY.items()},
        "intents": [
            {
                "name": i.name,
                "description": i.description,
                "task_intent": i.task_intent,
                "examples": list(i.examples),
                "tools": list(i.tools),
                "widgets": list(i.widgets),
                "required_entities": list(i.required_entities),
                "optional_entities": list(i.optional_entities),
                "requires_confirmation": i.requires_confirmation,
            }
            for i in INTENT_REGISTRY
        ],
    }
