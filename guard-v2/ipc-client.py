#!/usr/bin/env python3
"""
Simple IPC client for Darklock Guard
Allows you to configure protected paths and control the service
"""

import socket
import json
import hmac
import hashlib
import os
from pathlib import Path

SOCKET_PATH = Path.home() / ".local/share/guard/guard.ipc"

def get_ipc_secret():
    """Read IPC secret from keyring storage"""
    # The service stores it via secure_storage module
    # For testing, we'll need to read from the keyring or file
    secret_file = Path.home() / ".local/share/darklock-guard/.ipc_secret"
    if secret_file.exists():
        return secret_file.read_text().strip()
    
    # Try to get from environment
    secret = os.environ.get('DARKLOCK_IPC_SECRET')
    if secret:
        return secret
    
    raise Exception("IPC secret not found. Service must be running first.")

def send_ipc_request(request):
    """Send IPC request to the service"""
    if not SOCKET_PATH.exists():
        raise Exception(f"Service not running. Socket not found at {SOCKET_PATH}")
    
    # Get IPC secret for authentication
    secret = get_ipc_secret()
    
    # Create request payload
    request_json = json.dumps(request)
    
    # Calculate HMAC for authentication
    h = hmac.new(secret.encode(), request_json.encode(), hashlib.sha256)
    auth_header = h.hexdigest()
    
    # Connect and send
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(str(SOCKET_PATH))
        
        # Send auth header + newline + request
        message = f"{auth_header}\n{request_json}\n"
        sock.sendall(message.encode())
        
        # Read response
        response = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk
            if b'\n' in response:
                break
        
        return json.loads(response.decode().strip())
    finally:
        sock.close()

def set_protected_paths(paths):
    """Configure which paths the service should protect"""
    request = {
        "SetProtectedPaths": {
            "paths": paths
        }
    }
    response = send_ipc_request(request)
    return response

def get_status():
    """Get service status"""
    request = "GetStatus"
    response = send_ipc_request(request)
    return response

def create_baseline():
    """Create a new baseline of all protected files"""
    request = "BaselineCreate"
    response = send_ipc_request(request)
    return response

def trigger_scan():
    """Trigger an immediate integrity scan"""
    request = "TriggerScan"
    response = send_ipc_request(request)
    return response

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Configure protection:  ./ipc-client.py protect ~/darklock-test/protected")
        print("  Get status:           ./ipc-client.py status")
        print("  Create baseline:      ./ipc-client.py baseline")
        print("  Trigger scan:         ./ipc-client.py scan")
        sys.exit(1)
    
    command = sys.argv[1]
    
    try:
        if command == "protect":
            if len(sys.argv) < 3:
                print("Error: Specify path to protect")
                sys.exit(1)
            
            path = os.path.expanduser(sys.argv[2])
            print(f"🔒 Configuring protection for: {path}")
            response = set_protected_paths([path])
            print(f"✅ Response: {response}")
            
            print("\n📝 Creating baseline...")
            response = create_baseline()
            print(f"✅ Baseline created: {response}")
            
            print("\n✅ Protection activated!")
            print("   The service will now protect all files in:")
            print(f"   {path}")
            
        elif command == "status":
            response = get_status()
            print(f"Service Status: {response}")
            
        elif command == "baseline":
            response = create_baseline()
            print(f"Baseline: {response}")
            
        elif command == "scan":
            response = trigger_scan()
            print(f"Scan: {response}")
            
        else:
            print(f"Unknown command: {command}")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Error: {e}")
        print("\nTroubleshooting:")
        print("  1. Is the service running? (./target/release/guard-service run)")
        print("  2. Does the socket exist? (ls ~/.local/share/darklock-guard/guard.sock)")
        print("  3. Check service logs for errors")
        sys.exit(1)

if __name__ == "__main__":
    main()
