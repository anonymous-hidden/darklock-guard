"""
Step 7 — Cryptographic Heartbeat System
Jarvis emits a signed heartbeat every 30 seconds.
Watchdog verifies the signature and activates fallback on failure.
"""

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.exceptions import InvalidSignature

logger = logging.getLogger("heartbeat")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HEARTBEAT_FILE = "/var/run/security-pipeline/jarvis-heartbeat.json"
KEY_DIR = "/var/lib/security-pipeline/keys"
PRIVATE_KEY_FILE = os.path.join(KEY_DIR, "heartbeat.key")
PUBLIC_KEY_FILE = os.path.join(KEY_DIR, "heartbeat.pub")
HEARTBEAT_INTERVAL = 30  # seconds
WATCHDOG_MAX_AGE = 90    # seconds before considering heartbeat stale


def generate_keypair():
    """Generate ECDSA keypair for heartbeat signing."""
    os.makedirs(KEY_DIR, mode=0o700, exist_ok=True)
    
    private_key = ec.generate_private_key(ec.SECP256R1())
    
    # Save private key
    with open(PRIVATE_KEY_FILE, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    os.chmod(PRIVATE_KEY_FILE, 0o600)
    
    # Save public key
    public_key = private_key.public_key()
    with open(PUBLIC_KEY_FILE, "wb") as f:
        f.write(public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ))
    os.chmod(PUBLIC_KEY_FILE, 0o644)
    
    logger.info(f"Keypair generated: {KEY_DIR}")
    return private_key, public_key


def load_private_key():
    """Load the private key for signing heartbeats."""
    if not os.path.exists(PRIVATE_KEY_FILE):
        pk, _ = generate_keypair()
        return pk
    with open(PRIVATE_KEY_FILE, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def load_public_key():
    """Load the public key for verifying heartbeats."""
    with open(PUBLIC_KEY_FILE, "rb") as f:
        return serialization.load_pem_public_key(f.read())


class HeartbeatEmitter:
    """Emitter: runs inside the Jarvis process, signs and writes heartbeats."""
    
    def __init__(self):
        self.private_key = load_private_key()
        self.running = False
        self._task = None
        os.makedirs(os.path.dirname(HEARTBEAT_FILE), exist_ok=True)
    
    def emit(self):
        """Write a single signed heartbeat."""
        heartbeat = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "pid": os.getpid(),
            "uptime": time.monotonic(),
            "status": "alive",
        }
        
        # Sign the heartbeat data
        data = json.dumps(heartbeat, sort_keys=True).encode()
        signature = self.private_key.sign(data, ec.ECDSA(hashes.SHA256()))
        
        heartbeat["signature"] = signature.hex()
        
        with open(HEARTBEAT_FILE, "w") as f:
            json.dump(heartbeat, f)
            f.flush()
            os.fsync(f.fileno())
    
    async def start(self):
        """Start the heartbeat loop."""
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Heartbeat emitter started")
    
    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
    
    async def _loop(self):
        while self.running:
            try:
                self.emit()
            except Exception as e:
                logger.error(f"Heartbeat emit error: {e}")
            await asyncio.sleep(HEARTBEAT_INTERVAL)


class HeartbeatWatchdog:
    """
    Watchdog: runs as a SEPARATE process, verifies heartbeats.
    Triggers alert and fallback if heartbeat stops or signature fails.
    """
    
    def __init__(self):
        self.public_key = load_public_key()
        self.consecutive_failures = 0
        self.max_failures = 3  # Alert after 3 consecutive failures
    
    def verify(self) -> tuple[bool, str]:
        """Verify the current heartbeat. Returns (ok, reason)."""
        if not os.path.exists(HEARTBEAT_FILE):
            return False, "heartbeat_file_missing"
        
        try:
            with open(HEARTBEAT_FILE) as f:
                heartbeat = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            return False, f"heartbeat_unreadable: {e}"
        
        # Check age
        ts = heartbeat.get("timestamp", "")
        try:
            hb_time = datetime.fromisoformat(ts)
            age = (datetime.now(timezone.utc) - hb_time).total_seconds()
            if age > WATCHDOG_MAX_AGE:
                return False, f"heartbeat_stale: {age:.0f}s old"
        except (ValueError, TypeError):
            return False, "heartbeat_bad_timestamp"
        
        # Verify signature
        signature_hex = heartbeat.pop("signature", None)
        if not signature_hex:
            return False, "heartbeat_no_signature"
        
        try:
            data = json.dumps(heartbeat, sort_keys=True).encode()
            signature = bytes.fromhex(signature_hex)
            self.public_key.verify(signature, data, ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature, ValueError):
            return False, "heartbeat_invalid_signature"
        
        return True, "ok"
    
    def run(self):
        """Main watchdog loop (blocking, run in separate process)."""
        import subprocess
        
        ALERT_SCRIPT = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "step6-playbooks", "scripts", "alert_me.sh"
        )
        FALLBACK_SCRIPT = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "fallback-mode.sh"
        )
        
        logger.info("Heartbeat watchdog started")
        
        while True:
            ok, reason = self.verify()
            
            if ok:
                self.consecutive_failures = 0
                logger.debug("Heartbeat OK")
            else:
                self.consecutive_failures += 1
                logger.warning(
                    f"Heartbeat FAIL ({self.consecutive_failures}): {reason}"
                )
                
                if self.consecutive_failures >= self.max_failures:
                    logger.critical(
                        f"JARVIS DOWN — {self.consecutive_failures} consecutive failures"
                    )
                    
                    # Alert
                    if os.path.isfile(ALERT_SCRIPT):
                        subprocess.run(
                            ["bash", ALERT_SCRIPT, "critical",
                             f"Jarvis heartbeat failed: {reason}. Activating fallback mode."],
                            timeout=10,
                        )
                    
                    # Activate fallback
                    if os.path.isfile(FALLBACK_SCRIPT):
                        subprocess.run(
                            ["bash", FALLBACK_SCRIPT, "activate"],
                            timeout=30,
                        )
                    
                    # Reset counter (don't spam alerts every 30s)
                    self.consecutive_failures = 0
                    time.sleep(300)  # Wait 5min before checking again
                    continue
            
            time.sleep(HEARTBEAT_INTERVAL)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    
    mode = sys.argv[1] if len(sys.argv) > 1 else "watchdog"
    
    if mode == "generate-keys":
        generate_keypair()
        print(f"Keys generated in {KEY_DIR}")
    
    elif mode == "watchdog":
        watchdog = HeartbeatWatchdog()
        watchdog.run()
    
    elif mode == "test-emit":
        emitter = HeartbeatEmitter()
        emitter.emit()
        print(f"Heartbeat written to {HEARTBEAT_FILE}")
    
    elif mode == "test-verify":
        watchdog = HeartbeatWatchdog()
        ok, reason = watchdog.verify()
        print(f"Verified: {ok} ({reason})")
