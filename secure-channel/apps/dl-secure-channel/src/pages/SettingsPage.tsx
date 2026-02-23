/**
 * SettingsPage — Privacy toggles, verification policy, message retention,
 * local vault lock timeout.
 */
import React, { useEffect, useState } from "react";
import {
  Shield,
  Clock,
  Eye,
  Clipboard,
  Lock,
  Loader2,
  History,
  ShieldCheck,
} from "lucide-react";
import { getSettings, setSetting } from "@/lib/tauri";

interface SettingRow {
  key: string;
  label: string;
  description: string;
  type: "toggle" | "select" | "number";
  options?: { value: string; label: string }[];
  icon: React.ReactNode;
}

const SETTING_DEFS: SettingRow[] = [
  {
    key: "padding_enabled",
    label: "Message Padding",
    description: "Pad messages to uniform length to hide content size — reduces metadata leakage.",
    type: "toggle",
    icon: <Shield size={16} />,
  },
  {
    key: "high_security_mode",
    label: "High-Security Mode",
    description: "Require password re-entry after lock. Disable clipboard export and history export.",
    type: "toggle",
    icon: <Lock size={16} />,
  },
  {
    key: "clipboard_export_block",
    label: "Block Clipboard Export",
    description: "Prevent copying message content to system clipboard.",
    type: "toggle",
    icon: <Clipboard size={16} />,
  },
  {
    key: "verification_policy",
    label: "Verification Policy",
    description: "How to handle unverified contacts: warn (allow with warning) or block (require explicit verification).",
    type: "select",
    options: [
      { value: "warn", label: "Warn" },
      { value: "block", label: "Block" },
    ],
    icon: <ShieldCheck size={16} />,
  },
  {
    key: "message_retention_days",
    label: "Message Retention (days)",
    description: "Auto-delete local messages older than this many days. 0 = keep forever.",
    type: "number",
    icon: <History size={16} />,
  },
  {
    key: "vault_lock_timeout_min",
    label: "Vault Auto-Lock (minutes)",
    description: "Lock vault and clear keys after this many minutes of inactivity. 0 = never auto-lock.",
    type: "number",
    icon: <Clock size={16} />,
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (key: string, value: string) => {
    setSaving(key);
    try {
      await setSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error("Failed to update setting:", err);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-dl-accent" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Eye className="w-5 h-5 text-dl-accent" />
            Privacy & Security Settings
          </h1>
          <p className="text-sm text-dl-text-dim mt-1">
            Configure how the Secure Channel protects your data.
          </p>
        </div>

        <div className="space-y-3">
          {SETTING_DEFS.map((def) => (
            <SettingControl
              key={def.key}
              def={def}
              value={settings[def.key] ?? ""}
              onChange={(v) => handleChange(def.key, v)}
              saving={saving === def.key}
            />
          ))}
        </div>

        <div className="dl-card text-xs text-dl-muted space-y-1">
          <p><strong>Note:</strong> Settings are stored in the encrypted local vault.</p>
          <p>Changes apply immediately. Some settings require app restart.</p>
        </div>
      </div>
    </div>
  );
}

function SettingControl({
  def,
  value,
  onChange,
  saving,
}: {
  def: SettingRow;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
}) {
  return (
    <div className="dl-card flex items-start gap-4">
      <div className="mt-0.5 text-dl-accent">{def.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{def.label}</h3>
          {saving && <Loader2 size={12} className="animate-spin text-dl-accent" />}
        </div>
        <p className="text-xs text-dl-text-dim mt-0.5">{def.description}</p>
      </div>

      <div className="mt-0.5">
        {def.type === "toggle" && (
          <button
            onClick={() => onChange(value === "true" ? "false" : "true")}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              value === "true" ? "bg-dl-accent" : "bg-dl-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                value === "true" ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        )}

        {def.type === "select" && def.options && (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="dl-input w-auto text-xs py-1"
          >
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {def.type === "number" && (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => onChange(e.target.value)}
            className="dl-input w-20 text-sm py-1 text-center"
            min={0}
          />
        )}
      </div>
    </div>
  );
}
