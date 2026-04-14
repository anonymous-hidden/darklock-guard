"""
Nova — WebSocket Endpoint
===========================
Streams AI responses token-by-token for a real-time chat experience.
Integrates the conversation engine for state tracking, interruption
handling, and multi-turn delivery.

Protocol:
  Client → {"type":"message", "content":"...", "conversation_id": N}
  Client → {"type":"interrupt"}                                         (user started typing/speaking)
  Server → {"type":"token",   "content":"..."}     (repeated)
  Server → {"type":"done",    "full_response":"...", "commands":[...]}
  Server → {"type":"alert",   ...alert data}        (pushed from anomaly detector)
  Server → {"type":"proactive", ...proactive msg}   (Nova speaking on her own)
  Server → {"type":"emotion", ...emotional state}   (after each response)
  Server → {"type":"state",   "state":"active|idle|inactive|sleeping"}

Lookup protocol (deferred fetch):
  When the AI embeds [LOOKUP: query] in a response, the server strips the tag from
  the visible message, performs a web search, then pushes the result as a proactive
  "followup" message automatically — no user action needed.
"""

import asyncio
import json
import logging
import re as _re
import threading

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

ws_router = APIRouter()

# Active WebSocket connections for alert broadcasting
_active_connections: list[WebSocket] = []

# Pattern to detect a deferred lookup tag in a response
_LOOKUP_RE = _re.compile(r'\[LOOKUP:\s*(.+?)\]', _re.IGNORECASE)
# Pattern to detect a multi-turn continuation tag
_CONTINUE_RE = _re.compile(r'\[CONTINUE:\s*(.+?)\]', _re.IGNORECASE | _re.DOTALL)


async def _run_browser_search(query: str, executor) -> str:
    """Run a web search via the executor and return plain-text result."""
    try:
        result = await executor.execute({
            "action": "browser",
            "command": "search",
            "query": query,
        })
        if result.get("status") == "executed":
            return result.get("output", "").strip() or "I couldn't find anything on that."
        return "The search didn't return results."
    except Exception as e:
        return f"Search failed: {e}"


def _schedule_lookup(query: str, conv_engine, ai_engine, executor, memory, conv_id: int | None):
    """
    Background thread: fetch lookup result then push a follow-up via the AI.
    Runs in a daemon thread so it doesn't block the websocket.
    """
    import asyncio
    import logging
    _log = logging.getLogger(__name__)

    # These strings are returned by _run_browser_search when the search fails.
    _SEARCH_FAILURES = {
        "The search didn't return results.",
        "I couldn't find anything on that.",
    }

    async def _do():
        # Perform the search
        search_text = await _run_browser_search(query, executor)

        # If the search came back empty or with a known failure, skip the AI
        # call and give the user a direct fallback — don't leave them hanging.
        if not search_text or search_text in _SEARCH_FAILURES or search_text.startswith("Search failed:"):
            _log.warning(f"_schedule_lookup: search returned no usable result for '{query}': {search_text!r}")
            if conv_engine:
                conv_engine.queue_followup(
                    "Couldn't pull that up — search came back empty. Try asking me again or rephrase?",
                    category="followup",
                    delay=1.0,
                )
            return

        # Ask the AI to summarise the result naturally
        prompt = (
            f"[SYSTEM: You previously told Cayden you'd look something up. "
            f"Here are the live search results for '{query}':\n\n{search_text}\n\n"
            f"Now report back naturally in 1-3 sentences. Don't say 'search results', "
            f"just deliver the answer conversationally. No markdown, no bullet points. "
            f"If the results are unclear or empty, say so briefly.]"
        )
        try:
            response = await ai_engine.send_message(prompt)
        except Exception as e:
            _log.error(f"_schedule_lookup: ai.send_message failed for '{query}': {e}", exc_info=True)
            if conv_engine:
                conv_engine.queue_followup(
                    "Search hit an error on my end — I'll try again if you ask.",
                    category="followup",
                    delay=1.0,
                )
            return

        response = response.strip().strip('"').strip("'")

        # Save to memory if we have a conversation
        if memory and conv_id:
            memory.add_message(conv_id, "assistant", response)

        # Push as a follow-up proactive message
        if conv_engine:
            conv_engine.queue_followup(response, category="followup", delay=0.3)
            conv_engine.on_nova_response(response)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_do())
    except Exception as e:
        _log.error(f"_schedule_lookup: unhandled error for '{query}': {e}", exc_info=True)
        try:
            # Best-effort fallback so the user isn't left hanging
            if conv_engine:
                conv_engine.queue_followup(
                    "Search hit an error — I'll try again if you ask.",
                    category="followup",
                    delay=1.0,
                )
        except Exception:
            pass
    finally:
        loop.close()


