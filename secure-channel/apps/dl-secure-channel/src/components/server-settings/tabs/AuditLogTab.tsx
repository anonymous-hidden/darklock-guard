/**
 * AuditLogTab — Paginated audit log viewer with filter bar.
 *
 * Filters: Action type, Target type, Actor.
 * Each entry shows expandable diff_json + changes.
 */
import { useEffect, useState, useCallback } from "react";
import { Clock, ChevronDown, Filter, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useServerStore } from "@/store/serverStore";

const ACTION_LABELS: Record<string, string> = {
  server_update:    "Server Updated",
  channel_create:   "Channel Created",
  channel_update:   "Channel Updated",
  channel_delete:   "Channel Deleted",
  role_create:      "Role Created",
  role_update:      "Role Updated",
  role_delete:      "Role Deleted",
  role_assign:      "Role Assigned",
  role_remove:      "Role Removed",
  role_reorder:     "Roles Reordered",
  member_join:      "Member Joined",
  member_leave:     "Member Left",
  member_kick:      "Member Kicked",
  member_ban:       "Member Banned",
  member_unban:     "Member Unbanned",
  member_timeout:   "Member Timed Out",
  member_warn:      "Member Warned",
  override_update:  "Override Updated",
  override_delete:  "Override Deleted",
  invite_create:    "Invite Created",
  invite_delete:    "Invite Deleted",
  automod_trigger:  "AutoMod Triggered",
  lockdown_enable:  "Lockdown Enabled",
  lockdown_disable: "Lockdown Disabled",
  security_update:  "Security Updated",
  encryption_change: "Encryption Changed",
  command_execute:  "Command Executed",
  message_pin:      "Message Pinned",
  message_unpin:    "Message Unpinned",
  message_delete:   "Message Deleted (Mod)",
};

const TARGET_TYPES = ["role", "channel", "member", "server", "override"] as const;
const ALL_ACTIONS = Object.keys(ACTION_LABELS);

