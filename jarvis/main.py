"""
Nova — Main Entry Point
========================
Initializes every subsystem and starts the FastAPI server.

Boot order:
  1. Load configuration
  2. Initialize audit logger (append-only JSONL)
  3. Initialize memory store (SQLite) + persistent memory
  4. Initialize emotional engine
  5. Initialize security (process watcher + integrity + file watcher + anomaly detector)
  6. Initialize command system (registry → gateway → executor)
  7. Initialize AI core (Ollama + personality + prompt builder with all context)
  8. Initialize project indexer
  9. Initialize learning engine
  10. Initialize project manager
  11. Create FastAPI app, start background threads, and launch uvicorn

Shutdown is graceful — security threads are daemonic and exit with the process.
"""

import os
import signal
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

# Load .env from the jarvis directory before anything else
load_dotenv(Path(__file__).parent / ".env")

from config import JarvisConfig
from core.ai_engine import AIEngine
from core.personality import Personality
from core.prompt_builder import PromptBuilder
from core.emotions import EmotionalEngine
from core.project_indexer import ProjectIndexer
from commands.registry import CommandRegistry
from gateway.validator import CommandGateway
from executor.sandbox import SandboxExecutor
from memory.store import MemoryStore
from memory.learning import LearningEngine
from memory.persistent_memory import PersistentMemory
from memory.supervised_learning import SupervisedLearning
from logs.audit import AuditLogger
from security.process_watcher import ProcessWatcher
from security.integrity import IntegrityChecker
from security.file_watcher import FileWatcher
from security.anomaly_detector import AnomalyDetector
from security.watchdog import Watchdog
from project.manager import ProjectManager
from core.activity_tracker import ActivityTracker
from core.health_monitor import HealthMonitor
from core.self_recovery import SelfRecovery
from core.file_manager import FileManager
from core.scheduler import Scheduler
from core.guardian import Guardian
from core.proactive import ProactiveEngine
from core.identity import IdentityCore
from core.session_continuity import SessionContinuity
from core.conversation_engine import ConversationEngine
from core.event_bridge import EventBridge
from core.vision_engine import VisionEngine
from core.process_manager import ProcessManager
from core.tool_system import build_tool_registry, ToolExecutor
from core.system_monitor import SystemMonitor
from core.goal_tracker import GoalTracker
from core.skill_memory import SkillMemory
from core.service_overseer import ServiceOverseer
from core.code_workshop import CodeWorkshop
from core.autonomous_agent import AutonomousAgent
from security.activity_ledger import ActivityLedger
from security.sentinel import SecuritySentinel
from api.server import create_app


