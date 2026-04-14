"""
Step 8 — Claude Expert Analysis Module
Called by security_analyst only for complex/unknown threats.
Sanitizes all data before sending, caches responses, handles fallback.
"""

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("jarvis.claude_expert")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CLAUDE_MODEL = "claude-opus-4-6"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CACHE_SIZE = 500  # Max cached responses
CACHE_TTL = 3600  # 1 hour TTL for cached responses

# Fields to ALWAYS strip before sending to Claude
SENSITIVE_FIELDS = {
    "raw_message",
    "raw_event",
    "environ",
    "password",
    "token",
    "secret",
    "cookie",
    "session_id",
    "api_key",
    "authorization",
}

# Patterns to redact from any string value
REDACTION_PATTERNS = [
    # Internal IPs
    (r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "[INTERNAL_IP]"),
    (r"\b192\.168\.\d{1,3}\.\d{1,3}\b", "[INTERNAL_IP]"),
    (r"\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b", "[INTERNAL_IP]"),
    # Usernames (redact after common prefixes)
    (r"\buser[=: ]+\w+", "user=[REDACTED]"),
    (r"\buid[=: ]+\w+", "uid=[REDACTED]"),
    # File paths with sensitive names
    (r"/home/\w+", "/home/[USER]"),
    (r"/etc/(shadow|passwd|sudoers)\b", "/etc/[SENSITIVE_FILE]"),
    # DarkLock-specific data
    (r"(?i)darklock[\w.-]*", "[DARKLOCK_REDACTED]"),
    # Tokens, keys
    (r"\b[A-Za-z0-9+/]{40,}={0,2}\b", "[REDACTED_TOKEN]"),
]


# ---------------------------------------------------------------------------
# Response cache
# ---------------------------------------------------------------------------
class LRUCache:
    """Simple LRU cache with TTL."""
    
    def __init__(self, maxsize: int = CACHE_SIZE, ttl: int = CACHE_TTL):
        self.maxsize = maxsize
        self.ttl = ttl
        self._cache: dict[str, tuple[float, dict]] = {}
    
    def get(self, key: str) -> Optional[dict]:
        if key in self._cache:
            ts, value = self._cache[key]
            if time.time() - ts < self.ttl:
                return value
            else:
                del self._cache[key]
        return None
    
    def put(self, key: str, value: dict):
        if len(self._cache) >= self.maxsize:
            # Remove oldest entry
            oldest = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest]
        self._cache[key] = (time.time(), value)


_cache = LRUCache()


# ---------------------------------------------------------------------------
# Data minimization / sanitization
# ---------------------------------------------------------------------------
def _redact_string(text: str) -> str:
    """Redact sensitive patterns from a string."""
    import re
    result = text
    for pattern, replacement in REDACTION_PATTERNS:
        result = re.sub(pattern, replacement, result)
    return result


def sanitize_for_claude(event: dict, verdicts: list[dict]) -> dict:
    """
    Build a sanitized summary of the event for Claude.
    Never sends raw log data — only behavioral summaries.
    """
    # Extract only safe behavioral data
    summary = {
        "event_type": event.get("service", "unknown"),
        "severity": event.get("severity", "unknown"),
        "triage_verdict": event.get("triage_verdict", "unknown"),
        "timing": {
            "event_timestamp": event.get("timestamp", ""),
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        },
        "behavior": {
            "rule_triggered": _redact_string(event.get("rule", "")),
            "affected_service": event.get("service", "unknown"),
        },
    }
    
    # Add process info (redacted)
    process = event.get("process", "")
    if process:
        # Only include the program name, not full path or args
        prog_name = os.path.basename(process.split()[0]) if process else "unknown"
        summary["behavior"]["process_name"] = prog_name
    
    # Add sanitized recent verdicts
    recent = []
    for v in verdicts[-5:]:
        recent.append({
            "threat_level": v.get("threat_level"),
            "attack_type": v.get("attack_type"),
            "confidence": v.get("confidence"),
            "recommended_action": v.get("recommended_action"),
        })
    summary["recent_verdicts"] = recent
    
    return summary


