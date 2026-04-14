"""
Nova — FastAPI Application Factory
====================================
Creates the FastAPI app and wires up all module references.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


def create_app(**modules) -> FastAPI:
    app = FastAPI(title="Nova", version="2.1.0", docs_url=None, redoc_url=None)

    # Store module handles so routes can access them via request.app.state
    app.state.modules = modules

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # LAN access from any device
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register REST + WebSocket routes
    from api.routes import router
    from api.websocket import ws_router
    from api.browser_bridge import bridge_router
    app.include_router(router, prefix="/api")
    app.include_router(ws_router, prefix="/ws")
    app.include_router(bridge_router)

    # PWA static assets (manifest, service worker, icons)
    public = Path(__file__).parent.parent / "desktop" / "public"

    @app.get("/manifest.json")
    async def pwa_manifest():
        return FileResponse(str(public / "manifest.json"), media_type="application/manifest+json")

    @app.get("/sw.js")
    async def pwa_sw():
        return FileResponse(str(public / "sw.js"), media_type="application/javascript")

    @app.get("/download")
    async def download_page():
        return FileResponse(str(public / "download.html"), media_type="text/html")

    # Serve icons
    icons_dir = public / "icons"
    if icons_dir.is_dir():
        app.mount("/icons", StaticFiles(directory=str(icons_dir)), name="icons")

    # Serve the built desktop frontend as static files (production mode)
    dist = Path(__file__).parent.parent / "desktop" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")

    return app
