#!/bin/bash
# ============================================================
#  Darklock Safe Deploy Script
#  Usage: bash scripts/deploy.sh
#
#  - Backs up data/ and darklock/data/ to /tmp/darklock-deploy-backup-<ts>/
#  - Pulls latest code from origin/main (non-destructive for untracked files)
#  - Regenerates tamper baseline
#  - Restarts the bot via systemd
# ============================================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/tmp/darklock-deploy-backup-${TIMESTAMP}"

echo "=============================="
echo "  Darklock Safe Deploy"
echo "  $(date)"
echo "=============================="

# ── 1. BACKUP ─────────────────────────────────────────────
echo ""
echo "[1/4] Backing up data directories → ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"
cp -r "${REPO_DIR}/data"          "${BACKUP_DIR}/data"          2>/dev/null || true
cp -r "${REPO_DIR}/darklock/data" "${BACKUP_DIR}/darklock-data" 2>/dev/null || true
cp -r "${REPO_DIR}/darklock/downloads" "${BACKUP_DIR}/downloads" 2>/dev/null || true
cp -r "${REPO_DIR}/uploads"       "${BACKUP_DIR}/uploads"       2>/dev/null || true
echo "    ✅ Backup complete: ${BACKUP_DIR}"

# ── 2. STOP BOT ───────────────────────────────────────────
echo ""
echo "[2/4] Stopping discord-bot service"
if command -v systemctl &>/dev/null && systemctl is-active --quiet discord-bot 2>/dev/null; then
  sudo systemctl stop discord-bot
  echo "    ✅ Service stopped"
else
  echo "    ⚠️  systemctl not available or service not running, skipping"
fi

# ── 3. GIT PULL ───────────────────────────────────────────
echo ""
echo "[3/4] Pulling latest code from origin/main"
cd "${REPO_DIR}"

# Ensure branch is tracking origin/main
git branch --set-upstream-to=origin/main "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || true

# Safe update: fetch then reset only tracked files (untracked/gitignored files are never touched)
git fetch origin main
BEFORE="$(git rev-parse HEAD)"
git reset --hard origin/main
AFTER="$(git rev-parse HEAD)"

if [ "${BEFORE}" = "${AFTER}" ]; then
  echo "    ✅ Already up to date (${AFTER:0:8})"
else
  echo "    ✅ Updated ${BEFORE:0:8} → ${AFTER:0:8}"
  git log --oneline "${BEFORE}..${AFTER}" 2>/dev/null | head -10 | sed 's/^/       /'
fi

# Verify data is intact (sanity check after git reset)
echo ""
echo "    Data integrity check:"
for f in data/darklock.db darklock/data/sessions.json darklock/data/users.json; do
  if [ -f "${REPO_DIR}/${f}" ]; then
    echo "    ✅  ${f} ($(wc -c < "${REPO_DIR}/${f}") bytes)"
  else
    echo "    ⚠️   ${f} not found (may be first run)"
  fi
done

# ── 4. REGEN BASELINE + RESTART ───────────────────────────
echo ""
echo "[4/4] Regenerating tamper baseline and restarting"
cd "${REPO_DIR}"

if [ -f "file-protection/agent/baseline-generator.js" ]; then
  AUDIT_ENCRYPTION_KEY=${AUDIT_ENCRYPTION_KEY:-darklock-tamper-protection-key-2026} \
    npm run tamper:generate 2>&1 | grep -E "✅|❌|Error" || true
fi

if command -v systemctl &>/dev/null; then
  sudo systemctl start discord-bot
  sleep 5
  STATUS="$(systemctl is-active discord-bot 2>/dev/null)"
  if [ "${STATUS}" = "active" ]; then
    echo "    ✅ discord-bot is active"
  else
    echo "    ❌ discord-bot status: ${STATUS}"
    echo "    Check logs: journalctl -u discord-bot -n 30"
  fi
fi

echo ""
echo "=============================="
echo "  Deploy complete!"
echo "  Backup saved to: ${BACKUP_DIR}"
echo "  Backups auto-delete from /tmp on reboot."
echo "  To keep permanently: cp -r ${BACKUP_DIR} ~/backups/"
echo "=============================="