export default function AuditLogTab({ serverId }: { serverId: string }) {
  const entries = useServerStore((s) => s.auditLog[serverId] ?? []);
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const fetchAuditLog = useServerStore((s) => s.fetchAuditLog);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter state
  const [filterAction, setFilterAction] = useState("");
  const [filterTargetType, setFilterTargetType] = useState("");
  const [filterActorId, setFilterActorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  // Build actor list from unique actor_ids in entries + members
  const actorOptions = Array.from(
    new Map(
      entries
        .map((e) => [e.actor_id, e.actor_username ?? e.actor_id.slice(0, 8)] as const)
        .concat(members.map((m) => [m.user_id, m.nickname ?? m.username] as const))
    ).entries()
  ).map(([, [id, name]]) => ({ id, name }));

  const doFetch = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    setError(null);
    try {
      const count = await fetchAuditLog(serverId, {
        action: filterAction || undefined,
        targetType: filterTargetType || undefined,
        actorId: filterActorId || undefined,
        limit: PAGE_SIZE,
      });
      if (count < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [serverId, fetchAuditLog, filterAction, filterTargetType, filterActorId]);

  const loadMore = useCallback(async () => {
    if (!entries.length || loadingMore) return;
    const oldest = entries[entries.length - 1];
    setLoadingMore(true);
    try {
      const count = await fetchAuditLog(serverId, {
        action: filterAction || undefined,
        targetType: filterTargetType || undefined,
        actorId: filterActorId || undefined,
        before: oldest.created_at,
        limit: PAGE_SIZE,
        append: true,
      });
      if (count < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.error('loadMore error:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [serverId, fetchAuditLog, entries, loadingMore, filterAction, filterTargetType, filterActorId]);

  useEffect(() => {
    fetchMembers(serverId).catch((e) => console.error('fetchMembers error:', e));
  }, [serverId, fetchMembers]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setFilterAction("");
    setFilterTargetType("");
    setFilterActorId("");
  };
  const hasFilters = !!filterAction || !!filterTargetType || !!filterActorId;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4 max-w-3xl">      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Filter size={13} className="text-white/25" />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
        >
          <option value="">All Actions</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>

        <select
          value={filterTargetType}
          onChange={(e) => setFilterTargetType(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
        >
          <option value="">All Targets</option>
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>

        <select
          value={filterActorId}
          onChange={(e) => setFilterActorId(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 max-w-[180px]"
        >
          <option value="">All Actors</option>
          {actorOptions.map(({ id, name }) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-white/30 hover:text-white/60 transition-all px-2"
          >
            Clear
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={doFetch}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>

        <span className="text-[10px] text-white/20 tabular-nums">
          {entries.length} entries
        </span>
      </div>

      {/* ── Entries ──────────────────────────────────────────────── */}
      {entries.length === 0 && (
        <p className="text-sm text-white/25 py-8 text-center">
          {hasFilters ? "No entries match your filters" : "No audit log entries yet"}
        </p>
      )}

      <div className="space-y-1.5">
        {entries.map((entry) => {
          const isOpen = expanded.has(entry.id);
          const hasDiff = entry.diff_json && typeof entry.diff_json === "object" && Object.keys(entry.diff_json).length > 0;
          const hasChanges = entry.changes && typeof entry.changes === "object" && Object.keys(entry.changes).length > 0;

          return (
            <div
              key={entry.id}
              className={clsx(
                "px-4 py-3 rounded-lg border transition-all",
                isOpen
                  ? "bg-white/[0.03] border-white/[0.08]"
                  : "bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08]"
              )}
            >
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => toggleExpand(entry.id)}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white/70 font-medium">
                    {entry.actor_username ?? entry.actor_id.slice(0, 8)}
                  </span>
                  <span className="text-sm text-white/30 mx-2">—</span>
                  <span className="text-sm text-white/50">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  {entry.target_id && (
                    <span className="text-xs text-white/20 ml-2">
                      ({entry.target_type}: {entry.target_id.slice(0, 8)}…)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-white/20 shrink-0">
                  {(hasDiff || hasChanges) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-dl-accent/40" title="Has details" />
                  )}
                  <Clock size={11} />
                  {formatTime(entry.created_at)}
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-2">
                  {entry.reason && (
                    <p className="text-xs text-white/40">
                      <span className="text-white/25">Reason:</span> {entry.reason}
                    </p>
                  )}

                  {/* Structured diff display */}
                  {hasDiff && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">Changes</p>
                      <div className="space-y-0.5">
                        {Object.entries(entry.diff_json!).map(([field, diff]) => {
                          const d = diff as { old?: unknown; new?: unknown } | undefined;
                          return (
                            <div key={field} className="flex items-start gap-2 text-xs px-3 py-1.5 rounded bg-white/[0.02]">
                              <span className="text-white/40 font-medium min-w-[100px]">{field}</span>
                              {d && typeof d === "object" && "old" in d ? (
                                <>
                                  <span className="text-red-400/50 line-through">{String(d.old ?? "—")}</span>
                                  <span className="text-white/15">→</span>
                                  <span className="text-green-400/60">{String(d.new ?? "—")}</span>
                                </>
                              ) : (
                                <span className="text-white/30">{JSON.stringify(diff)}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Legacy changes JSON */}
                  {hasChanges && !hasDiff && (
                    <pre className="text-[11px] text-white/25 bg-white/[0.02] rounded-md px-3 py-2 overflow-x-auto">
                      {JSON.stringify(entry.changes, null, 2)}
                    </pre>
                  )}

                  <p className="text-[10px] text-white/15 font-mono">ID: {entry.id}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load More */}
      {entries.length > 0 && hasMore && (
        <div className="flex justify-center pt-2 pb-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 text-xs text-white/40 hover:text-white/70 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg transition-all disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
