"""
Home AI Assistant - Web Server
===============================
Serves the React frontend and mounts the FastAPI backend.
Uses FastAPI's StaticFiles to serve the built frontend.
In development, the Vite dev server proxies to the backend.
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from api_server import APIServer
from logger import HomeAILogger


def create_web_app(config: dict, logger: HomeAILogger, api_server: APIServer) -> FastAPI:
    """
    Create the combined web application.
    In production: serves frontend static files + API.
    In development: only serves the API (Vite handles frontend).
    """
    app = api_server.app

    # Serve built frontend if it exists
    frontend_dist = Path(__file__).parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        # Serve index.html for all non-API routes (SPA fallback)
        from fastapi.responses import FileResponse

        @app.get("/")
        async def serve_root():
            return FileResponse(frontend_dist / "index.html")

        # Mount static assets
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

        # SPA fallback for client-side routing
        @app.get("/{path:path}")
        async def serve_spa(path: str):
            file_path = frontend_dist / path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(frontend_dist / "index.html")

        logger.info("web_server", "Serving frontend from /frontend/dist")
    else:
        logger.info("web_server",
                     "No frontend build found — run 'npm run build' "
                     "in frontend/ or use Vite dev server")

    return app