async def broadcast_alert(alert: dict):
    """Send an alert to all connected WebSocket clients."""
    msg = json.dumps({"type": "alert", **alert})
    for ws in _active_connections[:]:
        try:
            await ws.send_text(msg)
        except Exception:
            _active_connections.remove(ws)


async def broadcast_proactive(message: dict):
    """Send a proactive message from Nova to all connected clients."""
    msg = json.dumps(message)
    for ws in _active_connections[:]:
        try:
            await ws.send_text(msg)
        except Exception:
            _active_connections.remove(ws)


async def broadcast_state(state: str):
    """Notify all clients of conversation state changes."""
    msg = json.dumps({"type": "state", "state": state})
    for ws in _active_connections[:]:
        try:
            await ws.send_text(msg)
        except Exception:
            _active_connections.remove(ws)


@ws_router.websocket("/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    _active_connections.append(ws)
    m = ws.app.state.modules
    ai = m["ai_engine"]
    memory = m["memory"]
    executor = m["executor"]
    persistent_mem = m.get("persistent_memory")
    emotions = m.get("emotions")
    anomaly = m.get("anomaly")
    proactive = m.get("proactive")
    session_cont = m.get("session_continuity")
    conv_engine = m.get("conversation_engine")
    tool_executor = m.get("tool_executor")
    conv_awareness = m.get("conversation_awareness")

    try:
        active_conv_id: int | None = None  # track current conv across message iterations
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")

            # ── Model mode switch ──
            if msg_type == "set_model_mode":
                mode = msg.get("mode")  # "fast", "deep"/"heavy", "claude", or "auto"/None
                if mode == "heavy":
                    mode = "deep"
                ai.set_mode(mode if mode not in ("auto", None) else None)
                await ws.send_json({"type": "model_mode", "mode": mode or "auto", "models": ai.active_models})
                continue

            # ── Get model info ──
            if msg_type == "get_models":
                await ws.send_json({"type": "model_info", "models": ai.active_models})
                continue

            # ── Interruption: user started typing/speaking ──
            if msg_type == "interrupt":
                if conv_engine:
                    conv_engine.interrupt()
                continue

            if msg_type not in ("message", "image_message"):
                await ws.send_json({"type": "error", "message": "Unknown message type"})
                continue

            content = msg.get("content", "").strip()

            # ── Vision: if image data is attached, describe it first ──
            image_data = msg.get("image_data")  # base64-encoded image
            if image_data and msg_type == "image_message":
                vision = m.get("vision_engine")
                if vision and vision.enabled:
                    import base64
                    try:
                        img_bytes = base64.b64decode(image_data)
                        vision_desc = await vision.describe_image(img_bytes, content)
                        if vision_desc and not vision_desc.startswith("[Vision error"):
                            content = f"{content}\n\n[Image description from vision: {vision_desc}]" if content else f"[Image description from vision: {vision_desc}]"
                    except Exception:
                        pass
                if not content:
                    content = "What do you see in this image?"

            if not content:
                continue

            conv_id = msg.get("conversation_id")
            if not conv_id:
                conv_id = memory.create_conversation()
                await ws.send_json({"type": "conversation_created", "conversation_id": conv_id})
                if emotions:
                    emotions.on_new_session()

            # Rehydrate conversation history from DB if this is the first time
            # we've seen this conv_id in this process (covers server restarts + sidebar switches)
            if conv_id and not ai.is_hydrated(conv_id):
                past = memory.get_messages(conv_id)
                if past:
                    ai.hydrate(conv_id, past)

            active_conv_id = conv_id  # update for disconnect handler

            memory.add_message(conv_id, "user", content)

            # Notify conversation engine (handles state transitions)
            if conv_engine:
                conv_engine.on_user_message(content, conv_id)

            # Track message for session continuity
            if session_cont:
                session_cont.on_message(content, is_user=True)

            # Notify proactive engine that user is active
            if proactive:
                proactive.on_user_message()

            # Conversation awareness — track topic/entities for this conversation
            if conv_awareness:
                conv_awareness.on_user_message(conv_id, content)

            # Persistent memory: extract facts from user message
            if persistent_mem:
                persistent_mem.extract_facts_from_message(content)

            # Emotional reaction to user message
            if emotions:
                emotions.on_user_message(content)

            # Detect voice/calendar commands before sending to LLM
            from api.routes import _detect_voice_command
            voice_cmd_result = None

            try:
                voice_cmd_result = await _detect_voice_command(content, executor)
            except Exception as _vcmd_err:
                logger.error(f"Voice command detection failed: {_vcmd_err}")
                voice_cmd_result = None

            # If we got calendar data, inject it with strict no-hallucination prompt
            if voice_cmd_result and voice_cmd_result.startswith("CALENDAR_DATA:\n"):
                cal_text = voice_cmd_result.removeprefix("CALENDAR_DATA:\n")
                prompt = (
                    f"[SYSTEM: Cayden asked about his calendar. Present this data naturally. "
                    f"Do NOT add, invent, or make up ANY events, meetings, or appointments. "
                    f"If the data says no events, tell him he has nothing scheduled. "
                    f"ONLY report what is listed below — nothing else.]\n\n"
                    f"ACTUAL CALENDAR DATA:\n{cal_text}"
                )
            elif voice_cmd_result and voice_cmd_result.startswith("MORNING_BRIEFING:\n"):
                briefing_text = voice_cmd_result.removeprefix("MORNING_BRIEFING:\n")
                prompt = (
                    f"[SYSTEM: Cayden said good morning. Present this briefing naturally. "
                    f"Do NOT add, invent, or embellish ANY information — no fake events. "
                    f"Stick to the facts below.]\n\n"
                    f"BRIEFING DATA:\n{briefing_text}"
                )
            elif voice_cmd_result and voice_cmd_result.startswith("BROWSER_DATA:\n"):
                browser_text = voice_cmd_result.removeprefix("BROWSER_DATA:\n")
                prompt = (
                    f"[SYSTEM: Cayden asked about his browser. Here is the REAL data "
                    f"from his actual live browser right now. Report ONLY what is below — "
                    f"do NOT invent, guess, or make up ANY page titles, URLs, or content. "
                    f"If the data says a specific page/tab, tell him exactly that. "
                    f"Answer naturally and conversationally. NEVER mention tool names or functions.]\n\n"
                    f"ACTUAL BROWSER DATA:\n{browser_text}"
                )
            elif voice_cmd_result and voice_cmd_result.startswith("DOC_WRITE_DATA:\n"):
                doc_result = voice_cmd_result.removeprefix("DOC_WRITE_DATA:\n")
                if doc_result.startswith("ERROR:"):
                    prompt = (
                        f"[SYSTEM: Cayden tried to write to a Google Doc but it failed. "
                        f"Tell him this exact problem and ask him to include the doc URL next time. "
                        f"Problem: {doc_result}. One sentence, voice-friendly, no markdown.]"
                    )
                elif doc_result.startswith("Started"):
                    # Don't call LLM — it would block waiting for the background
                    # Ollama generation that's already running for the doc write.
                    # Send a canned response directly.
                    canned = "I'm on it — you'll see the text appear in your doc shortly."
                    memory.add_message(conv_id, "assistant", canned)
                    if conv_awareness:
                        conv_awareness.on_nova_message(conv_id, canned)
                    await ws.send_json({"type": "token", "content": canned})
                    await ws.send_json({
                        "type": "done",
                        "full_response": canned,
                        "conversation_id": conv_id,
                        "commands": [],
                        "emotion": emotions.state.to_dict() if emotions else None,
                        "model": ai._last_model,
                    })
                    continue
                else:
                    prompt = (
                        f"[SYSTEM: Cayden asked you to write something to his Google Doc. "
                        f"The write completed successfully. Result: {doc_result}. "
                        f"Confirm briefly in one sentence. Do NOT repeat or restate the content that was written. "
                        f"Do NOT write any creative content. Just confirm it was added to the doc.]"
                    )
            elif voice_cmd_result:
                prompt = (
                    f"[SYSTEM: A command was run automatically. Result: {voice_cmd_result}. "
                    f"Briefly confirm what was done. One sentence max.]"
                )
            else:
                prompt = content

            # Stream tokens back (check for interruption between tokens)
            full_response = ""
            interrupted = False
            # Clear any stale interrupt flag from typing before submit
            if conv_engine:
                conv_engine.was_interrupted()  # consume and discard any pending flag
            try:
                async for token in ai.stream_message(prompt, conv_id=conv_id):
                    # Check if user interrupted mid-stream
                    if conv_engine and conv_engine.was_interrupted():
                        interrupted = True
                        break
                    full_response += token
                    await ws.send_json({"type": "token", "content": token})
            except Exception as _stream_err:
                logger.error(f"Streaming error: {_stream_err}", exc_info=True)
                if not full_response:
                    full_response = "Sorry, something went wrong — try again?"
                try:
                    await ws.send_json({"type": "done", "full_response": full_response, "commands": [], "corrected": False})
                except Exception:
                    pass
                continue

            if interrupted:
                # Send truncated done signal
                memory.add_message(conv_id, "assistant", full_response + " [interrupted]")
                await ws.send_json({
                    "type": "done",
                    "full_response": full_response,
                    "conversation_id": conv_id,
                    "commands": [],
                    "emotion": emotions.state.to_dict() if emotions else None,
                    "interrupted": True,
                    "model": ai._last_model,
                })
                continue

            # ── Detect deferred lookup tag ────────────────────────────────────────
            # If the AI embedded [LOOKUP: query] in the response, strip it from
            # the visible message and kick off a background fetch + follow-up.
            lookup_match = _LOOKUP_RE.search(full_response)
            lookup_query = lookup_match.group(1).strip() if lookup_match else None

            # ── Detect multi-turn continuation tag ────────────────────────────────
            continue_match = _CONTINUE_RE.search(full_response)
            continue_text = continue_match.group(1).strip() if continue_match else None

            # Strip both tags from the visible response
            visible_response = full_response
            if lookup_query:
                visible_response = _LOOKUP_RE.sub("", visible_response)
            if continue_text:
                visible_response = _CONTINUE_RE.sub("", visible_response)
            visible_response = visible_response.strip()

            # ── Execute tool calls BEFORE saving to memory ────────────────────
            # If tools are called, the AI hallucinated the result (it streamed
            # its response before the tool ran).  We execute the tool, get real
            # data, then do a clean one-shot AI call to produce a corrected
            # response.  Only the corrected version is saved to memory.
            tool_results = []
            if tool_executor:
                tool_calls = tool_executor.extract_tool_calls(visible_response)
                if tool_calls:
                    tool_results = await tool_executor.execute_all(tool_calls)

                    # Build real data from tool results
                    result_parts = []
                    for tr in tool_results:
                        if tr.success and tr.output:
                            out = str(tr.output)
                            if len(out) > 3000:
                                out = out[:3000] + "\n... [truncated]"
                            result_parts.append(out)
                        else:
                            result_parts.append(f"(tool error: {tr.error})")
                    result_text = "\n\n".join(result_parts)

                    # Direct Ollama call for a corrected response — bypasses
                    # the AI engine entirely so we don't pollute conversation history.
                    import httpx as _hx
                    try:
                        async with _hx.AsyncClient(timeout=60) as _client:
                            _resp = await _client.post(
                                f"{ai._base_url}/api/chat",
                                json={
                                    "model": ai._last_model or "qwen2.5:32b",
                                    "messages": [
                                        {"role": "system", "content": (
                                            "You are Nova, Cayden's AI assistant. "
                                            "Respond naturally and conversationally. "
                                            "NEVER mention tool names, function names, APIs, "
                                            "character counts, or technical internals. "
                                            "Answer as if you personally just looked at "
                                            "the screen or data yourself. Keep it casual."
                                        )},
                                        {"role": "user", "content": (
                                            f"Cayden asked: \"{content}\"\n\n"
                                            f"Here is the real data you found:\n{result_text}\n\n"
                                            f"Now answer Cayden's question based on this real data."
                                        )},
                                    ],
                                    "stream": False,
                                    "options": {"temperature": 0.7},
                                },
                            )
                            _resp.raise_for_status()
                            corrected = _resp.json()["message"]["content"]
                            # Corrected text will be delivered via the 'done' event
                            # (no clear_response wipe — just silently swap via done)
                            visible_response = corrected.strip()
                    except Exception as e:
                        logger.error(f"Tool correction call failed: {e}")
                        # Fall back to stripped response (tool syntax removed)
                        visible_response = tool_executor.strip_tool_calls(visible_response).strip()
                        if not visible_response:
                            visible_response = "I tried to check but something went wrong. Can you try again?"

                    # Forward tool results to frontend for any UI that uses them
                    for tr in tool_results:
                        await ws.send_json({
                            "type": "tool_result",
                            "tool": tr.tool_name,
                            "success": tr.success,
                            "output": tr.output[:2000] if tr.output else None,
                            "error": tr.error,
                        })

            # Save to memory AFTER potential tool correction
            # Always strip any residual tool call markup before saving/displaying
            if tool_executor:
                visible_response = tool_executor.strip_tool_calls(visible_response)
            # Guard: if stripping emptied the response (e.g. correction call
            # re-generated tool syntax), substitute a safe fallback so the
            # frontend never receives an empty full_response.
            if not visible_response:
                visible_response = "Done." if tool_results else "I got an empty response — please try again."
            memory.add_message(conv_id, "assistant", visible_response)

            # Conversation awareness — track Nova's reply
            if conv_awareness:
                conv_awareness.on_nova_message(conv_id, visible_response)

            # Background: LLM-powered memory extraction (doesn't block response)
            if persistent_mem:
                import asyncio as _asyncio
                _asyncio.create_task(
                    persistent_mem.extract_memories_with_ai(content, visible_response)
                )

            # Notify conversation engine of our response
            if conv_engine:
                conv_engine.on_nova_response(visible_response)

            # Execute any embedded JSON commands (legacy command system)
            commands = ai.extract_commands(visible_response)
            cmd_results = []
            for cmd in commands:
                result = await executor.execute(cmd)
                cmd_results.append(result)
                # Emotional + anomaly feedback from command results
                if result.get("status") == "executed":
                    if emotions:
                        emotions.on_successful_command()
                elif result.get("status") == "error":
                    if emotions:
                        emotions.on_failed_command()
                    if anomaly:
                        anomaly.on_command_failed(result)

            # Auto-title conversation
            for c in memory.list_conversations():
                if c["id"] == conv_id and c["title"] == "New Conversation":
                    title = content[:50] + ("..." if len(content) > 50 else "")
                    memory.rename_conversation(conv_id, title)
                    break

            # Send emotional state with response
            emotion_data = emotions.state.to_dict() if emotions else None

            await ws.send_json({
                "type": "done",
                "full_response": visible_response,
                "corrected": bool(tool_results),
                "conversation_id": conv_id,
                "commands": cmd_results,
                "emotion": emotion_data,
                "model": ai._last_model,
            })

            # ── Start deferred lookup in background ───────────────────────────
            # Do this AFTER sending `done` so the UI unlocks immediately while
            # the search runs. Result arrives as a proactive "followup" message.
            if lookup_query and not interrupted:
                t = threading.Thread(
                    target=_schedule_lookup,
                    args=(lookup_query, conv_engine, ai, executor, memory, conv_id),
                    daemon=True,
                    name=f"lookup-{conv_id}",
                )
                t.start()

            # ── Push multi-turn continuation ──────────────────────────────────
            # [CONTINUE: text] tells Jarvis to send a second message after a
            # natural pause, without any user input required.
            elif continue_text and not interrupted and conv_engine:
                conv_engine.queue_followup(
                    continue_text,
                    category="followup",
                    delay=1.5,  # brief pause to feel natural
                )

    except WebSocketDisconnect:
        # Summarize the active conversation when user disconnects
        if session_cont and active_conv_id:
            current_mood = emotions.state.dominant_feeling if emotions else "neutral"
            session_cont.on_session_end(
                conversation_id=active_conv_id,
                current_mood=current_mood,
            )

        if session_cont and not active_conv_id:
            current_mood = emotions.state.dominant_feeling if emotions else "neutral"
            convs = memory.list_conversations()
            if convs:
                session_cont.on_session_end(
                    conversation_id=convs[0]["id"],
                    current_mood=current_mood,
                )
    finally:
        if ws in _active_connections:
            _active_connections.remove(ws)
