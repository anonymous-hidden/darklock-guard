"""
Nova — Browser Bridge (Backend)
=================================
WebSocket endpoint that the Chrome extension connects to.
Tracks the active browser tab and provides an API for Jarvis
to send commands (read page, type, click, navigate, etc.)
and receive results.

Architecture:
  Chrome Extension ←—WebSocket—→ BrowserBridge ←—→ Executor / AI Engine
"""

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

bridge_router = APIRouter()

# ── Global state ──────────────────────────────────────

_bridge_ws: Optional[WebSocket] = None
_active_tab: dict = {}
_pending_commands: dict[str, asyncio.Future] = {}
_command_counter = 0


def is_connected() -> bool:
    """Check if the browser extension is currently connected."""
    return _bridge_ws is not None


def get_active_tab() -> dict:
    """Get info about the currently active browser tab."""
    return _active_tab.copy()


async def send_command(action: str, args: dict = None, timeout: float = 15.0) -> dict:
    """
    Send a command to the browser extension and wait for the result.

    Args:
        action: Command name (get_page_content, type_text, click_element, etc.)
        args: Command arguments
        timeout: Max seconds to wait for response

    Returns:
        Result dict from the extension
    """
    global _command_counter

    if not _bridge_ws:
        return {"success": False, "error": "Browser extension not connected. Install and enable the Nova Bridge extension."}

    _command_counter += 1
    cmd_id = f"cmd_{_command_counter}_{int(time.time())}"

    # Create a future for the response
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    _pending_commands[cmd_id] = future

    try:
        await _bridge_ws.send_json({
            "type": "command",
            "id": cmd_id,
            "action": action,
            "args": args or {},
        })

        result = await asyncio.wait_for(future, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        return {"success": False, "error": f"Browser command timed out after {timeout}s"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        _pending_commands.pop(cmd_id, None)


# ── WebSocket endpoint ────────────────────────────────

@bridge_router.websocket("/browser-bridge")
async def browser_bridge_ws(ws: WebSocket):
    """WebSocket endpoint for the Chrome extension to connect to."""
    global _bridge_ws, _active_tab

    await ws.accept()
    _bridge_ws = ws
    logger.info("Browser extension connected")

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "heartbeat":
                await ws.send_json({"type": "heartbeat_ack"})

            elif msg_type == "tab_update":
                _active_tab = msg.get("tab", {})
                logger.debug(f"Active tab: {_active_tab.get('title', '?')} — {_active_tab.get('url', '?')}")

            elif msg_type == "command_result":
                cmd_id = msg.get("id")
                if cmd_id in _pending_commands:
                    future = _pending_commands.pop(cmd_id)
                    if not future.done():
                        future.set_result(msg.get("result", {}))

    except WebSocketDisconnect:
        logger.info("Browser extension disconnected")
    except Exception as e:
        logger.error(f"Browser bridge error: {e}")
    finally:
        _bridge_ws = None
        _active_tab = {}
        # Cancel any pending commands
        for future in _pending_commands.values():
            if not future.done():
                future.set_result({"success": False, "error": "Extension disconnected"})
        _pending_commands.clear()
