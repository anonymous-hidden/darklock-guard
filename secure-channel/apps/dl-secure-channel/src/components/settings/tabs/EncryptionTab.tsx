/**
 * EncryptionTab — fingerprints, key rotation, security policies.
 */
import { useState } from "react";
import { Key, RotateCcw, Copy, Check, AlertTriangle, Loader2 } from "lucide-react";
import { rotateDeviceKey, setSetting } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";

function FingerprintCard({ label, value, color = "green" }: { label: string; value: string; color?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="rounded-xl bg-black/20 border border-white/[0.05] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={13} className="text-dl-accent" />
          <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">{label}</span>
        </div>
        <button onClick={copy} className="text-white/20 hover:text-white/60 transition-colors">
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>
      </div>
      <code className={`block font-mono text-xs leading-relaxed break-all select-all ${color === "green" ? "text-green-400" : "text-blue-400"}`}>
        {value || "—"}
      </code>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/[0.05] last:border-0">
      <div className="flex-1 mr-6">
        <p className="text-sm text-white/75">{label}</p>
        {description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}
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

export default function EncryptionTab() {
  const { profile, strictKeyChangePolicy, highSecurityMode, setStrictKeyChangePolicy, setHighSecurityMode } = useSettingsStore();
  const [rotating, setRotating] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotateSuccess, setRotateSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRotate = async () => {
    if (!rotateConfirm) { setRotateConfirm(true); return; }
    setRotating(true); setError(null);
    try {
      await rotateDeviceKey();
      setRotateSuccess(true);
      setRotateConfirm(false);
      setTimeout(() => setRotateSuccess(false), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setRotating(false);
    }
  };

  const deviceFp = profile?.devices.find((d) => d.is_current_device)?.fingerprint ?? "";

  return (
    <div className="space-y-5">
      {/* Keys */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Key Material</h3>
        <FingerprintCard label="Identity Key Fingerprint" value={profile?.fingerprint ?? ""} color="green" />
        <FingerprintCard label="Device Key Fingerprint" value={deviceFp} color="blue" />
        <p className="text-[11px] text-white/25 leading-relaxed">
          These fingerprints are BLAKE3 hashes of your Ed25519 public keys. They are safe to share for identity verification but never expose your private keys.
        </p>
      </div>

      {/* Rotate Device Key */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Key Rotation</h3>
        {rotateConfirm && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <strong>Warning:</strong> Rotating your device key will update your prekey bundle. Existing sessions will be unaffected, but all contacts will see a new device fingerprint and will need to re-verify you. Click again to confirm.
            </p>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {rotateSuccess && <p className="text-xs text-green-400 flex items-center gap-1.5"><Check size={12} />Device key rotated successfully.</p>}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/75">Rotate Device Key</p>
            <p className="text-xs text-white/30 mt-0.5">Generates a new X3DH prekey bundle and uploads to identity server.</p>
          </div>
          <button
            onClick={handleRotate}
            disabled={rotating}
            className={`flex items-center gap-2 text-sm px-4 py-1.5 rounded-lg transition-all ${
              rotateConfirm
                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                : "dl-btn-ghost"
            }`}
          >
            {rotating ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            {rotateConfirm ? "Confirm Rotate" : "Rotate Key"}
          </button>
        </div>
      </div>

      {/* Security Policies */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-5 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 pt-3 pb-1">Security Policies</h3>
        <Toggle
          label="Strict Key-Change Policy"
          description="Block all messaging when a contact's identity key changes until manually re-verified"
          checked={strictKeyChangePolicy}
          onChange={(v) => {
            setStrictKeyChangePolicy(v);
            setSetting("verification_policy", v ? "block" : "warn").catch(() => {});
          }}
        />
        <Toggle
          label="High-Security Mode"
          description="Enables stricter encryption requirements, enforces OPK usage, higher memory for Argon2id"
          checked={highSecurityMode}
          onChange={(v) => {
            setHighSecurityMode(v);
            setSetting("high_security_mode", String(v)).catch(() => {});
          }}
        />
      </div>
    </div>
  );
}
