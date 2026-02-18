#!/usr/bin/env python3
"""Patch rfid_gateway.py to add guild count monitoring for 7-segment display"""
import re

filepath = "/home/ubuntu/darklock/hardware/rfid_gateway.py"

with open(filepath, "r") as f:
    content = f.read()

# 1. Add subprocess import if not present
if "import subprocess" not in content:
    content = content.replace(
        "import serial",
        "import serial\nimport subprocess"
    )

# 2. Add send_count, _get_guild_count, _guild_count_monitor methods
new_methods = '''
    def send_count(self, count):
        """Send guild count to 7-segment display"""
        if self.arduino:
            try:
                self.arduino.write(f"COUNT:{count}\\n".encode("ascii"))
                self.arduino.flush()
            except: pass

    def _get_guild_count(self):
        """Get guild count from bot status file or journalctl"""
        status_file = "/home/ubuntu/discord-bot/data/bot_status.json"
        try:
            if os.path.exists(status_file):
                with open(status_file) as f:
                    data = json.load(f)
                    count = data.get("guild_count", 0)
                    if count:
                        return count
        except:
            pass
        try:
            result = subprocess.run(
                ["journalctl", "-u", "discord-bot", "-n", "50", "--no-pager"],
                capture_output=True, text=True, timeout=3
            )
            if result.returncode == 0:
                for line in reversed(result.stdout.split("\\n")):
                    if "Serving" in line and "guild" in line:
                        match = re.search(r"Serving (\\d+) guild", line)
                        if match:
                            return int(match.group(1))
                    if "Monitoring" in line and "server" in line:
                        match = re.search(r"Monitoring (\\d+) server", line)
                        if match:
                            return int(match.group(1))
        except:
            pass
        return 0

    def _guild_count_monitor(self):
        """Background thread: update guild count on 7-segment display"""
        last_count = None
        while self.running:
            try:
                count = self._get_guild_count()
                if count != last_count:
                    self.send_count(count)
                    log(f"  7-Seg guild count: {count}")
                    last_count = count
            except Exception as e:
                log(f"  Guild count error: {e}")
            time.sleep(10)

'''

# Insert before Card Management section
content = content.replace(
    "    # \u2500\u2500 Card Management",
    new_methods + "    # \u2500\u2500 Card Management"
)

# 3. Start guild count monitor thread when server starts
content = content.replace(
    "        self.running = True\n\n        import select",
    '        self.running = True\n\n        # Start guild count monitor for 7-segment display\n        threading.Thread(target=self._guild_count_monitor, daemon=True).start()\n        log("  Guild count monitor started (7-segment)")\n\n        import select'
)

# 4. Send initial count during startup  
content = content.replace(
    "    gateway.set_rfid(0, 0)       # LEDs off = idle\n\n    try:",
    '    gateway.set_rfid(0, 0)       # LEDs off = idle\n\n    # Send initial guild count to 7-segment display\n    initial_count = gateway._get_guild_count()\n    gateway.send_count(initial_count)\n    log(f"  Initial guild count: {initial_count}")\n\n    try:'
)

with open(filepath, "w") as f:
    f.write(content)

print("Patch applied successfully!")
print(f"File size: {len(content)} bytes")
