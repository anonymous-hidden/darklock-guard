"""
Home AI Assistant - REST API Server (FastAPI)
==============================================
Local API server for external integrations.

SECURITY:
- Bound to localhost by default (127.0.0.1)
- All endpoints require API key authentication
- The AI cannot modify or extend routes
- All requests are logged
"""

import os
import secrets
import time
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field

from logger import HomeAILogger

# ── Pydantic models ────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    source: str = Field(default="api", max_length=50)

class ChatResponse(BaseModel):
    reply: str
    commands: list[dict] = []
    execution_results: list[dict] = []

class CommandRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=100)
    params: dict = Field(default_factory=dict)

class HealthResponse(BaseModel):
    status: str
    uptime_seconds: float
    version: str

class StatusResponse(BaseModel):
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None

class FeedbackRequest(BaseModel):
    message_id: str = Field(..., min_length=1, max_length=200)
    rating: int = Field(..., ge=-1, le=1)  # -1=bad, 0=neutral, 1=good
    user_message: str = Field(default="", max_length=10000)
    ai_response: str = Field(default="", max_length=10000)
    correction: str = Field(default="", max_length=5000)

class LearnFactRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=200)
    value: str = Field(..., min_length=1, max_length=2000)
    category: str = Field(default="fact", max_length=50)


# ── API Server Class ───────────────────────────────────────

