/**
 * NotificationsTab — desktop, sound, message preview.
 * Requests OS notification permission when desktop notifications are enabled.
 */
import { useState } from "react";
import { Bell, Volume2, Eye, AlertTriangle, RotateCcw, Check } from "lucide-react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useSettingsStore } from "@/store/settingsStore";
import { setSetting } from "@/lib/tauri";

function Toggle({ label, description, icon: Icon, checked, onChange }: {
  label: string; description?: string;
  icon: React.ElementType; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-3 flex-1 mr-6">
        <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
          <Icon size={15} className="text-white/40" />
        </div>
        <div>
          <p className="text-sm text-white/75">{label}</p>
          {description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${checked ? "bg-dl-accent" : "bg-white/10"}`}
      >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export default function NotificationsTab() {
  const { notifications, updateNotifications } = useSettingsStore();
  const [permDenied, setPermDenied] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleResetDefaults = () => {
    updateNotifications({ desktop: true, sound: true, messagePreview: false });
    save("notif_desktop", true);
    save("notif_sound", true);
    save("notif_preview", false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2000);
  };

  const save = (k: string, v: boolean) => setSetting(k, String(v)).catch(() => {});

  /** Request OS permission when enabling desktop notifications. */
  const handleDesktopToggle = async (v: boolean) => {
    setPermDenied(false);
    if (v) {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          const perm = await requestPermission();
          if (perm !== "granted") { setPermDenied(true); return; }
        }
      } catch {
        // Non-Tauri or permission API unavailable — allow toggle anyway
      }
    }
    updateNotifications({ desktop: v });
    save("notif_desktop", v);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-5 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 pt-4 pb-2">Notification Settings</h3>
        <Toggle
          label="Desktop Notifications"
          description="Show system notifications for new messages"
          icon={Bell}
          checked={notifications.desktop}
          onChange={handleDesktopToggle}
        />
        {permDenied && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-1">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>Notification permission was denied by the OS. Enable it in your system settings.</span>
          </div>
        )}
        <Toggle
          label="Notification Sound"
          description="Play a sound when a new message arrives"
          icon={Volume2}
          checked={notifications.sound}
          onChange={(v) => { updateNotifications({ sound: v }); save("notif_sound", v); }}
        />
        <Toggle
          label="Message Preview"
          description="Show message content in notifications (disabling improves privacy)"
          icon={Eye}
          checked={notifications.messagePreview}
          onChange={(v) => { updateNotifications({ messagePreview: v }); save("notif_preview", v); }}
        />
      </div>

      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
        <p className="text-xs text-white/30 leading-relaxed">
          All notifications are generated locally. Darklock never sends notification data to external services.
          Disabling message preview is recommended in shared environments.
        </p>
      </div>

      {/* Restore defaults */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-white/50">Restore to defaults</p>
          <p className="text-xs text-white/25 mt-0.5">Desktop on · Sound on · Message preview off</p>
        </div>
        <button
          onClick={handleResetDefaults}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.04] transition-all shrink-0"
        >
          {resetDone ? <Check size={12} className="text-green-400" /> : <RotateCcw size={12} />}
          {resetDone ? "Done!" : "Reset"}
        </button>
      </div>
    </div>
  );
}
