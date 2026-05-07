# Room Control — Admin Guide

Hidden web panel for trusted people to control your room hardware (buzzers + Govee lights) remotely.

---

## SSH into the Pi5

```bash
ssh darklock@192.168.50.151
# password: 0131106761Cb
```

Once connected, **immediately run:**

```bash
cd ~/discord-bot
```

> All commands below assume you are inside `~/discord-bot`. If you skip this, you'll get `Cannot find module` errors.

---

## Quick Start (first-time setup)

SSH in, then run:

```bash
ssh darklock@192.168.50.151
# password: 0131106761Cb
cd ~/discord-bot
node darklock/scripts/room-control-cli.js url
node darklock/scripts/room-control-cli.js gen --label="for Alex"
```

The `gen` command prints the URL and the plaintext password **once** — it is never shown again. Copy both and send them to your person.

---

## Admin CLI Commands

All commands require SSH-ing into the Pi5 first and **cd-ing into the project folder**:

```bash
ssh darklock@192.168.50.151   # password: 0131106761Cb
cd ~/discord-bot
```

### Generate a password for someone

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot
node darklock/scripts/room-control-cli.js gen
node darklock/scripts/room-control-cli.js gen --label="for Riley"
node darklock/scripts/room-control-cli.js gen --label="couch test" --length=250
```

- `--label` is just a note for yourself so you can tell passwords apart in `list`
- `--length` defaults to 250 characters (bcrypt-hashed in the DB — the person just pastes it in)
- **The plaintext password is shown once and never again** — copy it before closing the terminal

Output looks like:

```
============================================================
 NEW ROOM CONTROL PASSWORD
============================================================
 ID      : 3
 Length  : 250
 Label   : for Riley
 URL     : https://darklock.net/r/abc123xyz

 PASSWORD (copy now -- not shown again):

 <very long password string here>

 Rules: first IP to redeem this password binds it.
        Sharing the password with another IP will fail.
============================================================
```

### List all active passwords

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot && node darklock/scripts/room-control-cli.js list
```

Shows each password's ID, status, label, when it was created, and which IP/username claimed it (if any).

### Revoke a password

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot && node darklock/scripts/room-control-cli.js revoke 3
```

Replace `3` with the ID from `list`. The person will be kicked out immediately on their next action.

### Get the current access URL

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot && node darklock/scripts/room-control-cli.js url
```

Prints the full URL. Share this along with the password.

### Rotate the URL slug

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot && node darklock/scripts/room-control-cli.js rotate-url
```

**This breaks all existing bookmarks.** Use this if you think someone stumbled on the URL. Everyone who had the old link will need the new one. Existing passwords still work on the new URL.

### View the action log

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot
node darklock/scripts/room-control-cli.js logs
node darklock/scripts/room-control-cli.js logs --limit=100
```

Shows recent activity: who did what, from which IP, and whether it succeeded.

---

## Sending Access to Someone

You need to send them **two things**:

1. **The URL** — SSH in and run `node darklock/scripts/room-control-cli.js url`
2. **Their password** — generated with `gen`, shown only once at generation time

Send them separately if you want (URL in Discord, password in a DM, etc.) or together — up to you.

**What they do:**
1. Open the URL in a browser
2. Paste the password
3. Pick a display name (shown in your logs)
4. Use the panel

### IP binding

The **first IP address** that uses a password locks it to that IP. If someone tries to use the same password from a different IP (e.g. they switch from wifi to mobile data) they'll get rejected. Generate them a new password for a new IP.

---

## What the Panel Can Do

Once logged in, the person can:

| Section | Controls |
|---|---|
| **Active buzzer** | Sound the loud digital buzzer for 100ms – 3000ms, or stop it |
| **Songs** | Play songs on the passive buzzers, or stop playback |
| **Govee lights** | Turn all lights on/off, pick a color, apply brightness, use preset moods/scenes, rescan devices |

### Govee notes
- LAN Control must be enabled in the Govee Home app for devices to appear
- Hit **Rescan** in the panel if devices aren't showing up
- Device list refreshes automatically every 30 seconds

---

## Security Notes

- The URL slug (the part after `/r/`) is secret — wrong URLs get a plain 404
- The page is blocked from search engines (`noindex,nofollow,noarchive`)
- Sessions are tied to the originating IP — a different network = kicked out
- Every action (buzzer, lights, login, logout) is logged with IP and username
- Bridge API is localhost-only on the Pi5; nobody can hit it directly from outside
- Rate limits: 8 login attempts per 15 minutes, 60 hardware actions per minute per IP

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Person gets 404 on the URL | URL slug may have been rotated — run `url` and re-send |
| Person gets "wrong IP" error | Generate a new password; their old one is bound to a different IP |
| Buzzer/lights not responding | Check that `darklock-room-bridge.service` is running on the Pi5 |
| No Govee devices showing | Enable LAN Control in the Govee Home app, hit Rescan in the panel |
| Forgotten who has access | SSH in, run `node darklock/scripts/room-control-cli.js list` — shows IP and username for each claimed password |
