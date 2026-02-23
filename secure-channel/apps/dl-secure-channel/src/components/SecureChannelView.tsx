/**
 * SecureChannelView — Dedicated view for secure channels.
 *
 * Adds on top of normal chat:
 * - Security status banner (secure / lockdown indicators)
 * - Lockdown toggle button (admin+)
 * - Security alert panel
 * - Audit trail viewer
 * - Security action buttons (wired to backend)
 */
import { useEffect, useState, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  AlertTriangle,
  FileText,
  Bell,
  X,
} from "lucide-react";
import clsx from "clsx";

import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import { useSocketStore } from "@/store/socketStore";
import {
  setChannelSecure,
  removeChannelSecure,
  triggerLockdown,
  releaseLockdown,
  getSecureAudit,
} from "@/lib/tauri";
import type {
  ChannelDto,
  SecureChannelAuditDto,
} from "@/types";
import { SecurityLevel } from "@/types";

interface SecureChannelViewProps {
  serverId: string;
  channel: ChannelDto;
  /** User's computed security level in this server */
  securityLevel: number;
}

export default function SecureChannelView({
  serverId,
  channel,
  securityLevel,
}: SecureChannelViewProps) {
  const { userId } = useAuthStore();
  const servers = useServerStore((s) => s.servers);
  const securityAlerts = useSocketStore((s) => s.securityAlerts);
  const lockdownChannels = useSocketStore((s) => s.lockdownChannels);

  const [auditLog, setAuditLog] = useState<SecureChannelAuditDto[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSecure = channel.is_secure;
  const isLockdown = channel.lockdown || lockdownChannels.has(channel.id);
  const server = servers.find((s) => s.id === serverId);
  const isOwner = server?.owner_id === userId;

  const canManageSecurity = securityLevel >= SecurityLevel.ADMIN || isOwner;
  const canViewAudit = securityLevel >= SecurityLevel.SECURITY_ADMIN || isOwner;
  const canTriggerLockdown = securityLevel >= SecurityLevel.ADMIN || isOwner;
  const canSendAlerts = securityLevel >= SecurityLevel.SECURITY_ADMIN || isOwner;

  // Fetch audit log
  const fetchAudit = useCallback(async () => {
    if (!canViewAudit) return;
    setLoading(true);
    try {
      const result = await getSecureAudit(serverId, channel.id, 50);
      setAuditLog(result.audit_entries);
    } catch (err) {
      console.error("[SecureChannelView] audit fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [serverId, channel.id, canViewAudit]);

  useEffect(() => {
    if (auditOpen && isSecure) {
      fetchAudit();
    }
  }, [auditOpen, isSecure, fetchAudit]);

  // Clear status messages after 3s
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(null); setSuccess(null); }, 3000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  const filteredAlerts = securityAlerts.filter(
    (a) => a.server_id === serverId && (!a.channel_id || a.channel_id === channel.id)
  );

  // ── Security Actions ──────────────────────────────────────────

  const handleToggleSecure = async () => {
    if (!canManageSecurity) return;
    setActionLoading("secure");
    setError(null);
    try {
      if (isSecure) {
        await removeChannelSecure(serverId, channel.id);
        setSuccess("Channel security removed");
      } else {
        await setChannelSecure(serverId, channel.id);
        setSuccess("Channel secured");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to toggle secure status");
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleLockdown = async () => {
    if (!canTriggerLockdown) return;
    setActionLoading("lockdown");
    setError(null);
    try {
      if (isLockdown) {
        await releaseLockdown(serverId, channel.id);
        setSuccess("Lockdown released");
      } else {
        await triggerLockdown(serverId, channel.id);
        setSuccess("Lockdown activated");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to toggle lockdown");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Severity color helpers ────────────────────────────────────

  const severityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "text-red-400 bg-red-500/10 border-red-500/30";
      case "high": return "text-orange-400 bg-orange-500/10 border-orange-500/30";
      case "medium": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
      case "low": return "text-blue-400 bg-blue-500/10 border-blue-500/30";
      default: return "text-white/50 bg-white/5 border-white/10";
    }
  };

  return (
    <div className="secure-channel-panel">
      {/* ── Security Status Banner ──────────────────────────────── */}
      {isSecure && (
        <div
          className={clsx(
            "secure-channel-banner",
            isLockdown
              ? "bg-red-500/10 border-b border-red-500/30"
              : "bg-emerald-500/10 border-b border-emerald-500/30"
          )}
        >
          <div className="flex items-center gap-2 px-4 py-2">
            {isLockdown ? (
              <>
                <ShieldAlert size={16} className="text-red-400" />
                <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">
                  Lockdown Active — All non-admin messaging blocked
                </span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} className="text-emerald-400" />
                <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                  Secure Channel — Enhanced monitoring active
                </span>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Lockdown toggle */}
              {canTriggerLockdown && isSecure && (
                <button
                  onClick={handleToggleLockdown}
                  disabled={actionLoading === "lockdown"}
                  className={clsx(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                    isLockdown
                      ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                      : "bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30"
                  )}
                  title={isLockdown ? "Release Lockdown" : "Trigger Lockdown"}
                >
                  {isLockdown ? <Unlock size={12} /> : <Lock size={12} />}
                  {actionLoading === "lockdown" ? "..." : isLockdown ? "Release" : "Lockdown"}
                </button>
              )}

              {/* Audit log toggle */}
              {canViewAudit && (
                <button
                  onClick={() => setAuditOpen(!auditOpen)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
                  title="View Audit Trail"
                >
                  <FileText size={12} />
                  Audit
                </button>
              )}

              {/* Alerts toggle */}
              {canSendAlerts && filteredAlerts.length > 0 && (
                <button
                  onClick={() => setAlertsPanelOpen(!alertsPanelOpen)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 transition-colors relative"
                  title="Security Alerts"
                >
                  <Bell size={12} />
                  Alerts
                  <span className="bg-red-500 text-white text-[10px] rounded-full px-1 min-w-[16px] text-center">
                    {filteredAlerts.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Security Toggle (for admins on non-secure channels) ── */}
      {!isSecure && canManageSecurity && (
        <div className="px-4 py-2 bg-white/[0.02] border-b border-white/5">
          <button
            onClick={handleToggleSecure}
            disabled={actionLoading === "secure"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20"
          >
            <Shield size={14} />
            {actionLoading === "secure" ? "Securing..." : "Enable Secure Mode"}
          </button>
        </div>
      )}

      {/* ── Status Messages ─────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}
      {success && (
        <div className="px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
          <ShieldCheck size={12} />
          {success}
          <button onClick={() => setSuccess(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* ── Alerts Panel ────────────────────────────────────────── */}
      {alertsPanelOpen && filteredAlerts.length > 0 && (
        <div className="border-b border-white/5 max-h-[200px] overflow-y-auto">
          <div className="px-4 py-2 flex items-center justify-between bg-white/[0.02]">
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
              Security Alerts
            </span>
            <button onClick={() => setAlertsPanelOpen(false)}>
              <X size={14} className="text-white/40 hover:text-white/60" />
            </button>
          </div>
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className={clsx(
                "px-4 py-2 border-b border-white/5 text-xs",
                severityColor(alert.severity)
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={12} />
                <span className="font-medium">{alert.alert_type.replace(/_/g, " ")}</span>
                <span className="text-white/30 ml-auto text-[10px]">
                  {new Date(alert.created_at).toLocaleTimeString()}
                </span>
              </div>
              {alert.message && (
                <p className="mt-0.5 text-white/50">{alert.message}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Audit Trail Panel ───────────────────────────────────── */}
      {auditOpen && canViewAudit && (
        <div className="border-b border-white/5 max-h-[250px] overflow-y-auto">
          <div className="px-4 py-2 flex items-center justify-between bg-white/[0.02]">
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
              Audit Trail
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchAudit}
                className="text-[10px] text-white/40 hover:text-white/60"
              >
                Refresh
              </button>
              <button onClick={() => setAuditOpen(false)}>
                <X size={14} className="text-white/40 hover:text-white/60" />
              </button>
            </div>
          </div>
          {loading ? (
            <div className="px-4 py-4 text-xs text-white/30 text-center">Loading...</div>
          ) : auditLog.length === 0 ? (
            <div className="px-4 py-4 text-xs text-white/30 text-center">No audit entries</div>
          ) : (
            auditLog.map((entry) => (
              <div key={entry.id} className="px-4 py-2 border-b border-white/5 text-xs">
                <div className="flex items-center gap-2">
                  <span className={clsx(
                    "px-1 py-0.5 rounded text-[10px] font-mono",
                    entry.result === "allowed"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  )}>
                    {entry.result}
                  </span>
                  <span className="text-white/70 font-medium">{entry.action}</span>
                  <span className="text-white/30 ml-auto text-[10px]">
                    {entry.actor_username ?? entry.user_id?.slice(0, 8)}
                  </span>
                  <span className="text-white/20 text-[10px]">
                    {new Date(entry.created_at).toLocaleTimeString()}
                  </span>
                </div>
                {entry.permission_checked && (
                  <span className="text-white/20 text-[10px]">
                    Permission: {entry.permission_checked}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
