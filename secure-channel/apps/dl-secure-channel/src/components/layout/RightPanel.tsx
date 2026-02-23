/**
 * RightPanel — Collapsible right panel showing contact info, encryption status,
 * server member list, and member profile details.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Lock,
  Key,
  FileText,
  User,
  Users,
  Crown,
  MessageSquare,
  UserX,
  Eye,
} from "lucide-react";

import { useChatStore } from "@/store/chatStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import { useAuthStore } from "@/store/authStore";
import type { MemberRoleInfo, ServerMemberDto, RoleDto } from "@/types";
import { Permissions as PermissionBits, SecurityLevel as SL } from "@/types";
import PresenceIndicator from "@/components/PresenceIndicator";
import { usePresenceStore } from "@/store/presenceStore";
import RoleTag from "@/components/RoleTag";
import ContactProfileModal from "@/components/ContactProfileModal";
import Avatar from "@/components/Avatar";

export default function RightPanel() {
  const { rightPanelOpen, setRightPanelOpen, sidebarView, activeServerId } = useLayoutStore();
  const { activeContactId, contacts } = useChatStore();
  const members = useServerStore((s) => activeServerId ? (s.members[activeServerId] ?? []) : []);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const fetchRoles = useServerStore((s) => s.fetchRoles);

  useEffect(() => {
    if (rightPanelOpen && sidebarView === "server" && activeServerId) {
      fetchMembers(activeServerId).catch(console.error);
      fetchRoles(activeServerId).catch(console.error);
    }
  }, [rightPanelOpen, sidebarView, activeServerId, fetchMembers, fetchRoles]);

  if (!rightPanelOpen) return null;

  const currentContact = contacts.find((c) => c.contact_user_id === activeContactId);
  const displayName = currentContact?.display_name ?? activeContactId ?? "Unknown";

  const isServerView = sidebarView === "server" && activeServerId;

  return (
    <div className="right-panel">
      <div className="right-panel__header">
        <span className="right-panel__title">
          {isServerView ? "Members" : "Profile"}
        </span>
        <button
          onClick={() => setRightPanelOpen(false)}
          className="right-panel__close"
        >
          <X size={18} />
        </button>
      </div>

      {isServerView ? (
        <ServerMemberList members={members} serverId={activeServerId} />
      ) : (
        <>
          <div className="right-panel__profile">
            <div className="right-panel__avatar">
              {activeContactId ? (
                <Avatar userId={activeContactId} fallbackName={displayName} size={72} />
              ) : (
                <span>{displayName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <h3 className="right-panel__name">{displayName}</h3>
            <RoleTag role={currentContact?.system_role} />
            {activeContactId && (
              <span className="right-panel__user-id">ID: {activeContactId.slice(0, 8)}...</span>
            )}
          </div>

          <div className="right-panel__section">
            <h4 className="right-panel__section-title">
              <Lock size={14} />
              Encryption
            </h4>
            <div className="right-panel__info-row">
              <span className="right-panel__info-label">Protocol</span>
              <span className="right-panel__info-value">X3DH + Double Ratchet</span>
            </div>
            <div className="right-panel__info-row">
              <span className="right-panel__info-label">Cipher</span>
              <span className="right-panel__info-value">XChaCha20-Poly1305</span>
            </div>
            <div className="right-panel__info-row">
              <span className="right-panel__info-label">Identity Verified</span>
              <span className={`right-panel__info-value ${currentContact?.verified_fingerprint ? "right-panel__info-value--success" : "right-panel__info-value--warning"}`}>
                {currentContact?.verified_fingerprint ? (
                  <><ShieldCheck size={12} /> Yes</>
                ) : (
                  <><ShieldAlert size={12} /> No</>
                )}
              </span>
            </div>
            {currentContact?.fingerprint && (
              <div className="right-panel__fingerprint">
                <Key size={12} className="shrink-0" />
                <code>{currentContact.fingerprint}</code>
              </div>
            )}
          </div>

          <div className="right-panel__section">
            <h4 className="right-panel__section-title">
              <Users size={14} />
              Members — 2
            </h4>
            <div className="right-panel__member">
              <div className="right-panel__member-avatar right-panel__member-avatar--you">
                <User size={12} />
              </div>
              <span className="right-panel__member-name">You</span>
              <span className="right-panel__member-role">Owner</span>
            </div>
            <div className="right-panel__member">
              <div className="right-panel__member-avatar">
                {activeContactId ? (
                  <Avatar userId={activeContactId} fallbackName={displayName} size={24} />
                ) : (
                  <span>{displayName.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <span className="right-panel__member-name">{displayName}</span>
              <span className="right-panel__member-role">Member</span>
            </div>
          </div>

          <div className="right-panel__section">
            <h4 className="right-panel__section-title">
              <FileText size={14} />
              Shared Files
            </h4>
            <div className="right-panel__empty">
              No files shared yet
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type MemberGroup = {
  key: string;
  title: string;
  role: MemberRoleInfo | null;
  members: ServerMemberDto[];
};

function getHighestSortedRole<T extends { position: number }>(roles: T[]): T | null {
  if (!roles.length) return null;
  return [...roles].sort((a, b) => b.position - a.position)[0] ?? null;
}

function getSeparatedRole(member: ServerMemberDto): MemberRoleInfo | null {
  const candidates = member.roles.filter((r) => r.position > 0 && r.separate_members);
  return getHighestSortedRole(candidates);
}

function getDisplayColor(member: ServerMemberDto): string {
  const colored = member.roles
    .filter((r) => r.position > 0 && r.color_hex !== "#99AAB5")
    .sort((a, b) => b.position - a.position);
  return colored[0]?.color_hex ?? "#ffffff";
}

function getHighestBadge(member: ServerMemberDto): MemberRoleInfo | null {
  const withBadges = member.roles.filter((r) => r.position > 0 && !!r.badge_image_url);
  return getHighestSortedRole(withBadges);
}

function getMemberSecurityLevel(member: ServerMemberDto, serverRoles: RoleDto[]): number {
  let maxLevel: number = SL.USER;
  for (const mr of member.roles) {
    const fullRole = serverRoles.find((r) => r.id === mr.id);
    if (!fullRole) continue;
    const sl: number = fullRole.security_level ?? 0;
    if (sl > maxLevel) maxLevel = sl;
    if (fullRole.is_admin && SL.ADMIN > maxLevel) maxLevel = SL.ADMIN;
  }
  return maxLevel;
}

function securityLevelLabel(level: number): string | null {
  if (level >= SL.OWNER) return "Owner";
  if (level >= SL.CO_OWNER) return "Co-Owner";
  if (level >= SL.ADMIN) return "Admin";
  if (level >= SL.SECURITY_ADMIN) return "Sec Admin";
  if (level >= SL.MODERATOR) return "Mod";
  if (level >= SL.TRUSTED) return "Trusted";
  return null;
}

function securityLevelColor(level: number): string {
  if (level >= SL.OWNER) return "text-amber-400";
  if (level >= SL.CO_OWNER) return "text-orange-400";
  if (level >= SL.ADMIN) return "text-red-400";
  if (level >= SL.SECURITY_ADMIN) return "text-emerald-400";
  if (level >= SL.MODERATOR) return "text-blue-400";
  if (level >= SL.TRUSTED) return "text-cyan-400";
  return "text-white/30";
}

function buildMemberGroups(members: ServerMemberDto[]): MemberGroup[] {
  const separatedMap = new Map<string, MemberGroup>();
  const ungrouped: ServerMemberDto[] = [];

  for (const member of members) {
    const separatedRole = getSeparatedRole(member);
    if (!separatedRole) {
      ungrouped.push(member);
      continue;
    }

    if (!separatedMap.has(separatedRole.id)) {
      separatedMap.set(separatedRole.id, {
        key: separatedRole.id,
        title: separatedRole.name,
        role: separatedRole,
        members: [],
      });
    }
    separatedMap.get(separatedRole.id)!.members.push(member);
  }

  const sortedSeparated = [...separatedMap.values()]
    .sort((a, b) => (b.role?.position ?? 0) - (a.role?.position ?? 0))
    .map((g) => ({
      ...g,
      members: [...g.members].sort((a, b) => (a.nickname ?? a.username).localeCompare(b.nickname ?? b.username)),
    }));

  if (ungrouped.length > 0) {
    sortedSeparated.push({
      key: "members",
      title: "Members",
      role: null,
      members: [...ungrouped].sort((a, b) => (a.nickname ?? a.username).localeCompare(b.nickname ?? b.username)),
    });
  }

  return sortedSeparated;
}

function ServerMemberList({
  members,
  serverId,
}: {
  members: ServerMemberDto[];
  serverId: string;
}) {
  const roles = useServerStore((s) => s.roles[serverId] ?? []);
  const getStatus = usePresenceStore((s) => s.getStatus);
  const fetchBatchPresence = usePresenceStore((s) => s.fetchBatchPresence);
  const userId = useAuthStore((s) => s.userId);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; member: ServerMemberDto } | null>(null);
  const [profileMember, setProfileMember] = useState<ServerMemberDto | null>(null);

  useEffect(() => {
    const userIds = members.map((m) => m.user_id);
    if (userIds.length > 0) {
      fetchBatchPresence(userIds).catch(console.error);
    }
  }, [members, fetchBatchPresence]);

  useEffect(() => {
    const userIds = members.map((m) => m.user_id);
    if (userIds.length === 0) return;
    const iv = setInterval(() => {
      fetchBatchPresence(userIds).catch(console.error);
    }, 15_000);
    return () => clearInterval(iv);
  }, [members, fetchBatchPresence]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, member: ServerMemberDto) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, member });
  }, []);

  const groups = useMemo(() => buildMemberGroups(members), [members]);
  const currentMember = members.find((m) => m.user_id === userId);
  const canManageRoles = !!(
    currentMember?.is_owner ||
    currentMember?.roles.some((mr) => {
      const role = roles.find((r) => r.id === mr.id);
      return !!role && (role.is_admin || (Number(role.permissions) & PermissionBits.MANAGE_ROLES) === PermissionBits.MANAGE_ROLES);
    })
  );

  return (
    <div className="right-panel__section" style={{ paddingTop: "0.5rem" }}>
      {groups.map((group) => (
        <div key={group.key} className="mb-4">
          <h4
            className="text-[10px] font-semibold uppercase tracking-wider mb-1 px-2"
            style={{ color: group.role?.color_hex && group.role.color_hex !== "#99AAB5" ? group.role.color_hex : undefined }}
          >
            {group.title} — {group.members.length}
          </h4>
          {group.members.map((member) => {
            const badge = getHighestBadge(member);
            const secLevel = getMemberSecurityLevel(member, roles);
            const secLabel = member.is_owner ? null : securityLevelLabel(secLevel);
            return (
              <div
                key={member.user_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-all cursor-pointer"
                onContextMenu={(e) => handleContextMenu(e, member)}
                onClick={() => setProfileMember(member)}
              >
                <div className="relative shrink-0">
                  <Avatar userId={member.user_id} fallbackName={member.nickname ?? member.username} size={32} />
                  <PresenceIndicator status={getStatus(member.user_id)} size="sm" className="absolute -bottom-0.5 -right-0.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: getDisplayColor(member) }}
                    >
                      {member.nickname ?? member.username}
                    </span>
                    {badge?.badge_image_url && (
                      <img src={badge.badge_image_url} alt={`${badge.name} badge`} className="w-3.5 h-3.5 rounded-sm object-cover shrink-0" />
                    )}
                    {member.is_owner && (
                      <Crown size={10} className="text-amber-400 shrink-0" />
                    )}
                    {secLabel && (
                      <span className={`text-[9px] shrink-0 ${securityLevelColor(secLevel)}`} title={`Security Level: ${secLevel}`}>
                        <Shield size={9} className="inline -mt-px" /> {secLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {member.roles
                      .filter((r) => r.position > 0 && r.show_tag)
                      .sort((a, b) => b.position - a.position)
                      .slice(0, 3)
                      .map((role) => (
                        <span
                          key={role.id}
                          className="text-[9px] px-1 py-0 rounded-sm"
                          style={{
                            color: role.color_hex,
                            backgroundColor: `${role.color_hex}15`,
                          }}
                        >
                          {role.name}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {members.length === 0 && (
        <div className="right-panel__empty">No members</div>
      )}

      {ctxMenu && (
        <div
          className="fixed z-50 w-48 bg-[#111218] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/60 py-1.5 overflow-hidden"
          style={{ top: ctxMenu.y, left: Math.min(ctxMenu.x, window.innerWidth - 200) }}
        >
          <button
            onClick={() => { setProfileMember(ctxMenu.member); setCtxMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
          >
            <Eye size={14} /> View Profile
          </button>
          <button
            onClick={() => { setCtxMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
          >
            <MessageSquare size={14} /> Message
          </button>
          <div className="h-px bg-white/[0.06] my-1" />
          {ctxMenu.member.roles
            .filter((r) => r.position > 0 && r.show_tag)
            .sort((a, b) => b.position - a.position)
            .slice(0, 5)
            .map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/40"
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color_hex }} />
                {role.name}
              </div>
            ))}
          {ctxMenu.member.roles.filter((r) => r.position > 0 && r.show_tag).length > 0 && (
            <div className="h-px bg-white/[0.06] my-1" />
          )}
          <button
            onClick={() => { setCtxMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <UserX size={14} /> Kick Member
          </button>
        </div>
      )}

      {profileMember && (
        <ContactProfileModal
          contact={{
            id: profileMember.user_id,
            contact_user_id: profileMember.user_id,
            display_name: profileMember.nickname ?? profileMember.username,
            identity_pubkey: "",
            verified_fingerprint: null,
            key_change_pending: false,
            fingerprint: "",
          }}
          serverId={serverId}
          canManageRoles={canManageRoles}
          serverMember={members.find((m) => m.user_id === profileMember.user_id) ?? profileMember}
          onClose={() => setProfileMember(null)}
        />
      )}
    </div>
  );
}