class APIServer:
    """FastAPI-based REST API for the Home AI system."""

    VERSION = "1.0.0"

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("api", {})
        self._logger = logger
        self._start_time = time.time()

        # API key from environment
        self._api_key = os.environ.get("HOME_AI_API_KEY", "")
        if not self._api_key:
            self._logger.warning("api_server",
                                 "HOME_AI_API_KEY not set — generating ephemeral key")
            self._api_key = secrets.token_urlsafe(32)
            self._logger.info("api_server",
                              f"Ephemeral API key (save this): {self._api_key}")

        # Build FastAPI app
        self.app = FastAPI(
            title="Home AI Assistant API",
            version=self.VERSION,
            docs_url=None,   # Disable Swagger UI in production
            redoc_url=None,  # Disable ReDoc in production
        )

        # CORS
        cors_origins = self._config.get("cors_origins", ["http://localhost:3000"])
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["*"],
        )

        # Request logging middleware
        @self.app.middleware("http")
        async def log_requests(request: Request, call_next):
            start = time.time()
            response = await call_next(request)
            duration = (time.time() - start) * 1000
            self._logger.info("api_server", "Request handled", {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(duration, 2),
                "client": request.client.host if request.client else "unknown",
            })
            return response

        # Register routes
        self._register_routes()

        # Orchestrator reference (set after initialization)
        self._orchestrator = None

        self._logger.info("api_server", "API server initialized", {
            "host": self._config.get("host", "127.0.0.1"),
            "port": self._config.get("port", 8900),
        })

    def set_orchestrator(self, orchestrator):
        """Connect the API to the main orchestrator for handling requests."""
        self._orchestrator = orchestrator

    def _verify_api_key(
        self,
        request: Request,
        api_key: str = Security(APIKeyHeader(name="X-API-Key", auto_error=False)),
    ):
        """Dependency: verify the API key on every request.

        Localhost (127.0.0.1 / ::1) is always trusted — this is a home
        assistant that runs locally.  External callers must supply a
        valid X-API-Key header.
        """
        client_ip = request.client.host if request.client else ""
        if client_ip in ("127.0.0.1", "::1"):
            return "local"

        if not api_key or not secrets.compare_digest(api_key, self._api_key):
            self._logger.log_security_event("invalid_api_key", {
                "provided_key_prefix": api_key[:8] + "..." if api_key else "empty",
            })
            raise HTTPException(status_code=403, detail="Invalid API key")
        return api_key

    def _register_routes(self):
        """Register all API endpoints."""
        app = self.app

        @app.get("/health", response_model=HealthResponse)
        async def health():
            """Public health check (no auth required)."""
            return HealthResponse(
                status="ok",
                uptime_seconds=round(time.time() - self._start_time, 1),
                version=self.VERSION,
            )

        @app.post("/chat", response_model=ChatResponse,
                   dependencies=[Depends(self._verify_api_key)])
        async def chat(req: ChatRequest):
            """Send a message to the AI and get a response + executed commands."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503,
                                    detail="Orchestrator not ready")
            result = await self._orchestrator.process_message(
                req.message, source=req.source
            )
            return ChatResponse(**result)

        @app.post("/command", response_model=StatusResponse,
                   dependencies=[Depends(self._verify_api_key)])
        async def execute_command(req: CommandRequest):
            """Directly request a command execution (still goes through validation)."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503,
                                    detail="Orchestrator not ready")
            result = await self._orchestrator.execute_direct_command(
                req.command, req.params
            )
            return StatusResponse(**result)

        @app.get("/commands", dependencies=[Depends(self._verify_api_key)])
        async def list_commands():
            """List all available whitelisted commands."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503,
                                    detail="Orchestrator not ready")
            return {"commands": self._orchestrator.list_commands()}

        @app.get("/history", dependencies=[Depends(self._verify_api_key)])
        async def chat_history():
            """Get conversation history length."""
            if self._orchestrator is None:
                return {"length": 0}
            return {"length": self._orchestrator.get_history_length()}

        @app.post("/clear", dependencies=[Depends(self._verify_api_key)])
        async def clear_history():
            """Clear conversation history."""
            if self._orchestrator is not None:
                self._orchestrator.clear_history()
            return {"status": "cleared"}

        # ── Learning / Feedback endpoints ───────────────────

        @app.post("/feedback", dependencies=[Depends(self._verify_api_key)])
        async def submit_feedback(req: FeedbackRequest):
            """Submit thumbs-up/down feedback on an AI response."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503, detail="Not ready")
            self._orchestrator.record_feedback(
                req.message_id, req.rating,
                req.user_message, req.ai_response, req.correction
            )
            return {"status": "recorded"}

        @app.post("/learn", dependencies=[Depends(self._verify_api_key)])
        async def learn_fact(req: LearnFactRequest):
            """Explicitly teach the AI a fact."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503, detail="Not ready")
            self._orchestrator.learn_fact(req.key, req.value, req.category)
            return {"status": "learned", "key": req.key}

        @app.get("/learning/stats",
                 dependencies=[Depends(self._verify_api_key)])
        async def learning_stats():
            """Get learning system statistics."""
            if self._orchestrator is None:
                return {"enabled": False}
            return self._orchestrator.get_learning_stats()

        @app.get("/learning/memories",
                 dependencies=[Depends(self._verify_api_key)])
        async def list_memories(category: Optional[str] = None):
            """List all learned memories for owner review."""
            if self._orchestrator is None:
                return {"memories": []}
            memories = self._orchestrator.get_learned_memories(category)
            return {"memories": memories}

        @app.delete("/learning/memories/{memory_id}",
                    dependencies=[Depends(self._verify_api_key)])
        async def delete_memory(memory_id: int):
            """Delete a specific learned memory."""
            if self._orchestrator is None:
                raise HTTPException(status_code=503, detail="Not ready")
            self._orchestrator.delete_memory(memory_id)
            return {"status": "deleted", "id": memory_id}

        @app.post("/learning/pause",
                  dependencies=[Depends(self._verify_api_key)])
        async def pause_learning():
            """Pause the learning system."""
            if self._orchestrator:
                self._orchestrator.pause_learning()
            return {"status": "paused"}

        @app.post("/learning/resume",
                  dependencies=[Depends(self._verify_api_key)])
        async def resume_learning():
            """Resume the learning system."""
            if self._orchestrator:
                self._orchestrator.resume_learning()
            return {"status": "resumed"}

        @app.post("/learning/wipe",
                  dependencies=[Depends(self._verify_api_key)])
        async def wipe_learning():
            """DANGER: Wipe all learned data. Irreversible."""
            if self._orchestrator:
                self._orchestrator.wipe_learning()
            return {"status": "wiped"}

        @app.get("/learning/export",
                 dependencies=[Depends(self._verify_api_key)])
        async def export_learning():
            """Export all learning data for owner review."""
            if self._orchestrator is None:
                return {}
            return self._orchestrator.export_learning()

    @property
    def host(self) -> str:
        return self._config.get("host", "127.0.0.1")

    @property
    def port(self) -> int:
        return self._config.get("port", 8900)