def main():
    load_dotenv()
    base_dir = Path(__file__).parent.resolve()
    config = JarvisConfig(base_dir / "config.yaml")

    # 1. Audit logger — logs everything from this point on
    audit = AuditLogger(base_dir / "logs")
    audit.log("system", "startup", {"version": "2.1.0"})

    # 2. Memory (SQLite) + persistent cross-conversation memory
    memory = MemoryStore(base_dir / "data" / "nova.db", audit)
    persistent_memory = PersistentMemory(memory, audit)

    # Seed owner info
    persistent_memory.set_user_fact("name", "Cayden")
    persistent_memory.set_user_fact("role", "owner")

    # 3. Emotional engine
    emotions = EmotionalEngine(persistent_memory, audit)

    # 3b. Identity Core — immutable definition of who Nova is
    identity = IdentityCore()
    audit.log("identity", "loaded", {
        "name": identity.name, "version": identity.version,
    })

    # 3c. Session Continuity — cross-conversation memory and context
    session_continuity = SessionContinuity(memory, persistent_memory, audit)

    # 4. Security subsystems
    integrity = IntegrityChecker(base_dir, audit)
    watcher = ProcessWatcher(audit)
    anomaly = AnomalyDetector(config, audit, memory)
    file_watcher = FileWatcher(config, audit)

    # Wire anomaly detector into file watcher
    def _on_file_event(event):
        anomaly.on_file_event(event.event_type, event.path)
    file_watcher.add_callback(_on_file_event)

    # 5. Command system
    registry = CommandRegistry()
    gateway = CommandGateway(registry, audit, config)
    executor = SandboxExecutor(gateway, audit, config)

    # 6. AI core with all context layers
    personality = Personality(config)
    prompt_builder = PromptBuilder(personality, registry, memory)
    prompt_builder.set_persistent_memory(persistent_memory)
    prompt_builder.set_emotional_engine(emotions)
    prompt_builder.set_identity_core(identity)
    prompt_builder.set_session_continuity(session_continuity)
    ai_engine = AIEngine(config, prompt_builder, audit)

    # Wire persistent memory to use the fast LLM for smart extraction
    persistent_memory.set_ai_config(
        ollama_url=config.ollama_url,
        fast_model=config.ai_model_fast or config.ai_model,
    )
    # Run importance decay on startup to keep memory fresh
    persistent_memory.decay_old_memories()

    # 6c. Vision engine — local image understanding via Ollama
    vision_engine = VisionEngine(config)
    if vision_engine.enabled:
        audit.log("vision", "engine_started", {"model": vision_engine.model})

    # 6b. Live weather provider (IP-based geolocation, refreshes every 15 min)
    openweather_key = os.environ.get("OPENWEATHER_API_KEY", "")
    if openweather_key:
        from integrations.weather import WeatherContextProvider
        weather_provider = WeatherContextProvider(
            api_key=openweather_key,
            fallback_city=config.get("weather.city", "Dallas"),
        )
        weather_provider.start()
        prompt_builder.set_weather_provider(weather_provider)
        audit.log("weather", "provider_started", {"fallback_city": config.get("weather.city", "Dallas")})
    else:
        audit.log("weather", "provider_skipped", {"reason": "OPENWEATHER_API_KEY not set"})

    # 6d. Spotify integration — playback control via Spotify Web API
    spotify_client = None
    spotify_provider = None
    spotify_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
    spotify_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
    spotify_redirect = os.environ.get("SPOTIFY_REDIRECT_URI", "")
    if spotify_id and spotify_secret:
        from integrations.spotify import SpotifyClient, SpotifyContextProvider
        spotify_client = SpotifyClient(spotify_id, spotify_secret, spotify_redirect)
        executor.set_spotify_client(spotify_client)
        spotify_provider = SpotifyContextProvider(spotify_client)
        spotify_provider.start()
        prompt_builder.set_spotify_provider(spotify_provider)
        audit.log("spotify", "integration_started", {
            "authenticated": spotify_client.is_authenticated,
        })
    else:
        audit.log("spotify", "integration_skipped", {"reason": "SPOTIFY_CLIENT_ID/SECRET not set"})

    # 7. Project indexer
    indexer = ProjectIndexer(config, memory, audit)
    prompt_builder.set_project_indexer(indexer)

    # Auto-index the workspace if configured
    workspace = config.get("indexer.workspace")
    if workspace:
        workspace = os.path.expanduser(workspace)
        if os.path.isdir(workspace):
            audit.log("indexer", "auto_index", {"path": workspace})
            result = indexer.index_directory(workspace)
            audit.log("indexer", "auto_index_done", result)

    # Add workspace to file watcher
    watch_dirs = config.get("watcher.directories", [])
    if workspace:
        watch_dirs = [workspace] + (watch_dirs or [])
    for d in (watch_dirs or []):
        file_watcher.watch(d)

    # 8. Learning engine
    learning = LearningEngine(memory, audit, base_dir)

    # 8b. Supervised learning — three-layer system
    supervised = SupervisedLearning(memory, audit, base_dir, config)
    prompt_builder.set_supervised_learning(supervised)

    # 9. Project manager
    project_mgr = ProjectManager(audit, config)

    # 10. Activity tracker — transparent log of everything Nova does
    activity_tracker = ActivityTracker(audit)
    activity_tracker.system_event("Nova starting up", details={"version": "2.1.0"})

    # 11. Security guardian — central validation layer
    guardian = Guardian(config, audit, activity_tracker)

    # 12. Controlled file manager
    file_mgr = FileManager(config, audit, activity_tracker, guardian)

    # 13. Health monitor — always-on service checks
    health_monitor = HealthMonitor(
        config, audit, activity_tracker,
        db_path=base_dir / "data" / "nova.db")

    # 14. Self-recovery engine
    self_recovery = SelfRecovery(health_monitor, audit, activity_tracker, config)

    # 14b. Darklock integration — bug reports, Pi5 SSH, server management
    darklock_client = None
    if config.get("darklock.enabled", True):
        from integrations.darklock import DarklockClient
        darklock_client = DarklockClient(config, audit, activity_tracker)
        # Wire into health monitor and self-recovery
        health_monitor.set_darklock_client(darklock_client)
        self_recovery.set_darklock_client(darklock_client)
        # Wire into executor so voice/chat commands can use it
        executor.set_darklock_client(darklock_client)
        audit.log("darklock", "integration_started", {
            "pi5_host": config.get("darklock.pi5_host", "192.168.50.150"),
        })
        activity_tracker.system_event("Darklock integration active",
            details={"pi5": config.get("darklock.pi5_host", "192.168.50.150")})

    # 14c. Darklock Security Bridge — file integrity monitoring for Darklock source
    from integrations.darklock_security import DarklockSecurityBridge
    darklock_security = DarklockSecurityBridge(config, audit, activity_tracker, anomaly)
    integrity.add_darklock_callback(darklock_security.on_file_changes)
    audit.log("darklock_security", "bridge_started", {
        "watching": len(darklock_security.get_status().get("darklock_files_watched", [])),
    })

    # 15. CST task scheduler
    scheduler = Scheduler(base_dir / "data" / "nova.db", audit, activity_tracker)

    # 15b. Process Manager — spawn, monitor, kill background processes
    process_mgr = ProcessManager(config, audit, activity_tracker)

    # 15c. Goal Tracker — multi-step goal management
    goal_tracker = GoalTracker(base_dir / "data" / "nova.db", audit, activity_tracker)

    # 15d. Skill Memory — learned reusable procedures
    skill_memory = SkillMemory(base_dir / "data" / "nova.db", audit)

    # 15e. System Monitor — real-time system vitals with threshold alerts
    system_monitor = SystemMonitor(config, audit, activity_tracker)

    # 15f. Service Overseer — manages long-running services with health checks & auto-restart
    service_overseer = ServiceOverseer(process_mgr, audit, activity_tracker)
    services_config = config.get("services", [])
    if services_config:
        service_overseer.register_from_config(services_config)

    # 15g. Activity Ledger — unified event stream for all system activity
    activity_ledger = ActivityLedger(audit, activity_tracker)

    # Wire ledger into existing modules as callbacks
    def _ledger_file_event(event):
        activity_ledger.on_file_event(event)
    file_watcher.add_callback(_ledger_file_event)

    # Wire service overseer state changes into ledger
    service_overseer.on_state_change(activity_ledger.on_service_change)

    # Wire process manager into ledger
    process_mgr.on_process_change(activity_ledger.on_process_event)

    # Wire system monitor alerts into ledger
    system_monitor.on_alert(activity_ledger.on_system_alert)

    # 15h. Code Workshop — AST-aware code editing, building, scaffolding
    code_workshop = CodeWorkshop(guardian, audit, activity_tracker)

    # 15i. Tool System — structured tool calling for the AI
    tool_registry = build_tool_registry({
        "executor": executor,
        "scheduler": scheduler,
        "process_manager": process_mgr,
        "goal_tracker": goal_tracker,
        "skill_memory": skill_memory,
        "system_monitor": system_monitor,
        "service_overseer": service_overseer,
        "code_workshop": code_workshop,
        "activity_ledger": activity_ledger,
    })
    tool_executor = ToolExecutor(tool_registry, audit, activity_tracker)

    # 15j. Autonomous Agent — self-directed multi-step task execution
    autonomous_agent = AutonomousAgent(tool_executor, guardian, audit, activity_tracker)

    # Wire ledger critical events into agent for auto-response
    def _ledger_to_agent(event):
        if event.severity == "critical" and event.source != "correlator":
            autonomous_agent.create_reactive_task(
                event_title=event.title,
                event_category=event.category,
                event_details=event.details,
            )
    activity_ledger.on_event(_ledger_to_agent)

    # Register autonomous_agent tool after agent exists
    from core.tool_system import ToolCall as _TC
    def _tool_create_task(args):
        task = autonomous_agent.create_task(
            title=args.get("title", ""),
            trigger="nova_tool_call",
            steps=args.get("steps", []),
            reasoning=args.get("reasoning", ""),
            timeout=args.get("timeout", 600),
        )
        return task.to_dict()
    tool_registry.register("create_task", "Create an autonomous multi-step task that Nova executes herself", {
        "title": "Task title",
        "steps": 'List of steps: [{"action": "tool_name", "args": {...}, "description": "..."}]',
        "reasoning": "(optional) Reasoning for why this task is needed",
        "timeout": "(optional) Max seconds, default 600",
    }, _tool_create_task)

    def _tool_task_status(args):
        task_id = args.get("task_id")
        if task_id:
            return autonomous_agent.get_task(task_id) or "Task not found"
        return autonomous_agent.get_status()
    tool_registry.register("task_status", "Check the status of autonomous tasks", {
        "task_id": "(optional) Specific task ID, or omit for overall agent status",
    }, _tool_task_status)

    # Wire new modules into prompt builder
    prompt_builder.set_tool_registry(tool_registry)
    prompt_builder.set_system_monitor(system_monitor)
    prompt_builder.set_goal_tracker(goal_tracker)
    prompt_builder.set_skill_memory(skill_memory)
    prompt_builder.set_config(config)

    # 15g. Conversation Awareness — per-conversation topic/entity tracking
    from core.conversation_awareness import ConversationAwareness
    conv_awareness = ConversationAwareness()
    prompt_builder.set_conversation_awareness(conv_awareness)

    # 16. Proactive messaging — Nova speaks on her own
    proactive = ProactiveEngine(
        config=config,
        ai_engine=ai_engine,
        health_monitor=health_monitor,
        audit=audit,
        activity_tracker=activity_tracker,
    )
    from api.websocket import broadcast_proactive
    proactive.set_broadcast(broadcast_proactive)

    # 16b. Conversation Engine — continuous conversational state machine
    from api.websocket import broadcast_state
    conv_engine = ConversationEngine(audit, config)
    conv_engine.set_broadcast(broadcast_proactive)
    conv_engine.set_ai_engine(ai_engine)
    conv_engine.set_emotions(emotions)
    conv_engine.set_session_continuity(session_continuity)
    conv_engine.set_health_monitor(health_monitor)
    conv_engine.set_scheduler(scheduler)
    conv_engine.set_persistent_memory(persistent_memory)

    # 16c. Event Bridge — routes system events through the conversation engine
    event_bridge = EventBridge(conv_engine, audit)
    event_bridge.set_health_monitor(health_monitor)
    event_bridge.set_scheduler(scheduler)

    # 17. Watchdog — system-wide process scanner + Govee/scene monitor
    watchdog = Watchdog(anomaly, audit, activity_tracker)

    # 17b. Security Sentinel — autonomous Darklock-wide security monitoring
    sentinel = SecuritySentinel(
        config, audit, activity_tracker, guardian,
        anomaly=anomaly, code_workshop=code_workshop,
        autonomous_agent=autonomous_agent, activity_ledger=activity_ledger,
    )

    # 18. FastAPI app — pass ALL modules
    app = create_app(
        config=config,
        ai_engine=ai_engine,
        gateway=gateway,
        executor=executor,
        memory=memory,
        audit=audit,
        learning=learning,
        project_mgr=project_mgr,
        watcher=watcher,
        integrity=integrity,
        # New modules
        persistent_memory=persistent_memory,
        emotions=emotions,
        anomaly=anomaly,
        file_watcher=file_watcher,
        indexer=indexer,
        # Advanced systems
        activity_tracker=activity_tracker,
        guardian=guardian,
        file_manager=file_mgr,
        health_monitor=health_monitor,
        self_recovery=self_recovery,
        scheduler=scheduler,
        watchdog=watchdog,
        # Darklock
        darklock=darklock_client,
        darklock_security=darklock_security,
        # Proactive messaging
        proactive=proactive,
        # Identity & continuity
        identity=identity,
        session_continuity=session_continuity,
        # Conversation engine
        conversation_engine=conv_engine,
        event_bridge=event_bridge,
        # Vision
        vision_engine=vision_engine,
        # Supervised learning
        supervised_learning=supervised,
        # JARVIS-tier systems
        process_manager=process_mgr,
        tool_registry=tool_registry,
        tool_executor=tool_executor,
        system_monitor=system_monitor,
        goal_tracker=goal_tracker,
        skill_memory=skill_memory,
        # Conversation awareness
        conversation_awareness=conv_awareness,
        # JARVIS-tier systems (Phase 2)
        service_overseer=service_overseer,
        activity_ledger=activity_ledger,
        code_workshop=code_workshop,
        autonomous_agent=autonomous_agent,
        # Security Sentinel
        security_sentinel=sentinel,
        # Spotify
        spotify_client=spotify_client,
    )

    # Start background security threads
    watcher.start(interval=config.get("security.process_watch_interval", 5) or 5)
    integrity.start(interval=config.get("security.integrity_check_interval", 60) or 60)
    anomaly.start(interval=config.get("anomaly.check_interval", 10) or 10)
    file_watcher.start(interval=config.get("watcher.interval", 5) or 5)

    # Start advanced subsystems
    system_monitor.start(interval=config.get("monitoring.interval", 5) or 5)
    process_mgr.start_monitor(interval=config.get("process_manager.monitor_interval", 3) or 3)
    health_monitor.start(interval=config.get("health.check_interval", 30) or 30)
    self_recovery.start(interval=config.get("recovery.check_interval", 30) or 30)
    scheduler.start(interval=config.get("scheduler.check_interval", 10) or 10)
    watchdog.start(interval=config.get("watchdog.interval", 10) or 10)
    proactive.start(interval=config.get("proactive.check_interval", 30) or 30)
    sentinel.start(interval=config.get("sentinel.scan_interval", 120) or 120)
    supervised.start(interval=3600)  # Check hourly, runs nightly 3-4 AM CST
    conv_engine.start(interval=5)
    event_bridge.start(interval=15)

    # Start JARVIS-tier subsystems
    service_overseer.start(interval=config.get("overseer.interval", 10) or 10)
    autonomous_agent.start(interval=config.get("agent.interval", 5) or 5)

    activity_tracker.system_event("All subsystems started")
    audit.log("system", "ready", {"host": config.host, "port": config.port})

    # ── Startup memory report — verify what survived the last shutdown ──
    _facts = persistent_memory.get_all_user_facts()
    _memories = persistent_memory.get_important_memories(5)
    _summaries = persistent_memory.get_recent_summaries(3)
    audit.log("memory", "startup_loaded", {
        "user_facts": len(_facts),
        "long_term_memories": len(_memories),
        "conversation_summaries": len(_summaries),
        "emotional_state": emotions.state.to_dict(),
        "sample_facts": {k: v for k, v in list(_facts.items())[:5]},
        "sample_memories": [m.get("key", "") for m in _memories],
    })
    print(f"  Memory: {len(_facts)} facts, {len(_memories)} memories, {len(_summaries)} summaries loaded")

    # ── Graceful shutdown — checkpoint WAL so nothing is lost ──
    def _shutdown_handler(signum, frame):
        print("\n  Shutting down — flushing memory...")
        emotions._save_state()
        memory.close()
        audit.log("system", "shutdown", {"signal": signum})
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    print(f"""
  ╔══════════════════════════════════════╗
  ║       Nova  v{identity.version}                ║
  ╠══════════════════════════════════════╣
  ║  Owner:     Cayden                  ║
  ║  Backend:    http://{config.host}:{config.port:<5}     ║
  ║  Model:      {config.ai_model:<24}║
  ║  Voice:      {'enabled' if config.voice_enabled else 'disabled':<24}║
  ║  Security:   active                  ║
  ║  Guardian:   active                  ║
  ║  Health:     monitoring              ║
  ║  Recovery:   armed                   ║
  ║  Watchdog:   armed                   ║
  ║  Scheduler:  CST                     ║
  ║  Darklock:   {'connected' if darklock_client else 'disabled':<24}║
  ║  Proactive:  active                  ║
  ║  Emotions:   active                  ║
  ║  Memory:     persistent              ║
  ║  Identity:   locked                  ║
  ║  Continuity: active                  ║
  ║  ConvEngine: active                  ║
  ║  Tools:      {len(tool_registry.list_tools()):<24}║
  ║  Processes:  managed                  ║
  ║  SysMonitor: active                  ║
  ║  Goals:      tracking                 ║
  ║  Skills:     learning                 ║
  ║  Watcher:    {len(watch_dirs or [])} dir(s)                ║
  ║  Overseer:   {len(service_overseer.list_services())} service(s)             ║
  ║  Ledger:     active                  ║
  ║  Workshop:   active                  ║
  ║  Agent:      autonomous              ║
  ║  Sentinel:   armed                   ║
  ║  Feeling:    {emotions.state.dominant_feeling:<24}║
  ╚══════════════════════════════════════╝
  {emotions.get_greeting_modifier()}
""")

    uvicorn.run(app, host=config.host, port=config.port, log_level="warning")


if __name__ == "__main__":
    main()
