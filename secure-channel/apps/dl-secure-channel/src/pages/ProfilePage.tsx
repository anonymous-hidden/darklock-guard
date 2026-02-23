/**
 * ProfilePage — PFP, username, fingerprint, device list, verification QR,
 * export public key, rotate device key buttons.
 */
import { useEffect, useState } from "react";
import {
  User,
  Fingerprint,
  Copy,
  Smartphone,
  RotateCw,
  AlertTriangle,
  Key,
  Download,
  Shield,
  Loader2,
} from "lucide-react";
import { getProfile, rotateDeviceKey } from "@/lib/tauri";
import type { ProfileDto, DeviceDto } from "@/types";
import { useAuthStore } from "@/store/authStore";
import RoleTag from "@/components/RoleTag";

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { systemRole } = useAuthStore();
  const effectiveRole = profile?.system_role ?? systemRole;

  useEffect(() => {
    getProfile().then(setProfile).catch((e) => setError(String(e)));
  }, []);

  const copyFingerprint = () => {
    if (!profile) return;
    navigator.clipboard.writeText(profile.fingerprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportPublicKey = () => {
    if (!profile) return;
    const blob = new Blob(
      [JSON.stringify({ user_id: profile.user_id, identity_pubkey: profile.identity_pubkey }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `darklock-pubkey-${profile.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-dl-danger text-sm">{error}</p>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-dl-accent" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-dl-accent/20 flex items-center justify-center">
            <User className="w-8 h-8 text-dl-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{profile.username}</h1>
            {effectiveRole && <RoleTag role={effectiveRole} className="mt-1 mb-0.5" />}
            <p className="text-sm text-dl-text-dim">{profile.email}</p>
            <p className="text-xs text-dl-muted mt-0.5">
              User ID: {profile.user_id}
            </p>
          </div>
        </div>

        {/* Identity fingerprint */}
        <div className="dl-card space-y-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-dl-accent" />
            <h2 className="font-medium">Identity Fingerprint</h2>
          </div>
          <p className="text-xs text-dl-text-dim">
            Share this fingerprint out-of-band to verify your identity with contacts.
          </p>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-dl-elevated font-mono text-sm tracking-wider">
            <code className="flex-1 select-all">{profile.fingerprint}</code>
            <button onClick={copyFingerprint} className="dl-btn-ghost p-1.5 rounded-md">
              <Copy size={14} />
            </button>
          </div>
          {copied && <p className="text-xs text-dl-success">Copied to clipboard</p>}

          {/* Verification QR placeholder */}
          <div className="text-center p-6 rounded-lg border border-dashed border-dl-border">
            <Shield className="w-10 h-10 text-dl-muted mx-auto mb-2" />
            <p className="text-xs text-dl-muted">QR verification — coming in v2</p>
          </div>

          <div className="flex gap-2">
            <button onClick={exportPublicKey} className="dl-btn-ghost text-xs">
              <Download size={13} />
              Export Public Key
            </button>
          </div>
        </div>

        {/* Devices */}
        <div className="dl-card space-y-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-dl-accent" />
            <h2 className="font-medium">Devices</h2>
          </div>
          <div className="space-y-2">
            {profile.devices.map((device) => (
              <DeviceRow key={device.device_id} device={device} />
            ))}
          </div>
          <button
            onClick={() => rotateDeviceKey().catch(console.error)}
            className="dl-btn-ghost text-xs"
          >
            <RotateCw size={13} />
            Rotate Device Key
            <AlertTriangle size={11} className="text-dl-warning ml-1" />
          </button>
          <p className="text-[10px] text-dl-muted">
            Warning: Rotating your device key will require contacts to re-verify this device.
          </p>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device }: { device: DeviceDto }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-dl-elevated">
      <Smartphone size={16} className={device.is_current_device ? "text-dl-accent" : "text-dl-muted"} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-2">
          {device.device_name}
          {device.is_current_device && (
            <span className="dl-badge bg-dl-accent/10 text-dl-accent text-[10px]">This device</span>
          )}
        </div>
        <div className="text-xs text-dl-muted">
          {device.platform} · Enrolled {device.enrolled_at}
        </div>
        <div className="text-xs text-dl-text-dim font-mono mt-0.5">{device.fingerprint}</div>
      </div>
      <Key size={14} className="text-dl-muted" />
    </div>
  );
}
