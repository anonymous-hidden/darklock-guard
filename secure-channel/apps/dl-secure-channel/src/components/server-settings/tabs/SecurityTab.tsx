/**
 * SecurityTab — AutoMod rule management + Advanced Security panel for server settings.
 * CRUD for AutoMod rules + event log viewer + encryption modes, raid protection,
 * join verification, lockdown controls.
 */
import { useEffect, useState } from "react";
import {
  Shield,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  MessageSquare,
  Link,
  AtSign,
  Users,
  Image,
  ChevronDown,
  Lock,
  Fingerprint,
  Radar,
  ShieldCheck,
  ShieldAlert,
  Zap,
} from "lucide-react";

import { useServerStore } from "@/store/serverStore";
import type { AutoModRuleDto, AutoModRuleType, AutoModAction, AutoModEventDto } from "@/types";
import type { EncryptionMode, RaidProtectionLevel, JoinVerificationLevel } from "@/types";

const RULE_TYPE_LABELS: Record<AutoModRuleType, { label: string; icon: typeof Shield; desc: string }> = {
  word_filter: { label: "Word Filter", icon: MessageSquare, desc: "Block messages containing specific words" },
  spam: { label: "Anti-Spam", icon: AlertTriangle, desc: "Detect and block spam messages" },
  mention: { label: "Mention Limit", icon: AtSign, desc: "Limit how many mentions per message" },
  link: { label: "Link Filter", icon: Link, desc: "Block messages containing links" },
  media: { label: "Media Filter", icon: Image, desc: "Control media/image attachments" },
  anti_raid: { label: "Anti-Raid", icon: Users, desc: "Protect against mass join raids" },
};

const ACTION_LABELS: Record<AutoModAction, string> = {
  nothing: "Log Only",
  warn: "Warn User",
  delete: "Delete Message",
  timeout: "Timeout User",
  kick: "Kick User",
  ban: "Ban User",
};

