/**
 * SecurityTab — password change, key fingerprint, sessions.
 */
import { useState } from "react";
import { Key, Eye, EyeOff, Copy, Check, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { changePassword } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">{title}</h3>
      {children}
    </div>
  );
}

export default function SecurityTab() {
  const { profile } = useSettingsStore();
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confPwd, setConfPwd] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [fpCopied, setFpCopied] = useState(false);

  const handleChangePwd = async () => {
    if (newPwd !== confPwd) { setPwdError("Passwords do not match."); return; }
    if (newPwd.length < 12) { setPwdError("Password must be at least 12 characters."); return; }
    setSaving(true); setPwdError(null);
    try {
      await changePassword(curPwd, newPwd);
      setCurPwd(""); setNewPwd(""); setConfPwd("");
      setPwdSuccess(true);
      setTimeout(() => setPwdSuccess(false), 3000);
    } catch (e) {
      setPwdError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const copyFp = () => {
    if (profile?.fingerprint) {
      navigator.clipboard.writeText(profile.fingerprint);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 1800);
    }
  };

  const PwdInput = ({ value, onChange, show, onToggle, placeholder }: any) => (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="dl-input pr-10 text-sm w-full"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Change Password */}
      <SectionCard title="Change Password">
        <div className="space-y-3">
          <PwdInput value={curPwd} onChange={setCurPwd} show={showCur} onToggle={() => setShowCur(!showCur)} placeholder="Current password" />
          <PwdInput value={newPwd} onChange={setNewPwd} show={showNew} onToggle={() => setShowNew(!showNew)} placeholder="New password (min 12 chars)" />
          <PwdInput value={confPwd} onChange={setConfPwd} show={showNew} onToggle={() => setShowNew(!showNew)} placeholder="Confirm new password" />

          {pwdError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} />{pwdError}</p>}
          {pwdSuccess && <p className="text-xs text-green-400 flex items-center gap-1.5"><Check size={12} />Password updated successfully.</p>}

          <button
            onClick={handleChangePwd}
            disabled={saving || !curPwd || !newPwd || !confPwd}
            className="dl-btn-primary text-sm px-4 py-2"
          >
            {saving ? <><Loader2 size={13} className="animate-spin" />Saving…</> : "Update Password"}
          </button>
        </div>
      </SectionCard>

      {/* Key Fingerprint */}
      <SectionCard title="Identity Key Fingerprint">
        <p className="text-xs text-white/40">
          Share this fingerprint with your contacts through a separate secure channel to verify your identity.
        </p>
        <div className="flex items-center gap-3 bg-black/30 rounded-lg px-4 py-3 border border-white/[0.05]">
          <Key size={14} className="text-dl-accent shrink-0" />
          <code className="flex-1 font-mono text-xs text-green-400 tracking-wider break-all">
            {profile?.fingerprint ?? "—"}
          </code>
          <button onClick={copyFp} className="text-white/20 hover:text-white/60 transition-colors shrink-0 ml-2">
            {fpCopied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <ShieldCheck size={12} className="text-dl-accent" />
          Fingerprint is a BLAKE3 hash of your Ed25519 identity public key.
        </div>
      </SectionCard>

      {/* Two-Factor Authentication */}
      <SectionCard title="Two-Factor Authentication">
        <p className="text-xs text-white/40">
          Protect your account with TOTP-based two-factor authentication using an authenticator app like Authy, Google Authenticator, or 1Password.
        </p>
        <div className="flex items-center justify-between bg-white/[0.02] rounded-lg px-4 py-3 border border-white/[0.05]">
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-white/20" />
            <div>
              <p className="text-sm text-white/50">TOTP Authenticator</p>
              <p className="text-[10px] text-white/20">Not yet enabled</p>
            </div>
          </div>
          <button
            disabled
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-white/25 border border-white/[0.06] cursor-not-allowed"
            title="2FA setup requires server-side TOTP support — coming in a future update"
          >
            Enable
          </button>
        </div>
        <p className="text-[10px] text-white/15 italic">
          TOTP enrollment will be available once the identity server supports TOTP secret generation and verification.
        </p>
      </SectionCard>

      {/* Backup Codes */}
      <SectionCard title="Backup Codes">
        <p className="text-xs text-white/40">
          Backup codes let you recover access if you lose your authenticator. Each code can only be used once.
        </p>
        <div className="flex items-center justify-between bg-white/[0.02] rounded-lg px-4 py-3 border border-white/[0.05]">
          <div className="flex items-center gap-3">
            <Key size={16} className="text-white/20" />
            <div>
              <p className="text-sm text-white/50">Recovery Codes</p>
              <p className="text-[10px] text-white/20">Requires 2FA to be enabled first</p>
            </div>
          </div>
          <button
            disabled
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-white/25 border border-white/[0.06] cursor-not-allowed"
            title="Enable 2FA first to generate backup codes"
          >
            Generate
          </button>
        </div>
      </SectionCard>

      {/* Active Sessions */}
      <SectionCard title="Active Sessions">
        <p className="text-xs text-white/40">
          Review and revoke login sessions across your devices.
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-dl-accent/5 rounded-lg px-4 py-3 border border-dl-accent/20">
            <div className="flex items-center gap-3">
              <ShieldCheck size={16} className="text-dl-accent" />
              <div>
                <p className="text-sm text-white/60">Current Session</p>
                <p className="text-[10px] text-white/25">This device · Active now</p>
              </div>
            </div>
            <span className="text-[9px] bg-dl-accent/20 text-dl-accent px-2 py-0.5 rounded-full font-semibold">CURRENT</span>
          </div>
        </div>
        <button
          disabled
          className="mt-2 text-xs text-red-400/40 hover:text-red-400/60 cursor-not-allowed"
          title="Session management requires server-side support"
        >
          Revoke all other sessions
        </button>
      </SectionCard>
    </div>
  );
}
