"""
Step 6 — Playbook Runner
Restricted local API (Unix socket only) that Jarvis calls to execute playbooks.
Validates all inputs, logs every action to a tamper-evident append-only log.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("playbook_runner")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts")
ACTION_LOG = "/var/log/security-pipeline/playbook-actions.log"
AUDIT_LOG = "/var/log/security-pipeline/playbook-audit.jsonl"
SOCKET_PATH = "/var/run/playbook-runner.sock"

# Allowed playbooks — ONLY these, nothing else
ALLOWED_PLAYBOOKS = {
    "block_ip": {
        "script": "block_ip.sh",
        "required_args": ["ip"],
        "optional_args": ["reason"],
    },
    "isolate_server": {
        "script": "isolate_server.sh",
        "required_args": ["host"],
        "optional_args": ["reason"],
    },
    "kill_process": {
        "script": "kill_process.sh",
        "required_args": ["pid"],
        "optional_args": ["reason"],
    },
    "snapshot_and_freeze": {
        "script": "snapshot_and_freeze.sh",
        "required_args": [],
        "optional_args": ["reason"],
    },
    "alert_admin": {
        "script": "alert_me.sh",
        "required_args": ["severity", "message"],
        "optional_args": [],
    },
}

# Input validation patterns
VALIDATORS = {
    "ip": re.compile(r"^[0-9a-fA-F.:]+$"),  # IPv4 or IPv6 chars only
    "host": re.compile(r"^[a-zA-Z0-9._-]+$"),
    "pid": re.compile(r"^[0-9]+$"),
    "severity": re.compile(r"^(info|warning|critical)$"),
    "message": re.compile(r"^[a-zA-Z0-9 .,;:!?_\-/()@#\[\]]+$"),
    "reason": re.compile(r"^[a-zA-Z0-9 .,;:!?_\-/()@#\[\]]+$"),
}


# ---------------------------------------------------------------------------
# Tamper-evident audit log
# ---------------------------------------------------------------------------
def audit_log(entry: dict):
    """Append to audit log with chained hash for tamper evidence."""
    os.makedirs(os.path.dirname(AUDIT_LOG), exist_ok=True)
    
    # Read last hash for chaining
    prev_hash = "GENESIS"
    try:
        with open(AUDIT_LOG, "rb") as f:
            # Seek to last line
            f.seek(0, 2)
            size = f.tell()
            if size > 2:
                f.seek(max(0, size - 4096))
                lines = f.read().decode().strip().split("\n")
                if lines:
                    last = json.loads(lines[-1])
                    prev_hash = last.get("hash", "GENESIS")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

    entry["prev_hash"] = prev_hash
    entry["timestamp"] = datetime.now(timezone.utc).isoformat()
    
    # Compute hash of this entry (excluding the hash field itself)
    entry_str = json.dumps(entry, sort_keys=True, default=str)
    entry["hash"] = hashlib.sha256(entry_str.encode()).hexdigest()

    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
        f.flush()
        os.fsync(f.fileno())


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
def validate_arg(name: str, value: str) -> str:
    """Validate a playbook argument. Raises ValueError if invalid."""
    if not value:
        raise ValueError(f"Argument '{name}' is empty")
    
    if len(value) > 500:
        raise ValueError(f"Argument '{name}' exceeds max length")
    
    pattern = VALIDATORS.get(name)
    if pattern and not pattern.match(value):
        raise ValueError(
            f"Argument '{name}' contains invalid characters: {value[:50]}"
        )
    
    # Additional checks for specific args
    if name == "ip":
        # Block obviously invalid IPs
        if value in ("127.0.0.1", "::1", "0.0.0.0"):
            raise ValueError(f"Cannot target loopback IP: {value}")
        parts = value.split(".")
        if len(parts) == 4:
            for p in parts:
                if not (0 <= int(p) <= 255):
                    raise ValueError(f"Invalid IP octet: {p}")
    
    if name == "pid":
        pid = int(value)
        if pid <= 2:
            raise ValueError(f"Cannot target system PID: {pid}")
    
    return value


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Playbook Runner", version="1.0.0")


class PlaybookRequest(BaseModel):
    action: str
    verdict: Optional[dict] = None
    event: Optional[dict] = None
    timestamp: Optional[str] = None
    
    # Direct args for simpler calls
    ip: Optional[str] = None
    host: Optional[str] = None
    pid: Optional[str] = None
    severity: Optional[str] = None
    message: Optional[str] = None
    reason: Optional[str] = None


@app.post("/execute")
async def execute_playbook(req: PlaybookRequest):
    """Execute a playbook. Only accepts the 5 allowed playbooks."""
    action = req.action
    
    # --- Validate action is allowed ---
    if action not in ALLOWED_PLAYBOOKS:
        audit_log({
            "event": "rejected",
            "action": action,
            "reason": "unknown_playbook",
        })
        raise HTTPException(status_code=400, detail=f"Unknown playbook: {action}")
    
    playbook = ALLOWED_PLAYBOOKS[action]
    script_path = os.path.join(SCRIPTS_DIR, playbook["script"])
    
    if not os.path.isfile(script_path):
        raise HTTPException(status_code=500, detail=f"Script not found: {playbook['script']}")
    
    # --- Extract and validate arguments ---
    args = []
    arg_log = {}
    
    # Get args from request fields or from verdict/event
    for arg_name in playbook["required_args"] + playbook["optional_args"]:
        value = getattr(req, arg_name, None)
        
        # Try to extract from event/verdict if not directly provided
        if value is None and req.event:
            if arg_name == "ip":
                value = req.event.get("remote_addr") or req.event.get("source_ip")
            elif arg_name == "host":
                value = req.event.get("source_host")
            elif arg_name == "pid":
                # Extract PID from process field
                proc = req.event.get("process", "")
                pid_match = re.search(r"pid=(\d+)", proc)
                if pid_match:
                    value = pid_match.group(1)
            elif arg_name == "severity":
                value = req.verdict.get("threat_level", "warning").lower() if req.verdict else "warning"
            elif arg_name == "message":
                if req.verdict:
                    value = f"{req.verdict.get('attack_type', 'unknown')}: {req.verdict.get('reasoning', '')}"[:200]
            elif arg_name == "reason":
                if req.verdict:
                    value = req.verdict.get("attack_type", "automated_response")
        
        if value is None:
            if arg_name in playbook["required_args"]:
                audit_log({
                    "event": "rejected",
                    "action": action,
                    "reason": f"missing_required_arg:{arg_name}",
                })
                raise HTTPException(
                    status_code=400, detail=f"Missing required argument: {arg_name}"
                )
            continue
        
        try:
            value = validate_arg(arg_name, str(value))
        except ValueError as e:
            audit_log({
                "event": "rejected",
                "action": action,
                "reason": f"invalid_arg:{arg_name}",
                "detail": str(e),
            })
            raise HTTPException(status_code=400, detail=str(e))
        
        args.append(value)
        arg_log[arg_name] = value
    
    # --- Execute the script ---
    audit_log({
        "event": "executing",
        "action": action,
        "args": arg_log,
        "script": playbook["script"],
    })
    
    logger.info(f"Executing playbook: {action} with args {arg_log}")
    
    try:
        result = subprocess.run(
            ["bash", script_path] + args,
            capture_output=True,
            text=True,
            timeout=60,
            env={
                **os.environ,
                "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
            },
        )
        
        output = result.stdout.strip()
        stderr = result.stderr.strip()
        
        audit_log({
            "event": "completed",
            "action": action,
            "args": arg_log,
            "exit_code": result.returncode,
            "output": output[:500],
            "stderr": stderr[:200] if stderr else None,
        })
        
        # Try to parse JSON output from script
        try:
            result_json = json.loads(output)
        except json.JSONDecodeError:
            result_json = {"raw_output": output}
        
        return {
            "status": "success" if result.returncode == 0 else "error",
            "action": action,
            "exit_code": result.returncode,
            "result": result_json,
        }
        
    except subprocess.TimeoutExpired:
        audit_log({
            "event": "timeout",
            "action": action,
            "args": arg_log,
        })
        raise HTTPException(status_code=504, detail="Playbook execution timed out")
    except Exception as e:
        audit_log({
            "event": "error",
            "action": action,
            "args": arg_log,
            "error": str(e),
        })
        raise HTTPException(status_code=500, detail=f"Execution error: {e}")


@app.get("/health")
async def health():
    """Health check."""
    scripts_ok = all(
        os.path.isfile(os.path.join(SCRIPTS_DIR, pb["script"]))
        for pb in ALLOWED_PLAYBOOKS.values()
    )
    return {
        "status": "healthy" if scripts_ok else "degraded",
        "available_playbooks": list(ALLOWED_PLAYBOOKS.keys()),
        "scripts_dir": SCRIPTS_DIR,
        "all_scripts_present": scripts_ok,
    }


@app.get("/audit")
async def get_audit(count: int = 20):
    """Get recent audit log entries."""
    if count > 100:
        count = 100
    try:
        with open(AUDIT_LOG) as f:
            lines = f.readlines()
        entries = []
        for line in lines[-count:]:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return {"entries": entries}
    except FileNotFoundError:
        return {"entries": []}


# ---------------------------------------------------------------------------
# Entry point — Unix socket
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Ensure scripts are executable
    for pb in ALLOWED_PLAYBOOKS.values():
        script = os.path.join(SCRIPTS_DIR, pb["script"])
        if os.path.isfile(script):
            os.chmod(script, 0o755)
    
    os.makedirs(os.path.dirname(AUDIT_LOG), exist_ok=True)
    
    # Remove stale socket
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    
    logger.info(f"Starting playbook runner on {SOCKET_PATH}")
    uvicorn.run(
        "playbook_runner:app",
        uds=SOCKET_PATH,
        log_level="info",
    )