export default function SecurityTab({ serverId }: { serverId: string }) {
  const fetchAutoModRules = useServerStore((s) => s.fetchAutoModRules);
  const createAutoModRule = useServerStore((s) => s.createAutoModRule);
  const updateAutoModRule = useServerStore((s) => s.updateAutoModRule);
  const deleteAutoModRule = useServerStore((s) => s.deleteAutoModRule);
  const fetchAutoModEvents = useServerStore((s) => s.fetchAutoModEvents);
  const rules = useServerStore((s) => s.automodRules[serverId] ?? []);
  const events = useServerStore((s) => s.automodEvents[serverId] ?? []);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AutoModRuleType>("word_filter");
  const [newAction, setNewAction] = useState<AutoModAction>("delete");
  const [newConfig, setNewConfig] = useState("{}");
  const [creating, setCreating] = useState(false);
  const [viewTab, setViewTab] = useState<"security" | "rules" | "events">("security");

  // ── Advanced security state ──
  const [encryptionMode, setEncryptionMode] = useState<EncryptionMode>("standard");
  const [raidProtection, setRaidProtection] = useState<RaidProtectionLevel>("medium");
  const [joinVerification, setJoinVerification] = useState<JoinVerificationLevel>("email");
  const [lockdownActive, setLockdownActive] = useState(false);
  const [deviceAnomalyDetection, setDeviceAnomalyDetection] = useState(true);
  const [messageScanning, setMessageScanning] = useState(true);

  useEffect(() => {
    fetchAutoModRules(serverId).catch(console.error);
    fetchAutoModEvents(serverId).catch(console.error);
  }, [serverId, fetchAutoModRules, fetchAutoModEvents]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(newConfig); } catch { /* use empty */ }
      await createAutoModRule(serverId, newName, newType, newAction, config);
      setNewName("");
      setNewConfig("{}");
      setShowCreate(false);
    } catch (e) {
      console.error("Create rule failed:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (rule: AutoModRuleDto) => {
    try {
      await updateAutoModRule(serverId, rule.id, { enabled: !rule.enabled });
    } catch (e) {
      console.error("Toggle rule failed:", e);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await deleteAutoModRule(serverId, ruleId);
    } catch (e) {
      console.error("Delete rule failed:", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with shield icon */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Shield size={20} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/90">AutoMod</h3>
            <p className="text-xs text-white/40">Automated moderation rules to protect your server</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] rounded-lg p-1">
        <button
          onClick={() => setViewTab("security")}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "security" ? "bg-white/[0.08] text-white/80" : "text-white/30 hover:text-white/50"
          }`}
        >
          Security
        </button>
        <button
          onClick={() => setViewTab("rules")}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "rules" ? "bg-white/[0.08] text-white/80" : "text-white/30 hover:text-white/50"
          }`}
        >
          AutoMod ({rules.length})
        </button>
        <button
          onClick={() => setViewTab("events")}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "events" ? "bg-white/[0.08] text-white/80" : "text-white/30 hover:text-white/50"
          }`}
        >
          Events ({events.length})
        </button>
      </div>

      {viewTab === "security" ? (
        <SecurityOverview
          encryptionMode={encryptionMode}
          setEncryptionMode={setEncryptionMode}
          raidProtection={raidProtection}
          setRaidProtection={setRaidProtection}
          joinVerification={joinVerification}
          setJoinVerification={setJoinVerification}
          lockdownActive={lockdownActive}
          setLockdownActive={setLockdownActive}
          deviceAnomalyDetection={deviceAnomalyDetection}
          setDeviceAnomalyDetection={setDeviceAnomalyDetection}
          messageScanning={messageScanning}
          setMessageScanning={setMessageScanning}
        />
      ) : viewTab === "rules" ? (
        <>
          {/* Create button */}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] text-white/60 hover:text-white/80 text-sm transition-colors w-full"
          >
            <Plus size={14} />
            Create Rule
            <ChevronDown
              size={12}
              className={`ml-auto transition-transform ${showCreate ? "rotate-180" : ""}`}
            />
          </button>

          {/* Create form */}
          {showCreate && (
            <div className="bg-white/[0.03] rounded-xl p-4 space-y-3 border border-white/[0.06]">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                  Rule Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Block Slurs"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-dl-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                  Rule Type
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.entries(RULE_TYPE_LABELS) as [AutoModRuleType, typeof RULE_TYPE_LABELS[AutoModRuleType]][]).map(
                    ([key, { label, icon: Icon }]) => (
                      <button
                        key={key}
                        onClick={() => setNewType(key)}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                          newType === key
                            ? "bg-dl-accent/20 text-dl-accent border border-dl-accent/30"
                            : "bg-white/[0.04] text-white/40 hover:bg-white/[0.06] border border-transparent"
                        }`}
                      >
                        <Icon size={12} />
                        {label}
                      </button>
                    )
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                  Action
                </label>
                <select
                  value={newAction}
                  onChange={(e) => setNewAction(e.target.value as AutoModAction)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none"
                >
                  {(Object.entries(ACTION_LABELS) as [AutoModAction, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                  Config (JSON)
                </label>
                <textarea
                  value={newConfig}
                  onChange={(e) => setNewConfig(e.target.value)}
                  placeholder='{"words": ["bad", "word"]}'
                  rows={2}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono focus:outline-none focus:border-dl-accent/40"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 rounded-lg bg-dl-accent/90 hover:bg-dl-accent text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Rule"}
              </button>
            </div>
          )}

          {/* Rules list */}
          <div className="space-y-2">
            {rules.map((rule) => {
              const typeInfo = RULE_TYPE_LABELS[rule.rule_type as AutoModRuleType] ?? {
                label: rule.rule_type,
                icon: Shield,
                desc: "",
              };
              const Icon = typeInfo.icon;

              return (
                <div
                  key={rule.id}
                  className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] hover:border-white/[0.08] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={16} className={rule.enabled ? "text-dl-accent" : "text-white/20"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/80">{rule.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            rule.enabled
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/[0.06] text-white/30"
                          }`}>
                            {rule.enabled ? "Active" : "Disabled"}
                          </span>
                        </div>
                        <p className="text-xs text-white/30 mt-0.5">{typeInfo.desc}</p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-white/25">
                          <span>Action: {ACTION_LABELS[rule.action as AutoModAction] ?? rule.action}</span>
                          <span>Type: {typeInfo.label}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggle(rule)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                        title={rule.enabled ? "Disable" : "Enable"}
                      >
                        {rule.enabled ? <ToggleRight size={18} className="text-green-400" /> : <ToggleLeft size={18} />}
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
                        title="Delete Rule"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {rules.length === 0 && !showCreate && (
              <div className="flex flex-col items-center py-8 text-white/20">
                <Shield size={32} className="mb-3" />
                <p className="text-sm font-medium text-white/30">No AutoMod rules yet</p>
                <p className="text-xs mt-1">Create rules to automatically moderate your server.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Events tab */
        <div className="space-y-2">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {events.length === 0 && (
            <div className="flex flex-col items-center py-8 text-white/20">
              <AlertTriangle size={32} className="mb-3" />
              <p className="text-sm font-medium text-white/30">No events recorded</p>
              <p className="text-xs mt-1">AutoMod events will appear here when rules are triggered.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: AutoModEventDto }) {
  return (
    <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={12} className="text-amber-400" />
          <span className="text-xs font-medium text-white/60">
            {event.rule_name ?? "Unknown Rule"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/30">
            {event.action_taken}
          </span>
        </div>
        <span className="text-[10px] text-white/20">
          {formatEventDate(event.created_at)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-white/30">
        <span>User: {event.username ?? event.user_id.slice(0, 8)}</span>
        {event.content_snippet && (
          <span className="truncate max-w-[200px]">
            Content: "{event.content_snippet}"
          </span>
        )}
      </div>
    </div>
  );
}

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getMonth()]} ${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch {
    return iso;
  }
}

/* ── Security Overview Panel ───────────────────────────────────────────── */

interface SecurityOverviewProps {
  encryptionMode: EncryptionMode;
  setEncryptionMode: (v: EncryptionMode) => void;
  raidProtection: RaidProtectionLevel;
  setRaidProtection: (v: RaidProtectionLevel) => void;
  joinVerification: JoinVerificationLevel;
  setJoinVerification: (v: JoinVerificationLevel) => void;
  lockdownActive: boolean;
  setLockdownActive: (v: boolean) => void;
  deviceAnomalyDetection: boolean;
  setDeviceAnomalyDetection: (v: boolean) => void;
  messageScanning: boolean;
  setMessageScanning: (v: boolean) => void;
}

const ENCRYPTION_MODES: { value: EncryptionMode; label: string; desc: string; icon: typeof Lock }[] = [
  { value: "standard", label: "Standard", desc: "Server-side encryption at rest, E2E for DMs", icon: Lock },
  { value: "enforced_e2e", label: "Enforced E2E", desc: "Full end-to-end encryption for all channels", icon: ShieldCheck },
  { value: "hybrid", label: "Hybrid", desc: "E2E for private channels, standard for public", icon: ShieldAlert },
];

const RAID_LEVELS: { value: RaidProtectionLevel; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "No automatic raid protection" },
  { value: "low", label: "Low", desc: "Flag suspicious join patterns" },
  { value: "medium", label: "Medium", desc: "Auto-kick accounts < 24h old during raids" },
  { value: "high", label: "High", desc: "Lock invites + require CAPTCHA during raids" },
  { value: "lockdown", label: "Lockdown", desc: "Reject all new joins immediately" },
];

const JOIN_LEVELS: { value: JoinVerificationLevel; label: string; desc: string }[] = [
  { value: "none", label: "None", desc: "Anyone with an invite can join" },
  { value: "email", label: "Email Verified", desc: "Require verified email" },
  { value: "phone", label: "Phone Verified", desc: "Require phone verification" },
  { value: "2fa", label: "Two-Factor Auth", desc: "Account must have 2FA enabled" },
  { value: "manual_approval", label: "Admin Approval", desc: "Manual approval by admin" },
];

function SecurityOverview({
  encryptionMode, setEncryptionMode,
  raidProtection, setRaidProtection,
  joinVerification, setJoinVerification,
  lockdownActive, setLockdownActive,
  deviceAnomalyDetection, setDeviceAnomalyDetection,
  messageScanning, setMessageScanning,
}: SecurityOverviewProps) {
  return (
    <div className="space-y-5">
      {/* Lockdown Banner */}
      {lockdownActive && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <ShieldAlert size={24} className="text-red-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">Server Lockdown Active</p>
            <p className="text-xs text-red-400/60 mt-0.5">All new joins are blocked. Only admins can send messages.</p>
          </div>
          <button
            onClick={() => setLockdownActive(false)}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium transition-colors"
          >
            Disable
          </button>
        </div>
      )}

      {/* Encryption Mode */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Lock size={16} className="text-dl-accent" />
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Encryption Mode</h4>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {ENCRYPTION_MODES.map(({ value, label, desc, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setEncryptionMode(value)}
              className={`p-3 rounded-xl border text-left transition-all ${
                encryptionMode === value
                  ? "bg-dl-accent/10 border-dl-accent/30 shadow-[0_0_12px_rgba(var(--accent-rgb),0.1)]"
                  : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
              }`}
            >
              <Icon size={18} className={encryptionMode === value ? "text-dl-accent mb-2" : "text-white/30 mb-2"} />
              <p className="text-xs font-medium text-white/80">{label}</p>
              <p className="text-[10px] text-white/30 mt-0.5">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Raid Protection */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Radar size={16} className="text-amber-400" />
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Raid Protection</h4>
        </div>
        <div className="flex gap-1 bg-white/[0.03] rounded-lg p-1">
          {RAID_LEVELS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setRaidProtection(value)}
              className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-medium transition-colors ${
                raidProtection === value
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-white/30 hover:text-white/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-white/25 mt-1.5">
          {RAID_LEVELS.find((r) => r.value === raidProtection)?.desc}
        </p>
      </div>

      {/* Join Verification */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Fingerprint size={16} className="text-green-400" />
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Join Verification</h4>
        </div>
        <div className="space-y-1.5">
          {JOIN_LEVELS.map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => setJoinVerification(value)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                joinVerification === value
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                joinVerification === value ? "border-green-400 bg-green-400" : "border-white/20"
              }`} />
              <div>
                <p className="text-xs font-medium text-white/70">{label}</p>
                <p className="text-[10px] text-white/30">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Toggle options */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={16} className="text-purple-400" />
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Advanced</h4>
        </div>

        <SecurityToggle
          label="Device Anomaly Detection"
          desc="Flag logins from new devices or unusual locations"
          enabled={deviceAnomalyDetection}
          onToggle={() => setDeviceAnomalyDetection(!deviceAnomalyDetection)}
        />
        <SecurityToggle
          label="Message Content Scanning"
          desc="Scan messages for known threat patterns"
          enabled={messageScanning}
          onToggle={() => setMessageScanning(!messageScanning)}
        />
        <SecurityToggle
          label="Emergency Lockdown"
          desc="Immediately block all new joins and restrict messaging"
          enabled={lockdownActive}
          onToggle={() => setLockdownActive(!lockdownActive)}
          danger
        />
      </div>
    </div>
  );
}

function SecurityToggle({
  label,
  desc,
  enabled,
  onToggle,
  danger,
}: {
  label: string;
  desc: string;
  enabled: boolean;
  onToggle: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
      <div>
        <p className={`text-xs font-medium ${danger ? "text-red-300" : "text-white/70"}`}>{label}</p>
        <p className="text-[10px] text-white/30 mt-0.5">{desc}</p>
      </div>
      <button onClick={onToggle} className="shrink-0">
        {enabled ? (
          <ToggleRight size={24} className={danger ? "text-red-400" : "text-green-400"} />
        ) : (
          <ToggleLeft size={24} className="text-white/20" />
        )}
      </button>
    </div>
  );
}
