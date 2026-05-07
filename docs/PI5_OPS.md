# Raspberry Pi 5 — Operations Guide

> **Hardware:** Raspberry Pi 5 Model B Rev 1.0  
> **Storage:** 234 GB NVMe (`/mnt/nvme`)  
> **RAM:** 7.7 GB  
> **Node.js:** v20.20.2  
> **Project path:** `/mnt/nvme/discord-bot`

---

## SSH Access

### Local Network
```bash
ssh darklock@192.168.50.151
# password: 0131106761Cb
```

### Over Tailscale (VPN — works anywhere)
```bash
ssh darklock@100.117.105.41
# password: 0131106761Cb
```

### Key-based auth (no password prompt)
```bash
# Run once from your dev machine:
ssh-copy-id darklock@192.168.50.151
```

---

## Deploying Code

> **CRITICAL:** After deploying ANY file, you must regenerate the tamper baseline or the bot will refuse to start.

### 1. Deploy a single file
```bash
rsync -az --checksum \
  src/dashboard/dashboard.js \
  darklock@192.168.50.151:/mnt/nvme/discord-bot/src/dashboard/dashboard.js
```

### 2. Deploy a whole subdirectory
```bash
rsync -az --checksum \
  src/dashboard/ \
  darklock@192.168.50.151:/mnt/nvme/discord-bot/src/dashboard/
```

### 3. Deploy the full project (excludes secrets and deps)
```bash
cd "/home/cayden/discord bot/discord bot"

rsync -az --checksum \
  --exclude=node_modules \
  --exclude=.env \
  --exclude=data/ \
  --exclude=logs/ \
  --exclude=uploads/ \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  . \
  darklock@192.168.50.151:/mnt/nvme/discord-bot/
```

### 4. Or use the existing deploy scripts
```bash
# Quick deploy (rsync only)
bash scripts/deploy-to-pi5.sh

# Full deploy with service restart
bash scripts/pi5-deploy.sh
```

---

## Tamper Baseline (ALWAYS run after file changes)

```bash
ssh darklock@192.168.50.151 \
  "cd /mnt/nvme/discord-bot && npm run tamper:generate"
```

If you deploy files and then restart without regenerating, the bot will exit immediately with a tamper-detection error.

---

## Service Management

### Restart a service
```bash
# Paste-ready — uses inline sudo with password
ssh darklock@192.168.50.151 \
  "echo '0131106761Cb' | sudo -S systemctl restart darklock-bot"

ssh darklock@192.168.50.151 \
  "echo '0131106761Cb' | sudo -S systemctl restart darklock-platform"
```

### Check status
```bash
ssh darklock@192.168.50.151 \
  "systemctl status darklock-bot --no-pager"
```

### View live logs
```bash
ssh darklock@192.168.50.151 \
  "journalctl -u darklock-bot -f"

# Last 5 minutes only
ssh darklock@192.168.50.151 \
  "journalctl -u darklock-bot --since '5 min ago' --no-pager"

# All services combined
ssh darklock@192.168.50.151 \
  "journalctl -u darklock-bot -u darklock-platform -u darklock-relay -f"
```

### Stop / start
```bash
ssh darklock@192.168.50.151 \
  "echo '0131106761Cb' | sudo -S systemctl stop darklock-bot"

ssh darklock@192.168.50.151 \
  "echo '0131106761Cb' | sudo -S systemctl start darklock-bot"
```

---

## Full Deploy + Restart Workflow

This is the typical sequence for pushing a code change:

```bash
# 1. Sync the file(s)
rsync -az --checksum \
  src/dashboard/dashboard.js \
  darklock@192.168.50.151:/mnt/nvme/discord-bot/src/dashboard/dashboard.js

# 2. Regenerate tamper baseline
ssh darklock@192.168.50.151 \
  "cd /mnt/nvme/discord-bot && npm run tamper:generate"

# 3. Restart the service
ssh darklock@192.168.50.151 \
  "echo '0131106761Cb' | sudo -S systemctl restart darklock-bot"

# 4. Tail logs to confirm startup
ssh darklock@192.168.50.151 \
  "journalctl -u darklock-bot -f --since now"
```

---

## Services & Ports

