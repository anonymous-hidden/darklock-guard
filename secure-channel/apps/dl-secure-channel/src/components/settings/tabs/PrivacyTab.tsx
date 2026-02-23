/**
 * PrivacyTab — auto-lock, clipboard, screenshot, retention, cache.
 * Clipboard protection: clears clipboard 60s after any copy event.
 * Screenshot protection: calls Tauri setContentProtected(bool).
 */
import { useState, useEffect, useRef } from "react";
import { Trash2, Check, Loader2, RotateCcw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clearLocalCache, setSetting } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";

// ── Clipboard auto-clear ─────────────────────────────────────────────────────
function useClipboardProtection(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        navigator.clipboard.writeText("").catch(() => {});
      }, 60_000);
    };
    document.addEventListener("copy", handler);
    return () => {
      document.removeEventListener("copy", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);
}

function Toggle({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/[0.05] last:border-0">
      <div className="flex-1 mr-6">
        <p className="text-sm text-white/75">{label}</p>
        {description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
          checked ? "bg-dl-accent" : "bg-white/10"
        }`}
      >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`} />
      </button>
    </div>
  );
}

const RETENTION_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: 0, label: "Forever" },
];

const LOCK_OPTIONS = [
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 0, label: "Never" },
];

export default function PrivacyTab() {
  const { privacy, updatePrivacy } = useSettingsStore();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleResetDefaults = async () => {
    setResetting(true);
    const defaults = { autoLockMinutes: 15, clipboardProtection: true, screenshotProtection: false, messageRetentionDays: 90 };
    updatePrivacy(defaults);
    await getCurrentWindow().setContentProtected(false).catch(() => {});
    await Promise.allSettled([
      save("auto_lock_minutes", "15"),
      save("clipboard_protection", "true"),
      save("screenshot_protection", "false"),
      save("message_retention_days", "90"),
    ]);
    setResetting(false); setResetDone(true);
    setTimeout(() => setResetDone(false), 2000);
  };

  // Real clipboard auto-clear
  useClipboardProtection(privacy.clipboardProtection);

  // Real screenshot protection via Tauri window API
  useEffect(() => {
    getCurrentWindow()
      .setContentProtected(privacy.screenshotProtection)
      .catch(() => {});
  }, [privacy.screenshotProtection]);

  const save = async (key: string, val: string) => {
    try { await setSetting(key, val); } catch {}
  };

  const handleClearCache = async () => {
    setClearing(true); setError(null);
    try {
      await clearLocalCache();
      setCleared(true);
      setTimeout(() => setCleared(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Auto-lock */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Vault Security</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/75">Auto-lock timer</p>
            <p className="text-xs text-white/30 mt-0.5">Lock vault after inactivity</p>
          </div>
          <select
            value={privacy.autoLockMinutes}
            onChange={(e) => {
              const v = Number(e.target.value);
              updatePrivacy({ autoLockMinutes: v });
              save("auto_lock_minutes", String(v));
            }}
            className="dl-select w-auto min-w-[130px]"
          >
            {LOCK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-5 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 pt-3 pb-1">Protection</h3>
        <Toggle
          label="Clipboard Protection"
          description="Automatically clear clipboard after 60 seconds"
          checked={privacy.clipboardProtection}
          onChange={(v) => { updatePrivacy({ clipboardProtection: v }); save("clipboard_protection", String(v)); }}
        />
        <Toggle
          label="Screenshot Protection"
          description="Prevent screenshots and screen recording (desktop only)"
          checked={privacy.screenshotProtection}
          onChange={(v) => { updatePrivacy({ screenshotProtection: v }); save("screenshot_protection", String(v)); }}
        />
      </div>

      {/* Message Retention */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Message Retention</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/75">Keep messages for</p>
            <p className="text-xs text-white/30 mt-0.5">Older messages are deleted from local vault</p>
          </div>
          <select
            value={privacy.messageRetentionDays}
            onChange={(e) => {
              const v = Number(e.target.value);
              updatePrivacy({ messageRetentionDays: v });
              save("message_retention_days", String(v));
            }}
            className="dl-select w-auto min-w-[130px]"
          >
            {RETENTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Clear Cache */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Local Data</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/75">Clear local cache</p>
            <p className="text-xs text-white/30 mt-0.5">Removes temporary files and cached data.</p>
          </div>
          <button
            onClick={handleClearCache}
            disabled={clearing}
            className="dl-btn-ghost flex items-center gap-2 text-sm px-4 py-1.5"
          >
            {clearing ? <Loader2 size={13} className="animate-spin" /> :
             cleared ? <Check size={13} className="text-green-400" /> :
             <Trash2 size={13} />}
            {cleared ? "Cleared!" : "Clear Cache"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Restore defaults */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-white/50">Restore to defaults</p>
          <p className="text-xs text-white/25 mt-0.5">Auto-lock 15 min · Clipboard protection on · Retention 90 days</p>
        </div>
        <button
          onClick={handleResetDefaults}
          disabled={resetting}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.04] transition-all shrink-0 ml-4 disabled:opacity-50"
        >
          {resetting ? <Loader2 size={12} className="animate-spin" /> : resetDone ? <Check size={12} className="text-green-400" /> : <RotateCcw size={12} />}
          {resetDone ? "Done!" : "Reset"}
        </button>
      </div>
    </div>
  );
}
