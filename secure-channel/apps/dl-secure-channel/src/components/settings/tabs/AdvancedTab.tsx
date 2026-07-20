/**
 * AdvancedTab — backup, debug logs, vault reset (with extreme warning).
 */
import { useState } from "react";
import {
  Download, Bug, AlertTriangle, Trash2,
  Check, Loader2, RefreshCw,
} from "lucide-react";
import { exportBackup, resetVault, setSetting, clearLocalCache } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import { useLayoutStore } from "@/store/layoutStore";

export default function AdvancedTab() {
  const { debugLogs, setDebugLogs } = useSettingsStore();
  const { clearAuth } = useAuthStore();
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildDone, setRebuildDone] = useState(false);

  const handleExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const path = await exportBackup();
      setExportPath(path); setExportDone(true);
      setTimeout(() => setExportDone(false), 3000);
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleReset = async () => {
    if (!resetPassword) { setResetError("Enter your current password to confirm."); return; }
    setResetting(true); setResetError(null);
    try {
      await resetVault(resetPassword);
      // Clear all server/channel state before clearing auth
      useServerStore.getState().reset();
      useLayoutStore.getState().setActiveServer(null);
      clearAuth();
    } catch (e) {
      setResetError(String(e));
    } finally {
      setResetting(false);
    }
  };

  const handleRebuildIndex = async () => {
    setRebuilding(true);
    try {
      await clearLocalCache();
      setRebuildDone(true);
      setTimeout(() => setRebuildDone(false), 3000);
    } catch {
      // silent — cache clear is best-effort
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Backup */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Data Backup</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/75">Export Encrypted Backup</p>
            <p className="text-xs text-white/30 mt-0.5">Saves an encrypted export of your local vault to disk.</p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="dl-btn-ghost flex items-center gap-2 text-sm px-4 py-1.5"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> :
             exportDone ? <Check size={13} className="text-green-400" /> :
             <Download size={13} />}
            {exportDone ? "Exported!" : "Export"}
          </button>
        </div>
        {exportPath && <p className="text-xs text-white/30 font-mono">{exportPath}</p>}
        {exportError && <p className="text-xs text-red-400">{exportError}</p>}

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
          <div>
            <p className="text-sm text-white/75">Import Backup</p>
            <p className="text-xs text-white/30 mt-0.5">Restore from an encrypted vault backup.</p>
          </div>
          <span className="text-[10px] bg-white/[0.06] text-white/40 px-2 py-1 rounded-full font-medium whitespace-nowrap">Coming Soon</span>
        </div>
      </div>

      {/* Debug Logs */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bug size={15} className="text-white/30" />
            <div>
              <p className="text-sm text-white/75">Enable Debug Logs</p>
              <p className="text-xs text-white/30 mt-0.5">Writes verbose logs to disk. Disable in production.</p>
            </div>
          </div>
          <button
            onClick={() => { setDebugLogs(!debugLogs); setSetting("debug_logs", String(!debugLogs)).catch(() => {}); }}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${debugLogs ? "bg-dl-accent" : "bg-white/10"}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${debugLogs ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* Rebuild Search Index */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw size={15} className="text-white/30" />
            <div>
              <p className="text-sm text-white/75">Rebuild Local Search Index</p>
              <p className="text-xs text-white/30 mt-0.5">Clears cached data and rebuilds the local search index for faster lookups.</p>
            </div>
          </div>
          <button
            onClick={handleRebuildIndex}
            disabled={rebuilding}
            className="dl-btn-ghost flex items-center gap-2 text-sm px-4 py-1.5"
          >
            {rebuilding ? <Loader2 size={13} className="animate-spin" /> :
             rebuildDone ? <Check size={13} className="text-green-400" /> :
             <RefreshCw size={13} />}
            {rebuildDone ? "Done!" : "Rebuild"}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-red-400/50 uppercase tracking-widest px-1">Danger Zone</p>
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-red-400/70 shrink-0 mt-0.5" />
            <p className="text-xs text-white/40 leading-relaxed">
              <strong className="text-red-400/70">This will permanently destroy all local data</strong> — messages, contacts, sessions, and keys. This cannot be undone. Your account on the server will remain, but you will need to re-enroll this device.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Enter password to confirm…"
              className="dl-input text-sm flex-1"
            />
            <button
              onClick={handleReset}
              disabled={resetting || !resetPassword}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/25 transition-all whitespace-nowrap disabled:opacity-50"
            >
              {resetting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Reset Vault
            </button>
          </div>
          {resetError && <p className="text-xs text-red-400">{resetError}</p>}
        </div>
      </div>
    </div>
  );
}
