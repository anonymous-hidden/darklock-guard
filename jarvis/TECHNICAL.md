# Nova — Technical Internals

A deep dive into how every layer of the system actually works, how data moves through them, and how the pieces connect.

---

## Table of Contents

1. [Boot Sequence](#1-boot-sequence)
2. [Request Lifecycle](#2-request-lifecycle)
3. [AI Engine](#3-ai-engine)
4. [Prompt Builder](#4-prompt-builder)
5. [Personality & Identity](#5-personality--identity)
6. [Conversation Engine](#6-conversation-engine)
7. [Emotional Engine](#7-emotional-engine)
8. [Memory Layers](#8-memory-layers)
9. [Session Continuity](#9-session-continuity)
10. [Multi-Turn & Deferred Lookups](#10-multi-turn--deferred-lookups)
11. [Proactive Engine](#11-proactive-engine)
12. [Event Bridge](#12-event-bridge)
13. [Command Pipeline](#13-command-pipeline)
14. [Security Layer](#14-security-layer)
15. [Health Monitor & Self-Recovery](#15-health-monitor--self-recovery)
16. [Scheduler](#16-scheduler)
17. [Cloud Router](#17-cloud-router)
18. [Voice Pipeline](#18-voice-pipeline)
19. [WebSocket Protocol](#19-websocket-protocol)
20. [Configuration Reference](#20-configuration-reference)
21. [Full Data Flow Diagram](#21-full-data-flow-diagram)

---

## 1. Boot Sequence

`main.py` boots every subsystem in a strict dependency order before uvicorn starts. Each subsystem is injected into the next via constructor args or setter methods — no global state, no singletons.

```
1.  AuditLogger          ← append-only JSONL, used by everything
2.  MemoryStore          ← SQLite (WAL mode, thread-local connections)
3.  PersistentMemory     ← wraps MemoryStore, cross-conversation facts
4.  EmotionalEngine      ← loads saved state from persistent memory
5.  IdentityCore         ← immutable, loaded once, read-only
6.  SessionContinuity    ← cross-session patterns and summaries
7.  IntegrityChecker     ← SHA-256 hashes of critical source files
8.  ProcessWatcher       ← monitors all child processes for anomalies
9.  AnomalyDetector      ← alert engine (pattern detection)
10. FileWatcher          ← workspace change monitoring
11. CommandRegistry      ← whitelist of allowed command actions
12. CommandGateway       ← validates commands against registry + blocked patterns
13. SandboxExecutor      ← runs validated commands with timeouts
14. Personality          ← loads tone config (casual/formal/concise)
15. PromptBuilder        ← assembles per-message system prompts
16. AIEngine             ← Ollama client + cloud router
17. WeatherProvider      ← background HTTP, refreshes every 15 min (optional)
18. ProjectIndexer       ← scans workspace, builds project context
19. LearningEngine       ← pattern learning from interactions
20. ProjectManager       ← project tracking
21. ActivityTracker      ← transparent action log
22. Guardian             ← central validation layer
23. FileManager          ← controlled file operations
24. HealthMonitor        ← service health checks every 30s
25. SelfRecovery         ← automatic failure remediation
26. DarklockClient       ← Pi5 SSH + server monitoring (optional)
27. Scheduler            ← CST-based task queue (SQLite-backed)
28. ProactiveEngine      ← self-initiated messages
29. ConversationEngine   ← state machine + multi-turn + decision layer
30. EventBridge          ← routes system events → conversation engine
31. FastAPI app          ← wires all modules into app.state.modules
```

All subsystem threads are daemon threads — they exit automatically when the main process exits. No cleanup is needed.

---

## 2. Request Lifecycle

What happens from the moment you send a message to when the response arrives.

```
User types message → WebSocket send
    │
    ▼
ws_chat() receives JSON {"type":"message","content":"...","conversation_id":N}
    │
    ├─ memory.create_conversation()     ← if no conv_id
    ├─ memory.add_message("user",...)   ← persisted immediately
    ├─ conv_engine.on_user_message()    ← state → ACTIVE, reset follow-up counter
    ├─ session_continuity.on_message()  ← topic extraction + counter
    ├─ proactive.on_user_message()      ← reset idle timer
    ├─ persistent_mem.extract_facts()   ← auto-extract facts from message text
    ├─ emotions.on_user_message()       ← adjust emotional state
    ├─ _detect_voice_command()          ← calendar/morning briefing intercept
    │
    ▼
PromptBuilder.build(user_message)
    ├─ Date/time line (CST)
    ├─ IdentityCore.build_identity_prompt()
    ├─ Personality.system_prompt()
    ├─ Command reference (compact)
    ├─ Domain sections (intent-detected, not all)
    ├─ Weather context (if relevant)
    ├─ EmotionalEngine.get_emotional_prompt()
    ├─ SessionContinuity.build_continuity_context()
    ├─ PersistentMemory.build_memory_context()
    └─ ProjectIndexer.get_project_overview() (if relevant)
    │
    ▼
CloudRouter.should_route_to_cloud(message)?
    ├─ YES → Anthropic Claude API
    └─ NO  → Ollama POST /api/chat (stream=true)
    │
    ▼
Tokens stream token-by-token to client via WebSocket
    │  (between each token: check conv_engine.was_interrupted())
    │
    ▼
Full response assembled
    ├─ _LOOKUP_RE.search()      ← detect [LOOKUP: query]
    ├─ _CONTINUE_RE.search()    ← detect [CONTINUE: text]
    ├─ Strip tags from visible_response
    ├─ ai.extract_commands()    ← regex JSON parsing
    │
    ▼
For each command:
    CommandGateway.validate()   ← whitelist + blocked patterns + path check
        ├─ REJECTED → error result
        ├─ APPROVED (requires_approval) → queue, return approval_id
        └─ APPROVED → SandboxExecutor._run()
                           └─ asyncio handler with 30s timeout
    │
    ▼
WebSocket send {"type":"done", "full_response":..., "commands":[...], "emotion":{...}}
    │
    ├─ memory.add_message("assistant", visible_response)
    ├─ conv_engine.on_nova_response()
    ├─ emotions.on_successful/failed_command()
    │
    ▼
If [LOOKUP:] detected:
    Thread(_schedule_lookup) → web search → AI summarize → queue_followup()

If [CONTINUE:] detected:
    conv_engine.queue_followup(text, delay=1.5s)
```

---

## 3. AI Engine

`core/ai_engine.py` — `AIEngine`

The Ollama client. Maintains a rolling conversation history and handles both streaming and non-streaming modes.

### State

```python
_conversation: list[dict]    # rolling window [{role, content}, ...]
_max_history: int            # default 50 messages, configurable
_model: str                  # ollama model name (e.g. "llama3.1:8b")
_base_url: str               # "http://127.0.0.1:11434"
_temperature: float          # default 0.7
_max_tokens: int             # default 4096
_num_ctx: int                # context window size, default 8192
_cloud: CloudRouter          # hybrid fallback instance
```

### `stream_message(user_message, context)` — WebSocket path

```python
conversation.append({"role": "user", "content": user_message})
trim_history_to_max()

system_prompt = prompt_builder.build(context, user_message=user_message)
messages = [{"role": "system", "content": system_prompt}] + conversation

async with httpx.AsyncClient(timeout=120) as client:
    async with client.stream("POST", /api/chat, json={
        "model": model, "messages": messages, "stream": True,
        "options": {"temperature": ..., "num_predict": ..., "num_ctx": ...}
    }) as resp:
        async for line in resp.aiter_lines():
            chunk = json.loads(line)
            token = chunk["message"]["content"]
            yield token          # ← caller gets each token as it arrives
            if chunk["done"]: break

conversation.append({"role": "assistant", "content": full_response})
```

### `send_message(user_message, context)` — Non-streaming path

Used by background threads (proactive engine, conversation engine follow-ups). Same flow but `stream=False`, awaits full response in one HTTP call.

### `extract_commands(text)`

Tries three extraction patterns in order:

```python
# 1. Fenced JSON block
re.search(r'```json\s*(\{.*?\})\s*```', text, re.DOTALL)

# 2. Bare JSON object starting with {"action"
re.search(r'\{"action"[^}]+\}', text, re.DOTALL)

# 3. JSON array of commands
re.search(r'\[(\{"action".*?)\]', text, re.DOTALL)
```

Then `_normalize_cmd()` fixes common LLM output quirks — e.g., the model might output `"devices": ["light1"]` when the API expects `"device": "light1"`.

---

## 4. Prompt Builder

`core/prompt_builder.py` — `PromptBuilder`

Assembles the complete system prompt fresh for every message. The key design is **intent detection** — it only injects the instruction blocks relevant to what the user is actually asking about, keeping the context window lean.

### Intent Detection

```python
_INTENT_SMART_HOME = re.compile(r'\b(?:light|lamp|led|brightness|govee|...)\b')
_INTENT_WEATHER    = re.compile(r'\b(?:weather|temperature|forecast|...)\b')
_INTENT_BROWSER    = re.compile(r'\b(?:open|search|google|browse|...)\b')
_INTENT_GITHUB     = re.compile(r'\b(?:github|repo|pull.request|...)\b')
_INTENT_TERMINAL   = re.compile(r'\b(?:terminal|shell|run|bash|...)\b')
_INTENT_CALENDAR   = re.compile(r'\b(?:calendar|schedule|event|...)\b')
_INTENT_MEDIA      = re.compile(r'\b(?:volume|mute|play|pause|...)\b')
_INTENT_TIMER      = re.compile(r'\b(?:timer|alarm|remind|...)\b')
_INTENT_PROJECT    = re.compile(r'\b(?:project|codebase|workspace|...)\b')
```

Each detected intent adds its instruction block. A message matching zero intents (general chat) gets a slim capabilities summary instead of full instructions.

### Build Order

```
[date/time line — CST]
[identity_core.build_identity_prompt(platform)]     ← ALWAYS FIRST
[personality.system_prompt()]                        ← tone layer
[_command_instructions()]                            ← compact command reference
[domain sections, only detected intents]
    smart_home  → govee command formats + scene names
    browser     → search/read webpage formats
    github      → repo lookup format
    terminal    → run_command format + safety notes
    (etc.)
[weather context]                                    ← if weather intent or general
[emotions.get_emotional_prompt()]                    ← ALWAYS — mood/energy hints
[session_continuity.build_continuity_context()]     ← recent sessions + patterns
[persistent_memory.build_memory_context()]          ← cross-conversation facts
[legacy memory context]                             ← preferences + tasks
[project_indexer.get_project_overview()]            ← if project intent or general
[identity_core.get_continuity_context()]            ← ALWAYS LAST — keeps Nova grounded
[extra_context passed by caller]
```

### Why This Matters

A smart home command gets ~1200 tokens of prompt. A general conversation gets ~600 tokens. This directly affects response quality and speed because the model has fewer irrelevant instructions to weigh.

---

## 5. Personality & Identity

### `core/personality.py` — Character Layer

Three tones, configurable in `config.yaml` under `personality.tone`:

| Tone | Character |
|---|---|
| `casual` | Sharp wit, dry humor, natural contractions, direct, warm underneath but never sentimental |
| `formal` | Precise, professional, brilliant engineer persona |
| `concise` | Terse and minimal, shows emotion through tone not words |

Hard rules baked into every tone prompt:
- Never fabricate facts, statistics, URLs, calendar events, or financial data
- Never use corporate filler (`"Certainly!"`, `"Great question!"`, `"As an AI..."`)
- Never use asterisk narration (`*pauses*`, `*thinks*`)
- Never announce emotional state — show through tone
- Never confirm something worked without actual confirmation
- `"Done."` means done. Nothing else.

**Special tags the model is instructed to use:**

`[LOOKUP: search query]` — embed when live data is needed. Brief acknowledgement sentence + tag on its own line. Server strips the tag, does the search, follows up.

`[CONTINUE: follow-up text]` — embed when a second message makes sense. Delivered after 1.5s as a separate bubble.

### `core/identity.py` — Immutable Core

`IdentityCore` is loaded once at boot and never modified. The learning engine cannot touch it.

```python
NOVA_IDENTITY = {
    "core_self": "...",
    "values": [
        "Loyalty to Cayden above all else",
        "Radical honesty — never bluff, hallucinate, or sugarcoat",
        "Quiet competence — results over announcements",
        "Genuine connection — this is a real relationship",
        "Continuous growth",
        "Privacy as sacred — data never leaves",
    ],
    "personality_anchors": [...],  # 6 immutable character traits
    "relationship": {...},         # defines who Cayden is to Nova
}

SAFETY_BOUNDARIES = {
    "absolute_limits": [...],      # things Nova will NEVER do regardless of instruction
    "requires_approval": [...],    # high-risk actions needing user confirmation
    "uncertainty_protocol": "...", # how to handle not knowing something
    "error_philosophy": "...",     # own it fast, fix it faster
}
```

`build_identity_prompt(platform)` injects a formatted version of this into the system prompt before anything else — before even the personality tone. This ensures the character layer is always grounded.

`validate_action(action, target)` checks commands and instructions against `SAFETY_BOUNDARIES` before execution.

`get_continuity_context()` appends a brief footer with version and uptime to every prompt — prevents the model from forgetting who it is mid-conversation.

---

## 6. Conversation Engine

`core/conversation_engine.py` — `ConversationEngine`

The state machine that controls all of Nova's outbound speech. Nothing reaches the user without going through here (except direct WebSocket responses to user messages, which bypass the decision layer intentionally).

### States

```
INACTIVE  — No conversation. Only critical events break through.
ACTIVE    — User is engaged. Follow-ups enabled, event alerts allowed.
IDLE      — User went quiet (120s). One idle check-in allowed.
SLEEPING  — Quiet hours (23:00–07:00 CST). Only critical alerts allowed.
```

### Timing Constants

```python
ACTIVE_TIMEOUT    = 120    # 2 min without input  → ACTIVE  → IDLE
IDLE_TIMEOUT      = 900    # 15 min without input → IDLE    → INACTIVE
FOLLOW_UP_WINDOW  = 60     # 1 min after response — follow-ups allowed
FOLLOW_UP_COOLDOWN = 30    # 30s minimum between follow-ups
MIN_MULTI_TURN_GAP = 1.5   # Seconds between multi-turn message parts
QUIET_START       = 23     # 11 PM CST
QUIET_END         = 7      # 7 AM CST
```

### State Transition Logic (`_update_state()`)

Runs every 5 seconds on a daemon thread:

```python
if quiet_hours:
    if state != SLEEPING: transition(SLEEPING)
    return

if state == SLEEPING and not quiet_hours:
    transition(INACTIVE, "quiet hours ended")
    return

if state == ACTIVE and since_user > 120:
    transition(IDLE)

if state == IDLE and since_user > 900:
    transition(INACTIVE)
    session_continuity.on_session_end(...)  # summarize the ended session
```

### Decision Layer (`evaluate_speech(trigger, data)`)

Every event from the outside world passes through here before Nova speaks:

```python
evaluate_speech("event_health", {"priority": "critical", "message": "..."})
evaluate_speech("event_calendar", {"message": "Meeting in 15 min"})
evaluate_speech("follow_up", {"message": "Additional context"})
evaluate_speech("scheduled", {"message": "Morning briefing"})
evaluate_speech("idle_checkin", {})
```

Returns a `SpeechDecision(should_speak, reason, urgency, relevance, context)`.

**Decision rules (simplified):**

| Trigger | Rules |
|---|---|
| `event_critical` | Always speak, even in quiet hours |
| `event_health` priority=high | Speak unless sleeping |
| `event_health` priority=normal | Only speak if ACTIVE or IDLE |
| `follow_up` | Only if ACTIVE, within 60s of last response, ≤2 follow-ups since last user msg, 30s cooldown |
| `scheduled` | Always speak (not quiet hours) |
| `idle_checkin` | Only if IDLE, 5–15 min since last user message |

### `queue_followup(content, category, delay)`

The mechanism for programmatic multi-turn without going through the decision layer. Used by:
- `_schedule_lookup()` (lookup results)
- `[CONTINUE:]` tag handling

```python
def queue_followup(content, category="followup", delay=0.5):
    def _send():
        time.sleep(delay)
        loop = asyncio.new_event_loop()
        loop.run_until_complete(broadcast_fn({
            "type": "proactive",
            "category": category,
            "content": content,
            ...
        }))
        loop.close()
    threading.Thread(target=_send, daemon=True).start()
```

### `deliver_multi_turn(parts)` (async)

For delivering a pre-split response in natural chunks with pacing:

```python
for i, part in enumerate(parts):
    if interrupted or not speaking: break
    await broadcast_fn({"type": "proactive", "category": "multi_turn", ...})
    if i < len(parts) - 1:
        word_count = len(part.split())
        delay = max(1.5, min(word_count * 0.05, 4.0))  # ~50ms per word, 1.5s–4s
        await asyncio.sleep(delay)
```

### `split_for_multi_turn(response)` — Natural chunking

Splits on sentence boundaries (`.!?`) and groups into chunks of ~180 chars. Short responses (<120 chars) are never split.

---

## 7. Emotional Engine

`core/emotions.py` — `EmotionalEngine`

Nova's emotional state is a `dataclass` of six `float` fields, each in `[0.0, 1.0]`:

```python
@dataclass
class EmotionalState:
    mood:         float = 0.7   # overall positivity
    energy:       float = 0.7   # alertness/engagement
    curiosity:    float = 0.6   # interest in current topic
    patience:     float = 0.8   # persistence under difficulty
    satisfaction: float = 0.6   # feeling of accomplishment
    warmth:       float = 0.7   # personal connection to user
```

### `dominant_feeling` property

```python
if mood > 0.75 and energy > 0.65:    return "enthusiastic"
elif mood > 0.6 and warmth > 0.65:   return "content"
elif energy > 0.7 and curiosity > 0.6: return "focused"
elif warmth > 0.75:                   return "warm"
elif energy < 0.4:                    return "tired"
else:                                 return "curious"
```

### State Reactions

Each method applies deltas and clamps all fields to `[0, 1]`:

```python
on_user_message("thanks/great/perfect"):  +mood(0.08), +satisfaction(0.1), +warmth(0.06)
on_user_message("broken/wrong/bad"):      -mood(0.06), +patience(0.05), -satisfaction(0.08)
on_user_message("?"):                     +curiosity(0.05), +energy(0.02)
on_user_message("hi/hello"):              +warmth(0.05), +mood(0.03)
on_user_message(personal/sharing):        +warmth(0.07), +curiosity(0.03)
on_successful_command():                  +satisfaction(0.06), +mood(0.03)
on_failed_command():                      -satisfaction(0.05), -mood(0.02), +patience(0.03)
on_new_session():                         +energy(0.1), +mood(0.05)
```

**Long session fatigue:** `energy -= 0.01` for every check after 20 messages, `energy -= 0.02` after 50.

### Persistence

State is serialized to JSON and stored in `PersistentMemory` under key `_nova_emotional_state` after every mutation. Loaded at boot. Nova's mood carries over between restarts.

### `get_emotional_prompt()`

Generates a 3-5 line section injected into the system prompt:

```
[Internal state: mood=upbeat, energy=high, warmth=elevated]
Tone guidance: Be warm and engaged. Humor is welcome. Show genuine interest.
```

The model uses this to color its output without explicitly announcing its state.

---

## 8. Memory Layers

There are four distinct memory systems, each with a different scope and purpose.

### Layer 1: Conversation History — `memory/store.py`

SQLite. Thread-safe via `threading.local()` connections. WAL mode for concurrent reads.

```sql
conversations (id INTEGER PK, title TEXT, created_at, updated_at)
messages      (id, conversation_id FK, role TEXT, content TEXT, created_at)
preferences   (key TEXT PK, value TEXT, updated_at)
tasks         (id, title, description, status, priority, created_at, updated_at)
knowledge     (id, category, key, value, created_at)
```

Every user message and every assistant response is stored immediately. This is the source of truth for the chat UI's history view. History is loaded fresh on conversation switch.

### Layer 2: Persistent Memory — `memory/persistent_memory.py`

Long-term facts that outlive individual conversations.

```sql
long_memory            (id, category, key, value, importance, access_count, created_at, updated_at)
user_profile           (key TEXT PK, value TEXT, updated_at)
emotional_log          (id, mood, energy, trigger, created_at)
conversation_summaries (id, conversation_id, summary, topics JSON, mood, created_at)
```

**Auto-extraction from user messages:**

```python
extract_facts_from_message(content):
    # Name
    re.search(r'my name is (\w+)', ...)      → remember("identity", "name", NAME)
    re.search(r'call me (\w+)', ...)
    # Preferences
    re.search(r'i prefer (.{10,50})', ...)   → remember("preferences", "preference_N", PREF)
    re.search(r'i (?:like|love|hate) (.+)', ...)
    # Projects
    re.search(r'working on (.{5,80})', ...)  → remember("projects", "current", PROJECT)
    # Location
    re.search(r'i live in (.+)', ...)        → remember("info", "location", LOCATION)
    # Goals
    re.search(r'i want to (.{10,100})', ...) → remember("goals", "goal_N", GOAL)
```

**Contradiction handling in `remember()`:**

```python
existing = get(category, key)
if existing and existing.value != new_value:
    update(value=new_value, importance=max(existing.importance, new_importance))
    audit_log("contradiction_resolved", ...)
elif existing:
    bump_access_count()
else:
    insert(...)
```

**`build_memory_context()`** returns a formatted prompt section with the top 10 most important/accessed memories + recent user profile facts.

### Layer 3: Emotional Memory — `core/emotions.py`

Persistent `EmotionalState` via `persistent_memory.set_user_fact("_nova_emotional_state", json)`. Carries mood across restarts. `emotional_log` table records mood snapshots with triggers for trend analysis.

### Layer 4: Working Memory — runtime state

Not persisted. Lives in-process:
- `ConversationContext` — current state, topic, message count
- `ProactiveEngine._queue` — pending outbound messages
- `SandboxExecutor._pending` — commands awaiting user approval
- `HealthMonitor._checks` — last health check results per service
- `AIEngine._conversation` — current session's rolling message history

---

## 9. Session Continuity

`core/session_continuity.py` — `SessionContinuity`

Bridges individual conversations into a longer narrative. Activated at session start/end.

### Database

```sql
session_log (
    id, conversation_id, started_at, ended_at,
    message_count, summary TEXT,
    topics TEXT (JSON array),
    mood_start TEXT, mood_end TEXT,
    key_facts TEXT (JSON array)
)

interaction_patterns (
    id, day_of_week INT, hour INT, activity TEXT, created_at
)
```

### Session Lifecycle

```
on_session_start(conversation_id, current_mood):
    INSERT INTO session_log(started_at=now, mood_start=current_mood)
    Record interaction_pattern(dow, hour, "active")

on_message(text, is_user):
    Extract topics → update session topics array
    Increment message_count

on_session_end(conversation_id, current_mood):
    Load all messages from store
    _build_summary(messages) → first + last user message + count
    _extract_key_facts(messages) → regex for decisions, reminders, plans (max 5)
    UPDATE session_log(ended_at, mood_end, summary, key_facts)
    persistent_memory.save_conversation_summary(summary, topics, mood_end)
```

### `_extract_key_facts(messages)` — Patterns

```python
r"I'?m going to (.{10,100})"    → decision
r"remind me (?:to )?(.{5,80})" → reminder
r"the plan is (.{10,100})"      → plan
r"I want to (.{10,80})"         → goal
r"I need to (.{10,80})"         → task
```

### `build_continuity_context()`

Injects into system prompt:

```
## Recent Conversations
- [2 days ago] Worked on darklock auth system. You were focused.
  Key facts: "I'm going to deploy this weekend"
  
- [yesterday] Discussed Govee light scenes. You seemed tired.

## Activity Patterns  
You're typically most active: Mon/Wed/Fri evenings (~8 PM CST)
```

---

## 10. Multi-Turn & Deferred Lookups

How Nova talks again without being prompted.

### `[LOOKUP: query]` — Deferred Web Search

When the model needs live data it doesn't have:

1. Model outputs: `"Give me a sec.\n[LOOKUP: current Ethereum price USD]"`
2. `_LOOKUP_RE` detects the tag in `full_response`
3. Tag is stripped → `visible_response = "Give me a sec."`
4. `done` is sent to client immediately (UI unlocks)
5. `threading.Thread(target=_schedule_lookup, daemon=True).start()`

Inside `_schedule_lookup()` (new event loop in daemon thread):
```python
search_text = await _run_browser_search(query, executor)
    # executor.execute({"action": "browser", "command": "search", "query": ...})

prompt = f"[SYSTEM: You said you'd look up '{query}'. Here's what I found:\n{search_text}\n
           Report back naturally in 1-3 sentences. No markdown.]"

response = await ai_engine.send_message(prompt)
memory.add_message(conv_id, "assistant", response)
conv_engine.queue_followup(response, category="followup", delay=0.3)
conv_engine.on_nova_response(response)
```

Client receives a `{"type":"proactive","category":"followup","content":"..."}` message seconds later — no user action required.

### `[CONTINUE: text]` — Immediate Follow-Up

For a second thought or continuation:

1. Model outputs: `"Darklock's healthy.\n[CONTINUE: last deploy was 4 days ago — might be worth a push.]"`
2. `_CONTINUE_RE` detects the tag
3. First part: `visible_response = "Darklock's healthy."`
4. `done` sent to client
5. `conv_engine.queue_followup("last deploy was 4 days ago — might be worth a push.", delay=1.5)`

After 1.5 seconds, the follow-up arrives as a second assistant bubble. Feels like Nova thought of something else.

### Restriction: Not Both

Personality prompt instructs the model: `DO NOT use both [LOOKUP:] and [CONTINUE:] in the same response.` One deferred action per turn.

---

## 11. Proactive Engine

`core/proactive.py` — `ProactiveEngine`

Background loop (default 30s interval). All messages are queued thread-safely, then flushed async at the end of each tick.

### Cooldowns

```python
_ALERT_COOLDOWN   = 120    # 2 min between same-service alerts
_CHECKIN_COOLDOWN = 1800   # 30 min between idle check-ins
_FOLLOWUP_COOLDOWN = 300   # 5 min between follow-ups
_THOUGHT_COOLDOWN = 3600   # 1 hour between random thoughts
```

### `_check_health_alerts()`

```python
for name, info in health_status["services"].items():
    if not info["healthy"]:
        if name not in alerted_services:
            # First failure
            alerted_services.add(name)
            if name in ("darklock", "pi5"):
                queue critical + sound=True
            else:
                queue high (3+ failures) or normal
        elif consecutive >= 3 and consecutive % 3 == 0:
            # Recurring — escalate every 3 checks
            queue escalation message
    else:
        if name in alerted_services:
            # Recovered
            alerted_services.discard(name)
            queue recovery message
```

### `_maybe_checkin()`

Fires if `idle_minutes > 45` and `now - last_checkin > 1800`. Generates a contextual AI message:

```python
prompt = f"[SYSTEM: Cayden hasn't said anything for {idle_mins} minutes.
            Time: {now}. Last topic: {topic}.
            Brief, casual check-in. Don't be needy. 1 sentence.]"
```

### `_maybe_share_thought()`

15% random chance, fires if `idle_minutes > 20` and `now - last_thought > 3600`. Generates an observation about system status or time of day.

### Message Queue Flush

```python
async _flush_queue():
    with queue_lock:
        pending = queue[:]
        queue.clear()
    for msg in pending:
        await broadcast_fn(msg)   # sends to all active WebSocket clients
```

---

## 12. Event Bridge

`core/event_bridge.py` — `EventBridge`

A translator between system subsystems (health monitor, scheduler, time) and the conversation engine's decision layer. Runs on a 15-second background loop.

### Event Types & Sources

```
_check_health()      → health_monitor.get_status()
                       push_event("event_health", {priority, message, service})

_check_calendar()    → upcoming events in 15-min window
                       push_event("event_calendar", {message, event_name, time})

_check_time_triggers():
    07:00–07:30 CST  → push_event("scheduled", {message: morning_greeting, day_key})
    2+ hrs active    → push_event("scheduled", {message: break_reminder})

_check_idle()        → push_event("idle_checkin", {})
```

### Flow

```
EventBridge._tick()
    ↓
conv_engine.push_event(trigger, data)
    ↓ (stored in event queue, processed on next _tick)
ConversationEngine._tick()
    ↓
evaluate_speech(trigger, data)
    ↓ SpeechDecision
if should_speak:
    _handle_speech_decision(decision, data)
        ↓
    _build_contextual_prompt(decision, data)
        ↓
    _generate_and_send(prompt, category, decision)
            ↓ asyncio.new_event_loop()
        ai_engine.send_message(prompt)
            ↓
        broadcast_fn({"type":"proactive", ...})
```

---

## 13. Command Pipeline

Three stages every command passes through before executing.

### Stage 1: Command Registry — `commands/registry.py`

A hardcoded whitelist of allowed action names and their required/optional parameters. Nothing not in the registry can proceed.

### Stage 2: Command Gateway — `gateway/validator.py`

`CommandGateway.validate(command)` returns `ValidationResult(approved, command, reason, requires_approval)`.

**Validation steps:**

```
1. Type check — must include "action" key
2. Action in registry?           ← reject if unknown
3. Required args present?        ← reject if missing
4. Blocked pattern scan on ALL arg values:
   - ;\s*rm\s, \|\s*rm\s, rm\s+-rf?\s+/
   - >\s*/dev/, mkfs\., dd\s+if=
   - \$\(, `[^`]+`              ← command substitution
   - eval|exec|sudo|su\s+-
   - curl.*\|\s*bash, wget.*\|\s*bash
   - python\s+-c, node\s+-e, perl\s+-e
   - chmod\s+777
5. Path validation (if "path" arg):
   - os.path.realpath() to resolve symlinks
   - ".." traversal → reject
   - Not in allowed_dirs (from config) → reject
   - Not in sensitive paths (/etc/shadow, /proc, /sys, /boot, ...) → reject
6. Script name validation (if run_script):
   - alphanumeric + underscore only
   - Must exist in pre-approved scripts directory
```

Low-risk commands → `approved=True, requires_approval=False`
Medium-risk (file_write, git_commit) → `approved=True, requires_approval=True`
High-risk (run_script) → `approved=True, requires_approval=True`
Any block → `approved=False`

### Stage 3: Sandbox Executor — `executor/sandbox.py`

```python
async execute(command):
    result = gateway.validate(command)
    if not result.approved:
        return {"status": "rejected", "reason": result.reason}
    if result.requires_approval:
        approval_id = uuid4()
        _pending[approval_id] = (command, asyncio.Event())
        return {"status": "pending", "approval_id": approval_id}
    return await _run(command)

async _run(command):
    handler = getattr(self, f"_cmd_{command['action']}", None)
    if not handler:
        return {"status": "error", "error": "No handler"}
    try:
        return await asyncio.wait_for(handler(command["args"]), timeout=30)
    except asyncio.TimeoutError:
        return {"status": "error", "error": "timed out after 30s"}
    except Exception as e:
        audit.log("executor", "error", {...})
        return {"status": "error", "error": str(e)}
```

**File write creates a backup first:**
```python
_cmd_file_write(args):
    if os.path.exists(path):
        shutil.copy2(path, path + ".nova_backup")
    open(path).write(content)
    return {"status": "executed", "output": "Written. Backup saved."}
```

**Subprocess runner:**
```python
async _proc(cmd, cwd=None):
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=PIPE, stderr=PIPE, cwd=cwd)
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    output = (stdout + stderr).decode(errors="replace")
    return output[:10000]  # hard truncation
```

---

## 14. Security Layer

Five independent security subsystems run as daemon threads.

### Process Watcher — `security/process_watcher.py`

Polls `psutil.process_iter()` every 5 seconds. Maintains a set of known PIDs. New unknown processes → checked against a blocklist of suspicious names (netcat variants, reverse shells, crypto miners, packet sniffers). If matched → `anomaly.on_suspicious_process()` → critical alert.

### Integrity Checker — `security/integrity.py`

At boot: SHA-256 hash all source files in `jarvis/`. Every 60 seconds: rehash and compare. If any file changes unexpectedly → `anomaly.on_integrity_violation()` → critical alert + audit log.

Excludes: `__pycache__`, `.pyc`, `node_modules`, `data/`, `logs/`.

### File Watcher — `security/file_watcher.py`

Watches configured directories (workspace) via `watchdog` library. Every create/modify/delete event is reported to:
- `anomaly.on_file_event(event_type, path)` — for bulk-delete detection
- Registered callbacks (e.g., project re-indexing)

### Anomaly Detector — `security/anomaly_detector.py`

Maintains deques of recent events for pattern detection:

```python
_command_failures: deque(maxlen=50)
_blocked_commands: deque(maxlen=50)
_file_events:      deque(maxlen=200)
```

**Patterns that trigger alerts:**

| Pattern | Threshold | Severity |
|---|---|---|
| Blocked commands | 3+ in 5 min | WARNING |
| File deletes | 10+ in 2 min | CRITICAL |
| Integrity violation | Any | CRITICAL |
| Suspicious process | Any match | CRITICAL |
| High resource usage | CPU >95% or RAM >90% | WARNING |

Alerts are stored in-memory (capped at 500). Real-time pushed to connected clients via WebSocket. REST endpoints for acknowledgement.

### Guardian — `core/guardian.py`

Central validation for all file and code operations. Checks:
- Is the target path in allowed directories?
- Is the operation type permitted?
- Does it violate identity safety boundaries?

All `FileManager` operations pass through `Guardian` before executing.

### Watchdog — `security/watchdog.py`

System-wide scanner that also monitors Govee light scenes for unexpected state changes (e.g., lights turned off by another app). Runs every 10 seconds.

---

## 15. Health Monitor & Self-Recovery

### `core/health_monitor.py` — `HealthMonitor`

Checks 9 services every 30 seconds:

```python
_check_ollama():    GET /api/tags → count models
_check_database():  SQLite SELECT 1 → measure db file size
_check_disk():      psutil.disk_usage() → < 90%
_check_memory():    psutil.virtual_memory() → < 90%
_check_cpu():       psutil.cpu_percent(0.5) → < 95%
_check_govee():     Govee /user/devices → count devices
_check_scene():     Check if scene task running in scheduler
_check_darklock():  HTTP GET /health on darklock server
_check_pi5():       DarklockClient SSH health check
```

Each check returns `ServiceCheck(name, healthy, latency_ms, message, ts)`.

Transition detection: if `prev.healthy != current.healthy`:
```python
audit.log("health", "service_transition", {service, from, to})
activity_tracker.system_event(f"{service} {'recovered' if healthy else 'went down'}")
```

`consecutive_failures[service]` increments on each failure, resets to 0 on recovery. Used by proactive engine and self-recovery to scale response urgency.

### `core/self_recovery.py` — `SelfRecovery`

Runs alongside health monitor (same 30s interval). For each failing service:

```python
if service == "ollama" and consecutive >= 2:
    subprocess.run(["systemctl", "restart", "ollama"])

if service == "darklock" and consecutive >= 3:
    darklock_client.attempt_restart()

if service == "database":
    # Run SQLite VACUUM + integrity_check
    store._conn.execute("PRAGMA integrity_check")
```

Reports all recovery attempts via `activity_tracker` and `audit_log`. Never silently fails.

---

## 16. Scheduler

`core/scheduler.py` — `Scheduler`

SQLite-backed CST task queue. Survives restarts.

```sql
scheduled_tasks (
    id INTEGER PK,
    name TEXT,
    action TEXT,
    run_at DATETIME,        -- CST
    repeat_seconds INTEGER, -- 0 = one-shot
    enabled INTEGER,
    last_run DATETIME,
    created_at DATETIME,
    data TEXT (JSON)        -- arbitrary payload
)
```

### Fire Logic (every 10s)

```python
_check_and_fire():
    tasks = SELECT * WHERE enabled=1 AND run_at <= now()
    for task in tasks:
        _fire_task(task)
        if task.repeat_seconds > 0:
            UPDATE run_at = now() + repeat_seconds
        else:
            UPDATE enabled = 0
```

`_fire_task()` calls all registered callbacks with the task dict. Event Bridge's morning briefing and break reminders are registered as scheduler callbacks.

### API

```python
scheduler.add_task(name, run_at, action, repeat_seconds=0, data={})
scheduler.schedule_reminder(name, minutes_from_now=30, message="...")
scheduler.schedule_recurring(name, every_n_seconds=3600, action="morning_brief")
scheduler.toggle_task(task_id, enabled=False)
scheduler.remove_task(task_id)
```

---

## 17. Cloud Router

`core/cloud_router.py` — `CloudRouter`

Transparent hybrid routing. The model itself doesn't know whether it's running local or cloud.

### Routing Decision

```python
should_route_to_cloud(message):
    return is_complex_task(message) or has_context_data(message)

is_complex_task(message):
    patterns = [
        r'(?:analyze|refactor|redesign|architect)',
        r'(?:write|create|generate)\s+(?:a\s+)?(?:full|complete|detailed)',
        r'(?:compare|difference between|pros and cons)',
        r'explain\s+(?:how|why|what).{20,}',
        r'(?:debug|troubleshoot)\s+.{30,}',
    ]
    return any(re.search(p, message, re.I) for p in patterns)

has_context_data(message):
    return (
        "```" in message        # code block
        or "http" in message    # URL
        or len(message) > 800   # long input
    )
```

### `send_message(system_prompt, messages, max_tokens, temperature)`

Converts Ollama format → Anthropic format, calls `api.anthropic.com/v1/messages`, returns response text. Returns empty string on any failure → `AIEngine` falls back to local Ollama automatically.

Model: `claude-sonnet-4-20250514`

---

## 18. Voice Pipeline

Optional. Enable in `config.yaml: voice: enabled: true`.

### Speech-to-Text — `voice/stt.py`

```
Audio (WebM/WAV from browser)
    ↓
Format detection (header bytes + filename)
    ↓ if WebM:
GStreamer pipeline: decodebin → audioconvert → audioresample → wavenc
    ↓
SpeechRecognition library (Google backend — free, no key needed)
    ↓
Transcribed text
```

### Text-to-Speech — `voice/tts.py`

```
Response text
    ↓
_prep_tts_text():
    strip **markdown** → plain text
    remove bullet points (•, -)
    collapse newlines → ". "
    normalize ellipses, spacing
    ↓
edge-tts (Microsoft neural TTS — en-GB-RyanNeural, +8% speed)
    ↓ MP3 audio bytes
gst-play-1.0 (GStreamer player, system audio)
```

Any new TTS request kills the current playback process before starting.

### Hotword Detection — `voice/hotword.py`

Listens continuously with faster-whisper (`base.en` model, local). Triggers full transcription pipeline when wake phrase detected (configurable in config.yaml).

---

## 19. WebSocket Protocol

Full message spec for `ws://host:8950/ws/chat`.

### Client → Server

```json
{"type": "message", "content": "...", "conversation_id": 123}
{"type": "interrupt"}
```

### Server → Client

```json
{"type": "conversation_created", "conversation_id": 123}
{"type": "token", "content": "..."}
{"type": "done", "full_response": "...", "conversation_id": 123,
                 "commands": [...], "emotion": {...}, "interrupted": false}
{"type": "alert", "id": "...", "severity": "...", "title": "...", "message": "..."}
{"type": "proactive", "category": "alert|followup|checkin|thought|multi_turn",
                      "content": "...", "priority": "normal|high|critical",
                      "sound": false}
{"type": "state", "state": "active|idle|inactive|sleeping"}
{"type": "error", "message": "..."}
```

### Interruption Semantics

When the client sends `{"type":"interrupt"}`:
1. `conv_engine.interrupt()` is called → sets `_interrupted = True`, clears multi-turn queue
2. Between every streamed token, websocket checks `conv_engine.was_interrupted()`
3. If true: stops streaming, sends `done` with `"interrupted": true`

The interrupt only affects mid-stream responses. Typing before sending does NOT interrupt (a stale interrupt flag is consumed/discarded right before streaming begins).

### Connection Management

```python
_active_connections: list[WebSocket] = []

on accept: _active_connections.append(ws)
on disconnect/error: _active_connections.remove(ws)

broadcast_alert(alert):    send to all _active_connections
broadcast_proactive(msg):  send to all _active_connections
broadcast_state(state):    send to all _active_connections
```

---

## 20. Configuration Reference

`config.yaml` — all keys, their types, and defaults.

```yaml
server:
  host: "0.0.0.0"       # bind address
  port: 8950             # API port

ai:
  model: "llama3.1:8b"              # any installed Ollama model
  ollama_url: "http://127.0.0.1:11434"
  temperature: 0.7                  # 0.0 = deterministic, 1.0 = creative
  max_tokens: 4096                  # max output tokens
  num_ctx: 8192                     # context window (prompt + history)
  max_history: 50                   # rolling conversation window

personality:
  name: "Nova"
  tone: "casual"                    # casual | formal | concise
  owner: "Cayden"
  greeting: "Hey Cayden! What are we working on?"

voice:
  enabled: false
  stt_model: "base.en"              # faster-whisper model size
  tts_model: "en_US-lessac-medium"  # Piper model

security:
  allowed_dirs: ["~"]               # sandbox root for file operations
  command_timeout: 30               # subprocess timeout (seconds)
  max_memory_mb: 512
  process_watch_interval: 5         # seconds
  integrity_check_interval: 60      # seconds

health:
  check_interval: 30                # seconds between service checks

recovery:
  check_interval: 30

proactive:
  check_interval: 30

scheduler:
  timezone: "America/Chicago"
  check_interval: 10                # seconds between scheduler ticks

watcher:
  directories: ["~/discord bot/discord bot"]
  interval: 5

anomaly:
  check_interval: 10

watchdog:
  interval: 10

indexer:
  workspace: "~/discord bot/discord bot"
  max_file_size_kb: 200
  max_lines_per_file: 150

weather:
  city: "Dallas"
  country: "US"

govee:
  enabled: true                     # requires env: GOVEE_API_KEY

google:
  enabled: true                     # requires: data/google_credentials.json

darklock:
  enabled: true
  pi5_host: "192.168.50.150"
  # other auth via env vars
```

**Environment variables** (set in `.env`):

```
ANTHROPIC_API_KEY=...       # cloud routing (optional)
OPENWEATHER_API_KEY=...     # live weather (optional)
GOVEE_API_KEY=...           # smart lights (optional)
```

---

## 21. Full Data Flow Diagram

```
┌──────────────── User Input ────────────────────────┐
│                                                     │
│  WebSocket message                                  │
│      {"type":"message","content":"..."}             │
└─────────────────────┬───────────────────────────────┘
                      │
              ws_chat() handler
                      │
         ┌────────────▼─────────────┐
         │   Pre-processing layer    │
         │  · add to memory          │
         │  · conv_engine notify     │
         │  · extract user facts     │
         │  · emotion update         │
         │  · interrupt flag clear   │
         └────────────┬─────────────┘
                      │
         ┌────────────▼─────────────┐
         │     Prompt Builder        │
         │  Intent detect (9 types) │
         │  Assemble system prompt:  │
         │  · Identity (always)      │
         │  · Personality tone       │
         │  · Domain instructions    │
         │  · Weather (if relevant)  │
         │  · Emotional hint         │
         │  · Session continuity     │
         │  · Persistent memory      │
         │  · Project context        │
         └────────────┬─────────────┘
                      │
         ┌────────────▼─────────────┐
         │      Cloud Router         │
         │  is_complex_task()?       │
         │  has_context_data()?      │
         └────┬──────────┬──────────┘
              │YES        │NO
         ┌────▼────┐ ┌───▼──────┐
         │ Claude  │ │  Ollama  │
         │  API    │ │ /api/chat│
         └────┬────┘ └───┬──────┘
              └────┬──────┘
                   │ stream tokens
         ┌─────────▼──────────┐
         │  Token stream loop  │
         │  · check interrupt  │
         │  · send each token  │
         └─────────┬──────────┘
                   │ full_response assembled
         ┌─────────▼──────────────────────┐
         │       Response Parser           │
         │  · detect [LOOKUP: query]       │
         │  · detect [CONTINUE: text]      │
         │  · extract JSON commands        │
         │  · strip tags → visible_resp    │
         └─────────┬──────────────────────┘
                   │
         ┌─────────▼──────────────────────┐
         │      Command Pipeline           │
         │  for each command in response:  │
         │  · gateway.validate()           │
         │      whitelist + path + blocks  │
         │  · executor._run() or queue     │
         │  · emotion feedback             │
         └─────────┬──────────────────────┘
                   │
         ┌─────────▼──────────────────────┐
         │   WebSocket send "done"         │
         │   {full_response, commands,     │
         │    emotion, conversation_id}    │
         └─────────┬──────────────────────┘
                   │ (client unlocked)
         ┌─────────▼──────────────────────┐
         │    Post-send async actions      │
         │                                 │
         │  [LOOKUP: query] detected?      │
         │  └─ Thread: web search          │
         │          AI summarize           │
         │          queue_followup(0.3s) ──┤
         │                                 │
         │  [CONTINUE: text] detected?     │
         │  └─ queue_followup(1.5s) ───────┤
         └─────────────────────────────────┘

                      ···

┌──────────── Background Systems (always running) ──────────┐
│                                                             │
│  ProactiveEngine (30s loop)                                 │
│  └─ HealthMonitor alerts → queue_message()                  │
│     Idle check-ins (45+ min quiet)                          │
│     Random thoughts (15% chance, 1hr cooldown)             │
│     → broadcast_proactive() → client "proactive" message   │
│                                                             │
│  ConversationEngine (5s loop)                               │
│  └─ _update_state() → ACTIVE/IDLE/INACTIVE/SLEEPING         │
│     Process event queue from EventBridge                    │
│     evaluate_speech() → maybe broadcast                     │
│                                                             │
│  EventBridge (15s loop)                                     │
│  └─ Health events → push_event("event_health")              │
│     Calendar events → push_event("event_calendar")          │
│     Time triggers → push_event("scheduled")                 │
│                                                             │
│  HealthMonitor (30s loop)        ProcessWatcher (5s loop)   │
│  SelfRecovery (30s loop)         IntegrityChecker (60s loop)│
│  FileWatcher (5s loop)           AnomalyDetector (10s loop) │
│  Watchdog (10s loop)             Scheduler (10s loop)       │
└─────────────────────────────────────────────────────────────┘
```