def compute_event_signature(event: dict) -> str:
    """Compute a dedup signature for an event."""
    sig_data = json.dumps({
        "service": event.get("service"),
        "severity": event.get("severity"),
        "rule": event.get("rule"),
        "triage_verdict": event.get("triage_verdict"),
    }, sort_keys=True)
    return hashlib.sha256(sig_data.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Claude API system prompt
# ---------------------------------------------------------------------------
CLAUDE_SYSTEM_PROMPT = """You are an expert cybersecurity analyst reviewing escalated security events. 
You receive sanitized event summaries — all identifying information has been redacted.

Your task:
1. Analyze the event pattern and recent verdict history
2. Determine the likely attack type and severity
3. Recommend a specific response action

Respond with EXACTLY this JSON structure (no other text):
{
  "threat_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "attack_type": "category of attack",
  "confidence": 0.0 to 1.0,
  "recommended_action": "monitor|block_ip|isolate_server|kill_process|snapshot_and_freeze|alert_admin",
  "reasoning": "brief explanation (2-3 sentences)",
  "ioc_indicators": ["behavioral indicators"],
  "prompt_injection_detected": false
}

Base your analysis on behavioral patterns, timing, and attack signatures only."""


# ---------------------------------------------------------------------------
# Claude API interaction
# ---------------------------------------------------------------------------
async def call_claude(event: dict, recent_verdicts: list[dict]) -> Optional[dict]:
    """
    Call Claude API for expert analysis.
    Returns structured verdict or None if API unreachable.
    """
    # Get API key from environment (never hardcoded)
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set — skipping Claude analysis")
        return None
    
    # Check cache first
    sig = compute_event_signature(event)
    cached = _cache.get(sig)
    if cached:
        logger.info(f"Cache hit for event signature {sig}")
        cached["_cached"] = True
        return cached
    
    # Sanitize data before sending
    sanitized = sanitize_for_claude(event, recent_verdicts)
    
    user_message = json.dumps(sanitized, default=str)
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                CLAUDE_API_URL,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 1024,
                    "temperature": 0.1,
                    "system": CLAUDE_SYSTEM_PROMPT,
                    "messages": [
                        {"role": "user", "content": user_message},
                    ],
                },
            )
            
            if response.status_code == 200:
                result = response.json()
                content = result.get("content", [{}])[0].get("text", "{}")
                
                # Parse and validate response
                content = content.strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[-1].rsplit("```", 1)[0]
                
                verdict = json.loads(content)
                verdict["_source"] = "claude"
                verdict["_model"] = CLAUDE_MODEL
                
                # Cache the response
                _cache.put(sig, verdict)
                
                logger.info(f"Claude analysis: threat={verdict.get('threat_level')}, "
                          f"confidence={verdict.get('confidence')}")
                return verdict
            
            elif response.status_code == 429:
                logger.warning("Claude API rate limited")
                return None
            else:
                logger.error(f"Claude API error: {response.status_code} {response.text[:200]}")
                return None
                
    except httpx.HTTPError as e:
        logger.error(f"Claude API unreachable: {e}")
        return None
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        logger.error(f"Claude response parse error: {e}")
        return None


def should_escalate_to_claude(verdict: dict) -> bool:
    """
    Determine if an event should be escalated to Claude for expert analysis.
    Called by security_analyst after 32B model produces a verdict.
    """
    confidence = verdict.get("confidence", 1.0)
    attack_type = verdict.get("attack_type", "")
    threat_level = verdict.get("threat_level", "LOW")
    
    # Low confidence — model is unsure
    if confidence < 0.6:
        return True
    
    # Unknown attack type
    if attack_type.lower() in ("unknown", "unclassified", "analysis_failure"):
        return True
    
    # Critical threat — always get second opinion
    if threat_level == "CRITICAL":
        return True
    
    return False


async def get_expert_verdict(
    event: dict, jarvis_verdict: dict, recent_verdicts: list[dict]
) -> dict:
    """
    Get Claude's expert analysis, falling back to Jarvis verdict if unavailable.
    This is the main entry point called by security_analyst.
    """
    if not should_escalate_to_claude(jarvis_verdict):
        return jarvis_verdict
    
    logger.info("Escalating to Claude for expert analysis")
    
    claude_verdict = await call_claude(event, recent_verdicts)
    
    if claude_verdict is None:
        # Claude unavailable — log for manual review and use Jarvis verdict
        logger.warning("Claude unavailable — using Jarvis 32B verdict + flagging for review")
        jarvis_verdict["_needs_manual_review"] = True
        jarvis_verdict["_claude_unavailable"] = True
        return jarvis_verdict
    
    # Merge: prefer Claude's assessment but keep Jarvis's context
    final = {
        **jarvis_verdict,
        "threat_level": claude_verdict.get("threat_level", jarvis_verdict.get("threat_level")),
        "attack_type": claude_verdict.get("attack_type", jarvis_verdict.get("attack_type")),
        "confidence": claude_verdict.get("confidence", jarvis_verdict.get("confidence")),
        "recommended_action": claude_verdict.get("recommended_action", jarvis_verdict.get("recommended_action")),
        "reasoning": (
            f"[32B] {jarvis_verdict.get('reasoning', '')} "
            f"[Claude] {claude_verdict.get('reasoning', '')}"
        ),
        "ioc_indicators": list(set(
            jarvis_verdict.get("ioc_indicators", []) +
            claude_verdict.get("ioc_indicators", [])
        )),
        "_source": "claude+jarvis",
        "_claude_model": CLAUDE_MODEL,
    }
    
    return final