| Service | Port | systemd unit | Entry point |
|---|---|---|---|
| Discord Bot | 3001 | `darklock-bot` | `src/bot.js` |
| Darklock Platform | 3002 | `darklock-platform` | `darklock/start.js` |
| Darklock Server | 3000 | `darklock-server` | `darklock/server.js` |
| Notes Server | 3003 | `darklock-notes` | `darklock-notes/apps/server/dist/index.js` |
| Room Control Bridge / XP | 3007 | `darklock-room-bridge` | `darklock/services/room-control-bridge.js` |
| IDS (Intrusion Detection) | 4100 | `darklock-ids` | `secure-channel/services/dl_ids/src/server.js` |
| Relay | 4101 | `darklock-relay` | `secure-channel/services/dl_rly/src/server.js` |
| RFID Gateway | 9999 | `darklock-rfid` | `hardware/rfid_gateway.py` |
| Hardware Controller | — | `darklock-hardware` | `hardware_controller.py` |
| Pico Bridge | — | `darklock-pico` | `hardware/pico_guild_display/pico_bridge.py` |
| Nova Monitor | — | `nova-monitor` | `scripts/nova-monitor/nova-monitor.py` |
| Elegoo Guild Display | — | `elegoo-guild-display` | `hardware/elegoo_guild_display/elegoo_bridge.py` |
| Elegoo Status Board | — | `elegoo-status-board` | `hardware/elegoo_status_board/elegoo_status_bridge.py` |

### Service group restarts

```bash
# Restart the full bot stack
ssh darklock@192.168.50.151 "echo '0131106761Cb' | sudo -S systemctl restart darklock-bot darklock-platform darklock-room-bridge"

# Restart secure-channel services
ssh darklock@192.168.50.151 "echo '0131106761Cb' | sudo -S systemctl restart darklock-ids darklock-relay"

# Restart hardware services
ssh darklock@192.168.50.151 "echo '0131106761Cb' | sudo -S systemctl restart darklock-hardware darklock-rfid darklock-pico"
```

---

## Tailscale

Tailscale is already installed and running on the Pi5.

### Pi5 Tailscale IP
```
100.117.105.41
```

### Check status
```bash
ssh darklock@192.168.50.151 "tailscale status"
```

### Connect / reconnect
```bash
# From the Pi5 console / KVM:
sudo tailscale up

# Re-authenticate (if auth expired):
sudo tailscale up --reset
# Then open the login URL on your phone/browser
```

### First-time Tailscale setup (new machine)
See [scripts/tailscale-setup.sh](../scripts/tailscale-setup.sh)

### Common Tailscale commands
```bash
# Check current IP
tailscale ip -4

# Check all devices on your network
tailscale status

# Ping the Pi5 from another device
tailscale ping raspberry-pi-5

# Enable subnet routing (expose Pi5's LAN)
sudo tailscale up --advertise-routes=192.168.50.0/24

# Enable exit node
sudo tailscale up --advertise-exit-node
```

---

## npm Tasks Reference

These run inside the project directory on the Pi5:

```bash
ssh darklock@192.168.50.151 "cd /mnt/nvme/discord-bot && npm run <task>"
```

| Task | What it does |
|---|---|
| `npm run tamper:generate` | Regenerate file integrity baseline (run after any deploy) |
| `npm run tamper:verify` | Manually check tamper state |
| `npm start` | Start the bot directly (foreground) |
| `npm run dev` | Start with auto-reload (dev mode) |

---

## System Info Commands

```bash
# CPU and memory usage
ssh darklock@192.168.50.151 "top -bn1 | head -20"

# Disk usage
ssh darklock@192.168.50.151 "df -h /mnt/nvme"

# Running node processes
ssh darklock@192.168.50.151 "ps aux | grep node | grep -v grep"

# All project services status at once
ssh darklock@192.168.50.151 "systemctl status darklock-bot darklock-platform darklock-relay darklock-ids darklock-notes --no-pager"

# Temperature
ssh darklock@192.168.50.151 "vcgencmd measure_temp"

# NVMe health
ssh darklock@192.168.50.151 "echo '0131106761Cb' | sudo -S nvme smart-log /dev/nvme0 2>/dev/null | grep -E 'temperature|percentage_used|power_on'"
```

---

## Environment File

The main `.env` file lives at `/mnt/nvme/discord-bot/.env`. It is never synced by rsync (excluded for safety).

To edit it on the Pi5:
```bash
ssh darklock@192.168.50.151 "nano /mnt/nvme/discord-bot/.env"
```

After editing `.env`, restart affected services and regenerate the tamper baseline.

---

## Sudoers Note

The `darklock` user requires password confirmation for `sudo`. Password is `0131106761Cb`.

To avoid repeated prompts in automation, pipe it inline:
```bash
echo '0131106761Cb' | sudo -S <command>
```

Or configure passwordless sudo for specific commands:
```bash
# Run from root or as a user with full sudo:
echo 'darklock ALL=(ALL) NOPASSWD: /bin/systemctl' | sudo tee /etc/sudoers.d/darklock-systemctl
```
