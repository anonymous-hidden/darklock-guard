/**
 * SecurityTab — privacy toggles, clipboard, retention, key management,
 * change password, identity fingerprint, 2FA, sessions.
 */
import { useState } from "react";
import {
  Key, Eye, EyeOff, Copy, Check, ShieldCheck, AlertTriangle,
  Loader2, RefreshCw, Bell, Ban,
  Keyboard, Clipboard, Clock, RotateCcw,
} from "lucide-react";
import { changePassword, regenerateKeys, setSetting } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";

/* ── Shared sub-components ──────────────────────────────────────────────── */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">{title}</h3>
      {children}
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-3 flex-1 mr-4">
        {Icon && <Icon size={14} className="text-white/25 shrink-0 mt-0.5" />}
        <div>
          <p className="text-sm text-white/70">{label}</p>
          {description && <p className="text-[11px] text-white/25 mt-0.5 leading-relaxed">{description}</p>}
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 shrink-0 ${
          checked ? "bg-dl-accent" : "bg-white/10"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-[20px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </div>
  );
}

function SelectRow({
  icon: Icon,
  label,
  description,
  value,
  options,
  onChange,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description?: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-white/[0.05] last:border-0 gap-4">
      <div className="flex items-start gap-3 flex-1">
        {Icon && <Icon size={14} className="text-white/25 shrink-0 mt-1" />}
        <div>
          <p className="text-sm text-white/70">{label}</p>
          {description && <p className="text-[11px] text-white/25 mt-0.5 leading-relaxed">{description}</p>}
        </div>
      </div>
      <select
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        className="bg-white/[0.05] border border-white/[0.08] text-white/60 text-xs rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-white/[0.08] transition-colors shrink-0"
      >
        {options.map(o => (
          <option key={o.value} value={String(o.value)} className="bg-[#1a1a1a]">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PwdInput({ value, onChange, show, onToggle, placeholder }: {
  value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void; placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="dl-input pr-10 text-sm w-full"
        autoComplete="off"
      />
      <button type="button" onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/* ── Option constants ───────────────────────────────────────────────────── */

const KEY_ROTATION_OPTIONS = [
  { value: "14",  label: "Every 2 weeks" },
  { value: "30",  label: "Every month" },
  { value: "60",  label: "Every 2 months" },
  { value: "90",  label: "Every 3 months" },
  { value: "0",   label: "Manual only" },
];

const RETENTION_OPTIONS = [
  { value: "0",   label: "Forever" },
  { value: "7",   label: "7 days" },
  { value: "30",  label: "30 days" },
  { value: "90",  label: "90 days" },
  { value: "365", label: "1 year" },
];

/* ── Component ──────────────────────────────────────────────────────────── */
export default function SecurityTab() {
  const {
    profile,
    privacy, updatePrivacy,
    hideInTaskbar, setHideInTaskbar,
    incognitoKeyboard, setIncognitoKeyboard,
    keyRotationDays, setKeyRotationDays,
    loginAlerts, setLoginAlerts,
    blockUnknownContacts, setBlockUnknownContacts,
  } = useSettingsStore();

  /* Password change */
  const [curPwd, setCurPwd]         = useState("");
  const [newPwd, setNewPwd]         = useState("");
  const [confPwd, setConfPwd]       = useState("");
  const [showCur, setShowCur]       = useState(false);
  const [showNew, setShowNew]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [pwdError, setPwdError]     = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  /* Fingerprint */
  const [fpCopied, setFpCopied] = useState(false);

  /* Key regen */
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenDone, setRegenDone]       = useState(false);
  const [regenError, setRegenError]     = useState<string | null>(null);

  /* ── Helpers ──────────────────────────────────────────────────────── */
  const save = (k: string, v: string) => setSetting(k, v).catch(() => {});

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
      navigator.clipboard.writeText(profile.fingerprint).catch(() => {});
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 1800);
    }
  };

  const handleRegen = async () => {
    setRegenLoading(true); setRegenError(null);
    try {
      await regenerateKeys();
      setRegenDone(true); setRegenConfirm(false);
      setTimeout(() => setRegenDone(false), 4000);
    } catch (e) {
      setRegenError(String(e));
    } finally {
      setRegenLoading(false);
    }
  };

  const applyTaskbarHide = (v: boolean) => {
    setHideInTaskbar(v);
    save("hide_in_taskbar", String(v));
    try { (window as any).electronAPI?.winSetSkipTaskbar?.(v); } catch { /* web */ }
  };

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* PRIVACY */}
      <SectionCard title="Privacy">
        <ToggleRow
          icon={EyeOff}
          label="Hide in Taskbar"
          description="Remove the app from the system taskbar and app switcher"
          checked={hideInTaskbar}
          onChange={applyTaskbarHide}
        />
        <ToggleRow
          icon={EyeOff}
          label="Hide Message Previews"
          description="Prevent message content from appearing in the task manager / system overview"
          checked={privacy.screenshotProtection}
          onChange={v => { updatePrivacy({ screenshotProtection: v }); save("screenshot_protection", String(v)); }}
        />
        <ToggleRow
          icon={Keyboard}
          label="Incognito Keyboard"
          description="Prevent the keyboard from learning your input (autocomplete disabled)"
          checked={incognitoKeyboard}
          onChange={v => { setIncognitoKeyboard(v); save("incognito_keyboard", String(v)); }}
        />
      </SectionCard>

      {/* CLIPBOARD & DATA */}
      <SectionCard title="Clipboard & Data">
        <ToggleRow
          icon={Clipboard}
          label="Auto-Clear Clipboard"
          description="Automatically clear clipboard 60 seconds after copying sensitive data"
          checked={privacy.clipboardProtection}
          onChange={v => { updatePrivacy({ clipboardProtection: v }); save("clipboard_protection", String(v)); }}
        />
        <SelectRow
          icon={Clock}
          label="Message Retention"
          description="Automatically delete messages after a period"
          value={String(privacy.messageRetentionDays)}
          options={RETENTION_OPTIONS}
          onChange={v => { updatePrivacy({ messageRetentionDays: Number(v) }); save("message_retention_days", v); }}
        />
      </SectionCard>

      {/* KEY MANAGEMENT */}
      <SectionCard title="Key Management">
        <SelectRow
          icon={RotateCcw}
          label="Key Rotation Interval"
          description="How often to rotate encryption keys"
          value={String(keyRotationDays)}
          options={KEY_ROTATION_OPTIONS}
          onChange={v => { setKeyRotationDays(Number(v)); save("key_rotation_days", v); }}
        />
        <ToggleRow
          icon={Bell}
          label="Login Alerts"
          description="Get notified when your vault is unlocked on a new device"
          checked={loginAlerts}
          onChange={v => { setLoginAlerts(v); save("login_alerts", String(v)); }}
        />
        <ToggleRow
          icon={Ban}
          label="Block Unknown Contacts"
          description="Only allow messages from verified contacts"
          checked={blockUnknownContacts}
          onChange={v => { setBlockUnknownContacts(v); save("block_unknown_contacts", String(v)); }}
        />

        {/* Regenerate E2EE Keys */}
        <div className="pt-1">
          {regenDone && (
            <p className="text-xs text-green-400 flex items-center gap-1.5 mb-2">
              <Check size={12} /> E2EE keys regenerated. New sessions will be negotiated automatically.
            </p>
          )}
          {regenError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5 mb-2">
              <AlertTriangle size={12} /> {regenError}
            </p>
          )}
          {!regenConfirm ? (
            <button
              onClick={() => setRegenConfirm(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/[0.04] text-white/50 border border-white/[0.08] hover:bg-white/[0.07] hover:text-white/70 transition-all"
            >
              <RefreshCw size={13} /> Regenerate E2EE Keys
            </button>
          ) : (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  This will clear all existing E2EE sessions on this device. Use only if E2EE is unavailable after a data loss. New sessions will be negotiated automatically.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegen}
                  disabled={regenLoading}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all"
                >
                  {regenLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {regenLoading ? "Regenerating…" : "Confirm Regenerate"}
                </button>
                <button
                  onClick={() => { setRegenConfirm(false); setRegenError(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg text-white/30 hover:text-white/50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* CHANGE PASSWORD */}
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
            {saving ? <><Loader2 size={13} className="animate-spin mr-1.5" />Saving…</> : "Update Password"}
          </button>
        </div>
      </SectionCard>

      {/* IDENTITY KEY FINGERPRINT */}
      <SectionCard title="Identity Key Fingerprint">
        <p className="text-xs text-white/40">
          Share this fingerprint through a separate secure channel to verify your identity with contacts.
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

      {/* TWO-FACTOR AUTHENTICATION */}
      <SectionCard title="Two-Factor Authentication">
        <p className="text-xs text-white/40">
          Protect your account with TOTP-based 2FA using an authenticator app like Authy or 1Password.
        </p>
        <div className="flex items-center justify-between bg-white/[0.02] rounded-lg px-4 py-3 border border-white/[0.05]">
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-white/20" />
            <div>
              <p className="text-sm text-white/50">TOTP Authenticator</p>
              <p className="text-[10px] text-white/20">Not yet enabled</p>
            </div>
          </div>
          <button disabled
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-white/25 border border-white/[0.06] cursor-not-allowed"
            title="Coming in a future update">
            Enable
          </button>
        </div>
        <p className="text-[10px] text-white/15 italic">
          TOTP enrollment will be available once the identity server supports TOTP secret generation.
        </p>
      </SectionCard>

      {/* ACTIVE SESSIONS */}
      <SectionCard title="Active Sessions">
        <p className="text-xs text-white/40">Review and revoke login sessions across your devices.</p>
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
        <button disabled
          className="mt-1 text-xs text-red-400/40 cursor-not-allowed"
          title="Session management requires server-side support">
          Revoke all other sessions
        </button>
      </SectionCard>

    </div>
  );
}
