"""
Step 4 — Redis Queue Client
Shared module used by both the 8B triage service and Jarvis security analyst.

Functions:
  push_event(queue, event)     — Push a security event to a queue
  pop_event(queue, timeout)    — Blocking pop from a queue
  get_queue_depth(queue)       — Get current queue length
  get_client()                 — Get the singleton Redis client
"""

import json
import logging
import os
from typing import Any, Optional

import redis

logger = logging.getLogger("queue_client")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REDIS_SOCKET = os.getenv("REDIS_SOCKET", "/var/run/redis/redis.sock")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

# Queue names
QUEUE_SUSPICIOUS = "jarvis:suspicious"
QUEUE_CRITICAL = "jarvis:critical"

# ---------------------------------------------------------------------------
# Singleton client
# ---------------------------------------------------------------------------
_client: Optional[redis.Redis] = None


def get_client() -> redis.Redis:
    """Get or create the singleton Redis client."""
    global _client
    if _client is None:
        if os.path.exists(REDIS_SOCKET):
            _client = redis.Redis(
                unix_socket_path=REDIS_SOCKET,
                password=REDIS_PASSWORD or None,
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
                retry_on_timeout=True,
            )
        else:
            _client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD or None,
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
                retry_on_timeout=True,
            )
        # Test connection
        _client.ping()
        logger.info("Redis connection established")
    return _client


def push_event(queue: str, event: dict) -> int:
    """
    Push a security event onto a Redis list queue.
    Returns the new queue length.
    """
    client = get_client()
    payload = json.dumps(event, default=str)
    length = client.lpush(queue, payload)
    logger.debug(f"Pushed event to {queue} (depth: {length})")
    return length


def pop_event(queue: str, timeout: int = 5) -> Optional[dict]:
    """
    Blocking pop from a Redis list queue.
    Returns the event dict, or None if timeout expired.
    Pops from the right (FIFO with LPUSH).
    """
    client = get_client()
    result = client.brpop(queue, timeout=timeout)
    if result is None:
        return None
    _queue_name, payload = result
    try:
        event = json.loads(payload)
        return event
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON in queue {queue}: {payload[:200]}")
        return None


def pop_event_nonblocking(queue: str) -> Optional[dict]:
    """Non-blocking pop. Returns None immediately if queue is empty."""
    client = get_client()
    payload = client.rpop(queue)
    if payload is None:
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON in queue {queue}: {payload[:200]}")
        return None


def get_queue_depth(queue: str) -> int:
    """Get the current length of a queue."""
    client = get_client()
    return client.llen(queue)


def peek_queue(queue: str, count: int = 5) -> list[dict]:
    """Peek at the first N items in a queue without removing them."""
    client = get_client()
    items = client.lrange(queue, -count, -1)
    result = []
    for item in items:
        try:
            result.append(json.loads(item))
        except json.JSONDecodeError:
            pass
    return result


def health_check() -> dict:
    """Check Redis connection and queue status."""
    try:
        client = get_client()
        ping = client.ping()
        return {
            "status": "healthy" if ping else "unhealthy",
            "suspicious_depth": get_queue_depth(QUEUE_SUSPICIOUS),
            "critical_depth": get_queue_depth(QUEUE_CRITICAL),
        }
    except redis.RedisError as e:
        return {"status": "unhealthy", "error": str(e)}
