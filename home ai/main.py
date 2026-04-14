"""
Home AI Assistant - Main Entry Point
=====================================
Initializes all modules and starts the system.

Startup order:
  1. Load configuration
  2. Initialize logging
  3. Initialize command parser
  4. Initialize permission manager
  5. Initialize executor
  6. Initialize SSH module
  7. Initialize AI interface
  8. Initialize orchestrator
  9. Initialize API server
  10. Start remote log backup
  11. Start watchdog
  12. Start web server

Shutdown is graceful — all threads are cleaned up.
"""

import asyncio
import os
import signal
import sys
from pathlib import Path

import uvicorn
import yaml
from dotenv import load_dotenv

from ai_interface import AIInterface
from api_server import APIServer
from backup import RemoteLogBackup
from command_parser import CommandParser
from executor import CommandExecutor
from learning import LearningDB, LearningEngine
from logger import HomeAILogger
from orchestrator import Orchestrator
from permissions import PermissionManager
from ssh_module import SSHModule
from watchdog import Watchdog
from web_server import create_web_app
from log_cleaner import LogCleaner


def load_config() -> dict:
    """Load configuration from config.yaml."""
    config_path = os.environ.get(
        "HOME_AI_CONFIG",
        Path(__file__).parent / "config.yaml"
    )
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def main():
    """Initialize and start the Home AI system."""
    # Load .env file
    env_path = Path(__file__).parent / ".env"
    if env_path.is_file():
        load_dotenv(env_path)

    # Step 1: Load config
    config = load_config()
    print("✓ Configuration loaded")

    # Step 2: Initialize logging
    logger = HomeAILogger(config)
    logger.info("main", "=== Home AI Assistant Starting ===")
    print("✓ Logging initialized")

    # Step 3: Command parser
    parser = CommandParser(config, logger)
    print("✓ Command parser initialized")

    # Step 4: Permission manager
    permissions = PermissionManager(config, logger)
    print("✓ Permission manager initialized")

    # Register a console-based approval callback for direct API requests
    # The web UI handles approval through the frontend
    def console_approval(name: str, risk: str, params: dict, reasoning: str) -> bool:
        """Fallback approval prompt for non-UI contexts."""
        print(f"\n⚠️  Command approval required:")
        print(f"   Command: {name}")
        print(f"   Risk:    {risk}")
        print(f"   Params:  {params}")
        print(f"   Reason:  {reasoning}")
        response = input("   Approve? (y/N): ").strip().lower()
        return response in ("y", "yes")

    permissions.set_approval_callback(console_approval)

    # Step 5: Executor
    executor = CommandExecutor(config, logger)
    print("✓ Command executor initialized")

    # Step 6: SSH module
    ssh = SSHModule(config, logger)
    print("✓ SSH module initialized")

    # Step 7: AI interface
    try:
        ai = AIInterface(config, logger)
        print("✓ AI interface initialized")
    except ValueError as e:
        logger.critical("main", f"AI initialization failed: {e}")
        print(f"✗ AI initialization failed: {e}")
        print("  Set the CLAUDE_API_KEY environment variable in .env")
        sys.exit(1)

    # Step 7.5: Learning engine
    learning_db_path = Path(__file__).parent / "learning.db"
    learning_db = LearningDB(learning_db_path)
    learning_engine = LearningEngine(config, logger, learning_db)
    print("✓ Learning engine initialized")

    # Step 8: Orchestrator
    orchestrator = Orchestrator(
        config=config,
        logger=logger,
        ai=ai,
        parser=parser,
        permissions=permissions,
        executor=executor,
        ssh=ssh,
        learning=learning_engine,
    )
    print("✓ Orchestrator initialized")

    # Step 9: API server
    api_server = APIServer(config, logger)
    api_server.set_orchestrator(orchestrator)
    print("✓ API server initialized")

    # Step 10: Remote log backup
    backup = RemoteLogBackup(config, logger)
    backup.start()
    print("✓ Remote log backup started")

    # Step 11: Watchdog
    watchdog = Watchdog(config, logger)
    watchdog.set_executor(executor)
    watchdog.set_ssh_module(ssh)
    watchdog.start()
    print("✓ Watchdog started")

    # Step 12: Log Cleaner (auto-deletes old logs/backups on schedule)
    log_cleaner = LogCleaner(config, logger)
    log_cleaner.start()
    print("✓ Log cleaner started (auto-rotation active)")

    # Step 13: Create combined web app
    web_app = create_web_app(config, logger, api_server)
    print("✓ Web application ready")

    # Graceful shutdown
    def shutdown(sig, frame):
        logger.info("main", f"Received signal {sig}, shutting down...")
        print("\n⏹ Shutting down...")
        # Save learning session summary before exit
        learning_engine.save_session_summary()
        log_cleaner.stop()
        watchdog.stop()
        backup.stop()
        logger.info("main", "=== Home AI Assistant Stopped ===")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start the server
    host = config.get("api", {}).get("host", "127.0.0.1")
    port = config.get("api", {}).get("port", 8900)

    logger.info("main", f"Starting server on {host}:{port}")
    print(f"\n🏠 Home AI Assistant running at http://{host}:{port}")
    print(f"   API docs: disabled for security")
    print(f"   Frontend: http://localhost:3000 (dev) or http://{host}:{port} (prod)")
    print(f"   Press Ctrl+C to stop\n")

    uvicorn.run(web_app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
