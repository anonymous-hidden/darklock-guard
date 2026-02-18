#!/usr/bin/env python3
"""Simple IPC test without keyring dependency"""
import socket
import json
import os
from pathlib import Path

SOCKET_PATH = Path.home() / ".local/share/guard/guard.ipc"

def test_connection():
    """Test basic socket connection"""
    if not SOCKET_PATH.exists():
        print(f"❌ Socket not found at {SOCKET_PATH}")
        return
    
    print(f"✅ Socket found at {SOCKET_PATH}")
    
    # Try to get device ID from vault info
    # The device ID should be 4f5944f26885b15c based on init output
    device_id = "4f5944f26885b15c"
    
    # Try to read the IPC secret from keyring using Python keyring module
    try:
        import keyring
        secret = keyring.get_password("darklock-guard", f"ipc-secret-{device_id}")
        if secret:
            print(f"✅ Found IPC secret in keyring")
            return secret
    except ImportError:
        print("⚠️  keyring module not installed")
    except Exception as e:
        print(f"⚠️  Could not read from keyring: {e}")
    
    # Alternative: try using secret-tool on Linux
    try:
        import subprocess
        result = subprocess.run(
            ["secret-tool", "lookup", "service", device_id],
            capture_output=True,
            text=True
        )
        if result.returncode == 0 and result.stdout:
            print("✅ Found IPC secret using secret-tool")
            return result.stdout.strip()
    except Exception as e:
        print(f"⚠️  Could not use secret-tool: {e}")
    
    return None

def send_simple_request(secret=None):
    """Try to send a simple GetStatus request"""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(str(SOCKET_PATH))
        print("✅ Connected to socket")
        
        # IPC request format - it's just a string variant name
        request = "GetStatus"
        messagestr = json.dumps(request)
        
        if secret:
            import hmac
            import hashlib
            h = hmac.new(secret.encode(), messagestr.encode(), hashlib.sha256)
            auth = h.hexdigest()
            message = f"{auth}\n{messagestr}\n".encode()
        else:
            # Try without auth to see error
            message = f"dummy_auth\n{messagestr}\n".encode()
        
        sock.sendall(message)
        print("✅ Sent request")
        
        response = b""
        sock.settimeout(2.0)
        while True:
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                response += chunk
                if b'\n' in response:
                    break
            except socket.timeout:
                break
        
        print(f"📥 Response: {response.decode()}")
        return response
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        sock.close()

if __name__ == "__main__":
    print("🔍 Testing IPC Connection")
    print("=" * 50)
    secret = test_connection()
    print()
    send_simple_request(secret)
