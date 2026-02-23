/**
 * MembersTab — Server member list with role tags, assignment controls,
 * moderation actions (kick, ban, timeout, warn), and extended member info.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Search,
  Crown,
  Plus,
  X,
  UserMinus,
  Filter,
  Clock,
  AlertTriangle,
  Ban,
  MessageSquare,
  MoreHorizontal,
  Calendar,
} from "lucide-react";
import { useServerStore } from "@/store/serverStore";
import type { ServerMemberDto, RoleDto, MemberRoleInfo } from "@/types";

function getHighestPosition(member: ServerMemberDto): number {
  return Math.max(0, ...member.roles.map((r) => r.position));
}

export default function MembersTab({ serverId }: { serverId: string }) {
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const roles = useServerStore((s) => s.roles[serverId] ?? []);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const fetchRoles = useServerStore((s) => s.fetchRoles);
  const assignRole = useServerStore((s) => s.assignRole);
  const removeRole = useServerStore((s) => s.removeRole);
  const removeMember = useServerStore((s) => s.removeMember);

  const [search, setSearch] = useState("");
  const [filterRoleId, setFilterRoleId] = useState("");
  const [rolePopupFor, setRolePopupFor] = useState<string | null>(null);
  const [confirmKickId, setConfirmKickId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modMenuFor, setModMenuFor] = useState<string | null>(null);
  const [timeoutModal, setTimeoutModal] = useState<{ userId: string; username: string } | null>(null);
  const [warnModal, setWarnModal] = useState<{ userId: string; username: string } | null>(null);
  const [banModal, setBanModal] = useState<{ userId: string; username: string } | null>(null);
  const [timeoutDuration, setTimeoutDuration] = useState("5m");
  const [warnReason, setWarnReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers(serverId);
    fetchRoles(serverId);
  }, [serverId, fetchMembers, fetchRoles]);

  const assignableRoles = roles.filter((r) => r.position > 0); // exclude @everyone

  // Filter + search + sort
  const filtered = useMemo(() => {
    let list = [...members];
    // Text search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => (m.nickname ?? m.username).toLowerCase().includes(q));
    }
    // Role filter
    if (filterRoleId) {
      list = list.filter((m) => m.roles.some((r) => r.id === filterRoleId));
    }
    // Sort: owner first, then by highest role position descending, then alphabetical
    list.sort((a, b) => {
      if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
      const posA = getHighestPosition(a);
      const posB = getHighestPosition(b);
      if (posA !== posB) return posB - posA;
      return (a.nickname ?? a.username).localeCompare(b.nickname ?? b.username);
    });
    return list;
  }, [members, search, filterRoleId]);

  const getDisplayRole = (member: ServerMemberDto): MemberRoleInfo | null => {
    const tagged = member.roles
      .filter((r) => r.show_tag && r.position > 0)
      .sort((a, b) => b.position - a.position);
    return tagged[0] ?? null;
  };

  const getMemberColor = (member: ServerMemberDto): string => {
    const colored = member.roles
      .filter((r) => r.color_hex !== "#99AAB5" && r.position > 0)
      .sort((a, b) => b.position - a.position);
    return colored[0]?.color_hex ?? "#ffffff";
  };

  const handleAssign = async (userId: string, roleId: string) => {
    setActionError(null);
    try {
      await assignRole(serverId, userId, roleId);
      setRolePopupFor(null);
    } catch (e) {
      console.error("[MembersTab] assignRole failed:", e);
      setActionError(String(e));
    }
  };

  const handleRemoveRole = async (userId: string, roleId: string) => {
    setActionError(null);
    try {
      await removeRole(serverId, userId, roleId);
    } catch (e) {
      console.error("[MembersTab] removeRole failed:", e);
      setActionError(String(e));
    }
  };

  const handleKick = async (userId: string) => {
    setActionError(null);
    try {
      await removeMember(serverId, userId);
      setConfirmKickId(null);
    } catch (e) {
      console.error("[MembersTab] kick failed:", e);
      setActionError(String(e));
      setConfirmKickId(null);
    }
  };

  const handleTimeout = useCallback(async () => {
    if (!timeoutModal) return;
    setActionError(null);
    try {
      // Will be wired to backend timeout endpoint
      console.log(`[timeout] ${timeoutModal.userId} for ${timeoutDuration}`);
      setTimeoutModal(null);
      setTimeoutDuration("5m");
    } catch (e) {
      setActionError(String(e));
    }
  }, [timeoutModal, timeoutDuration]);

  const handleWarn = useCallback(async () => {
    if (!warnModal) return;
    setActionError(null);
    try {
      // Will be wired to backend warn endpoint
      console.log(`[warn] ${warnModal.userId}: ${warnReason}`);
      setWarnModal(null);
      setWarnReason("");
    } catch (e) {
      setActionError(String(e));
    }
  }, [warnModal, warnReason]);

  const handleBan = useCallback(async () => {
    if (!banModal) return;
    setActionError(null);
    try {
      // Will be wired to backend ban endpoint
      console.log(`[ban] ${banModal.userId}: ${banReason}`);
      setBanModal(null);
      setBanReason("");
    } catch (e) {
      setActionError(String(e));
    }
  }, [banModal, banReason]);

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Search + Role Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 transition-all"
          />
        </div>
        <div className="relative">
          <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
          <select
            value={filterRoleId}
            onChange={(e) => setFilterRoleId(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg pl-8 pr-3 py-2.5 text-xs text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 min-w-[140px]"
          >
            <option value="">All Roles</option>
            {assignableRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-white/25">
        {filtered.length} of {members.length} member{members.length !== 1 ? "s" : ""}
        {filterRoleId && ` · filtered by role`}
      </p>

      {actionError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20 text-xs text-red-400">
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400/50 hover:text-red-400">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Member list */}
      <div className="space-y-1">
        {filtered.map((member) => {
          const displayRole = getDisplayRole(member);
          const nameColor = getMemberColor(member);

          return (
            <div
              key={member.user_id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/[0.03] transition-all group"
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                style={{
                  background: member.avatar
                    ? `url(${member.avatar}) center/cover`
                    : `linear-gradient(135deg, ${member.profile_color ?? "#6366f1"}88, ${member.profile_color ?? "#6366f1"}44)`,
                }}
              >
                {!member.avatar && (member.nickname ?? member.username).charAt(0).toUpperCase()}
              </div>

              {/* Name + roles */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: nameColor }}>
                    {member.nickname ?? member.username}
                  </span>
                  {member.is_owner && (
                    <Crown size={12} className="text-amber-400 shrink-0" />
                  )}
                  {displayRole && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0"
                      style={{
                        color: displayRole.color_hex,
                        borderColor: `${displayRole.color_hex}40`,
                        backgroundColor: `${displayRole.color_hex}15`,
                      }}
                    >
                      {displayRole.name}
                    </span>
                  )}
                </div>

                {/* All role tags */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {member.roles
                    .filter((r) => r.position > 0)
                    .sort((a, b) => b.position - a.position)
                    .map((role) => (
                      <span
                        key={role.id}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] text-white/40 group/tag"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: role.color_hex }}
                        />
                        {role.name}
                        <button
                          onClick={() => handleRemoveRole(member.user_id, role.id)}
                          className="opacity-0 group-hover/tag:opacity-100 hover:text-red-400 transition-opacity ml-0.5"
                          title="Remove role"
                        >
                          <X size={8} />
                        </button>
                      </span>
                    ))}

                  {/* Add role button */}
                  <div className="relative">
                    <button
                      onClick={() =>
                        setRolePopupFor(rolePopupFor === member.user_id ? null : member.user_id)
                      }
                      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] text-white/20 hover:text-white/40 hover:bg-white/[0.08] transition-all"
                    >
                      <Plus size={8} />
                    </button>

                    {/* Role assignment popup */}
                    {rolePopupFor === member.user_id && (
                      <RoleAssignPopup
                        roles={assignableRoles}
                        currentRoleIds={new Set(member.roles.map((r) => r.id))}
                        onAssign={(roleId) => handleAssign(member.user_id, roleId)}
                        onClose={() => setRolePopupFor(null)}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              {!member.is_owner && (
                <div className="flex items-center gap-1.5 shrink-0 relative">
                  {confirmKickId === member.user_id ? (
                    <>
                      <span className="text-[10px] text-red-400/80">Remove?</span>
                      <button
                        onClick={() => handleKick(member.user_id)}
                        className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmKickId(null)}
                        className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-white/40 hover:bg-white/[0.08] transition-colors"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setConfirmKickId(member.user_id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Remove member"
                      >
                        <UserMinus size={14} />
                      </button>

                      {/* Moderation dropdown */}
                      <button
                        onClick={() => setModMenuFor(modMenuFor === member.user_id ? null : member.user_id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-all"
                        title="Moderation actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>

                      {modMenuFor === member.user_id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setModMenuFor(null)} />
                          <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[#1a1d27] border border-white/[0.06] rounded-lg shadow-xl py-1">
                            <button
                              onClick={() => { setModMenuFor(null); setTimeoutModal({ userId: member.user_id, username: member.nickname ?? member.username }); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
                            >
                              <Clock size={12} /> Timeout
                            </button>
                            <button
                              onClick={() => { setModMenuFor(null); setWarnModal({ userId: member.user_id, username: member.nickname ?? member.username }); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
                            >
                              <AlertTriangle size={12} /> Warn
                            </button>
                            <button
                              onClick={() => { setModMenuFor(null); setSelectedMemberId(member.user_id); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
                            >
                              <MessageSquare size={12} /> View Info
                            </button>
                            <div className="border-t border-white/[0.04] my-1" />
                            <button
                              onClick={() => { setModMenuFor(null); setBanModal({ userId: member.user_id, username: member.nickname ?? member.username }); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-all"
                            >
                              <Ban size={12} /> Ban
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Timeout Modal ────────────────────────────────── */}
      {timeoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#1a1d27] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-white/80 mb-1 flex items-center gap-2">
              <Clock size={14} /> Timeout {timeoutModal.username}
            </h3>
            <p className="text-xs text-white/30 mb-4">Member will be unable to send messages for the duration.</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {["1m", "5m", "10m", "30m", "1h", "6h", "12h", "24h", "7d"].map((d) => (
                <button
                  key={d}
                  onClick={() => setTimeoutDuration(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    timeoutDuration === d
                      ? "bg-dl-accent text-white"
                      : "bg-white/[0.04] text-white/40 hover:bg-white/[0.08]"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setTimeoutModal(null); setTimeoutDuration("5m"); }} className="px-4 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all">
                Cancel
              </button>
              <button onClick={handleTimeout} className="px-4 py-2 rounded-lg text-xs font-medium bg-amber-500/80 text-white hover:bg-amber-500 transition-all">
                Timeout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Warn Modal ──────────────────────────────────── */}
      {warnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#1a1d27] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-white/80 mb-1 flex items-center gap-2">
              <AlertTriangle size={14} /> Warn {warnModal.username}
            </h3>
            <p className="text-xs text-white/30 mb-4">A warning will be recorded and the user will be notified.</p>
            <textarea
              value={warnReason}
              onChange={(e) => setWarnReason(e.target.value)}
              rows={3}
              placeholder="Reason for warning…"
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-white/80 resize-none focus:outline-none focus:ring-1 focus:ring-dl-accent/50 placeholder:text-white/15 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setWarnModal(null); setWarnReason(""); }} className="px-4 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all">
                Cancel
              </button>
              <button onClick={handleWarn} disabled={!warnReason.trim()} className="px-4 py-2 rounded-lg text-xs font-medium bg-amber-500/80 text-white hover:bg-amber-500 disabled:opacity-40 transition-all">
                Warn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ban Modal ───────────────────────────────────── */}
      {banModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#1a1d27] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-red-400 mb-1 flex items-center gap-2">
              <Ban size={14} /> Ban {banModal.username}
            </h3>
            <p className="text-xs text-white/30 mb-4">This will permanently ban the user from the server.</p>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={3}
              placeholder="Reason for ban…"
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-white/80 resize-none focus:outline-none focus:ring-1 focus:ring-red-500/50 placeholder:text-white/15 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setBanModal(null); setBanReason(""); }} className="px-4 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all">
                Cancel
              </button>
              <button onClick={handleBan} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-all">
                Ban
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Member Info Panel ───────────────────────────── */}
      {selectedMemberId && (() => {
        const m = members.find((x) => x.user_id === selectedMemberId);
        if (!m) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedMemberId(null)}>
            <div className="bg-[#1a1d27] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold text-white"
                  style={{
                    background: m.avatar
                      ? `url(${m.avatar}) center/cover`
                      : `linear-gradient(135deg, ${m.profile_color ?? "#6366f1"}88, ${m.profile_color ?? "#6366f1"}44)`,
                  }}
                >
                  {!m.avatar && (m.nickname ?? m.username).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white/85">{m.nickname ?? m.username}</div>
                  <div className="text-xs text-white/30">@{m.username}</div>
                </div>
                <button onClick={() => setSelectedMemberId(null)} className="ml-auto p-1 rounded text-white/20 hover:text-white/50">
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <Calendar size={11} className="text-white/25" />
                  <span className="text-white/30">Joined:</span>
                  <span className="text-white/50">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "Unknown"}</span>
                </div>

                <div>
                  <div className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Roles</div>
                  <div className="flex flex-wrap gap-1">
                    {m.roles
                      .filter((r) => r.position > 0)
                      .sort((a, b) => b.position - a.position)
                      .map((role) => (
                        <span
                          key={role.id}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-white/50"
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: role.color_hex }} />
                          {role.name}
                        </span>
                      ))}
                    {m.roles.filter((r) => r.position > 0).length === 0 && (
                      <span className="text-[10px] text-white/20">No roles</span>
                    )}
                  </div>
                </div>

                {m.is_owner && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400/80">
                    <Crown size={12} /> Server Owner
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Role assignment popup ───────────────────────────────────────────────────

function RoleAssignPopup({
  roles,
  currentRoleIds,
  onAssign,
  onClose,
}: {
  roles: RoleDto[];
  currentRoleIds: Set<string>;
  onAssign: (roleId: string) => void;
  onClose: () => void;
}) {
  const available = roles.filter((r) => !currentRoleIds.has(r.id));

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-10" onClick={onClose} />

      <div className="absolute left-0 top-full mt-1 z-20 w-48 bg-[#1a1d27] border border-white/[0.06] rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto">
        {available.length === 0 ? (
          <p className="px-3 py-2 text-xs text-white/25">All roles assigned</p>
        ) : (
          available.map((role) => (
            <button
              key={role.id}
              onClick={() => onAssign(role.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: role.color_hex }}
              />
              <span className="truncate">{role.name}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
