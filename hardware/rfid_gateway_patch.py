#!/usr/bin/env python3
"""
Patch for RFID Gateway: Adds guild count monitoring for 5461AS display
This gets appended to the RFIDGateway class
"""

# Add these methods to the RFIDGateway class:

def send_count(self, count):
    """Send guild count to 7-segment display"""
    if self.arduino:
        try:
            self.arduino.write(f"COUNT:{count}\n".encode('ascii'))
            self.arduino.flush()
        except:
            pass

def _get_guild_count(self):
    """Get guild count from bot status file or journalctl"""
    import re
    # Try status file first
    status_file = "/home/ubuntu/discord-bot/data/bot_status.json"
    try:
        if os.path.exists(status_file):
            with open(status_file) as f:
                data = json.load(f)
                count = data.get('guild_count', 0)
                if count:
                    return count
    except:
        pass
    
    # Try journalctl
    try:
        import subprocess
        result = subprocess.run(
            ["journalctl", "-u", "discord-bot", "-n", "50", "--no-pager"],
            capture_output=True, text=True, timeout=3
        )
        if result.returncode == 0:
            for line in reversed(result.stdout.split('\n')):
                if "Serving" in line and "guild" in line:
                    match = re.search(r'Serving (\d+) guild', line)
                    if match:
                        return int(match.group(1))
                if "Monitoring" in line and "server" in line:
                    match = re.search(r'Monitoring (\d+) server', line)
                    if match:
                        return int(match.group(1))
    except:
        pass
    
    return 0

def _guild_count_monitor(self):
    """Background thread to update guild count on 7-segment display"""
    import subprocess, re
    last_count = None
    while self.running:
        try:
            count = self._get_guild_count()
            if count != last_count:
                self.send_count(count)
                log(f"  Guild count updated: {count}")
                last_count = count
        except Exception as e:
            log(f"  Guild count error: {e}")
        time.sleep(10)
