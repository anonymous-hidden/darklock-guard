#!/usr/bin/env python3
"""
RFID Card Management Tool
Add, remove, and list authorized cards
"""
import os
import sys
import json
import hashlib
from datetime import datetime
from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO

ALLOWLIST_PATH = "/mnt/nvme/discord-bot/data/rfid_allowlist.json"

def load_allowlist():
    if os.path.exists(ALLOWLIST_PATH):
        with open(ALLOWLIST_PATH) as f:
            return json.load(f)
    return {"cards": {}, "updated": None}

def save_allowlist(data):
    data["updated"] = datetime.now().isoformat()
    tmp = ALLOWLIST_PATH + ".tmp"
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, ALLOWLIST_PATH)
    print(f"✓ Saved to {ALLOWLIST_PATH}")

def scan_card():
    """Scan and return card UID"""
    print("Present card to reader...")
    reader = SimpleMFRC522()
    try:
        uid, _ = reader.read()
        return uid
    finally:
        GPIO.cleanup()

def add_card(name):
    """Add a new authorized card"""
    uid = scan_card()
    uid_hash = hashlib.sha256(str(uid).encode()).hexdigest()
    
    data = load_allowlist()
    
    if uid_hash in data["cards"]:
        print(f"✗ Card already registered as: {data['cards'][uid_hash]}")
        return
    
    data["cards"][uid_hash] = name
    save_allowlist(data)
    print(f"✓ Added card: {name}")
    print(f"  UID: {uid}")
    print(f"  Hash: {uid_hash[:16]}...")

def remove_card():
    """Remove an authorized card"""
    uid = scan_card()
    uid_hash = hashlib.sha256(str(uid).encode()).hexdigest()
    
    data = load_allowlist()
    
    if uid_hash not in data["cards"]:
        print(f"✗ Card not found in allowlist")
        return
    
    name = data["cards"].pop(uid_hash)
    save_allowlist(data)
    print(f"✓ Removed card: {name}")

def list_cards():
    """List all authorized cards"""
    data = load_allowlist()
    cards = data.get("cards", {})
    
    if not cards:
        print("No cards registered")
        return
    
    print(f"\nAuthorized Cards ({len(cards)}):")
    print("─" * 60)
    for uid_hash, name in cards.items():
        print(f"  {name:<30} {uid_hash[:16]}...")
    print(f"\nLast updated: {data.get('updated', 'unknown')}")

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  rfid_manage.py add <name>   - Add new card")
        print("  rfid_manage.py remove       - Remove card")
        print("  rfid_manage.py list         - List all cards")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "add":
        if len(sys.argv) < 3:
            print("Error: Missing name argument")
            sys.exit(1)
        name = " ".join(sys.argv[2:])
        add_card(name)
    elif cmd == "remove":
        remove_card()
    elif cmd == "list":
        list_cards()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

if __name__ == "__main__":
    main()
