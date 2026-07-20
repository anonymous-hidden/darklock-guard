/**
 * DevicesTab — enrolled devices list, remove, add.
 */
import { useEffect, useState } from "react";
import { Smartphone, Monitor, Laptop, Trash2, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { getProfile, removeDevice } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";
import type { DeviceDto } from "@/types";

function platformIcon(p: string) {
  if (p.includes("windows") || p.includes("macos")) return <Monitor size={16} />;
  if (p.includes("linux")) return <Laptop size={16} />;
  return <Smartphone size={16} />;
}

export default function DevicesTab() {
  const { profile, setProfile } = useSettingsStore();
  const [loading, setLoading] = useState(!profile);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) return;
    setLoading(true);
    getProfile().then(setProfile).catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);

  const handleRemove = async (device: DeviceDto) => {
    if (device.is_current_device) { setError("Cannot remove the current device."); return; }
    setRemoving(device.device_id);
    setError(null);
    try {
      await removeDevice(device.device_id);
      setProfile({ ...profile!, devices: profile!.devices.filter((d) => d.device_id !== device.device_id) });
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(null);
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-white/30" size={24} /></div>;

  const devices = profile?.devices ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white/80">Enrolled Devices</h3>
          <p className="text-xs text-white/30 mt-0.5">{devices.length} device{devices.length !== 1 ? "s" : ""} registered to your account.</p>
        </div>
        <span className="text-[10px] bg-white/[0.06] text-white/40 px-2 py-1 rounded-full font-medium whitespace-nowrap">Coming Soon</span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-3">
        {devices.map((device) => (
          <div
            key={device.device_id}
            className={`flex items-center gap-4 px-4 py-4 rounded-xl border transition-all ${
              device.is_current_device
                ? "bg-dl-accent/5 border-dl-accent/20"
                : "bg-white/[0.02] border-white/[0.06] hover:border-white/10"
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-white/[0.05] flex items-center justify-center text-white/50 shrink-0">
              {platformIcon(device.platform.toLowerCase())}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white/80 truncate">{device.device_name}</span>
                {device.is_current_device && (
                  <span className="text-[9px] bg-dl-accent/20 text-dl-accent px-2 py-0.5 rounded-full font-semibold tracking-wide">THIS DEVICE</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-white/30 capitalize">{device.platform}</span>
                <span className="text-white/10">·</span>
                <span className="text-xs text-white/30">Enrolled {new Date(device.enrolled_at).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <code className="text-[10px] font-mono text-white/20">{device.fingerprint.slice(0, 24)}…</code>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {device.is_current_device ? (
                <ShieldCheck size={16} className="text-dl-success" />
              ) : (
                <ShieldAlert size={16} className="text-white/20" />
              )}
              {!device.is_current_device && (
                <button
                  onClick={() => handleRemove(device)}
                  disabled={removing === device.device_id}
                  className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Remove device"
                >
                  {removing === device.device_id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          </div>
        ))}

        {devices.length === 0 && (
          <div className="text-center py-8 text-white/30 text-sm">No devices enrolled.</div>
        )}
      </div>
    </div>
  );
}
