/**
 * ContactProfileModal — Discord-style floating profile popup.
 * Shows banner, PFP (large round), display name, pronouns, custom status,
 * bio, member since, verification badge, and a collapsible security section.
 * Note field preserved at bottom.
 */
import { useState, useEffect } from "react";
import {
  X, ShieldCheck, Shield, Copy, Check, FileText,
  ChevronDown, ChevronUp, MessageSquare, Plus, Loader2,
} from "lucide-react";
import clsx from "clsx";
import type { ContactDto, ServerMemberDto } from "../types";
import LinkifiedText from "./LinkifiedText";
import { useProfileStore } from "@/store/profileStore";
import { useServerStore } from "@/store/serverStore";

interface Props {
  contact: ContactDto;
  note?: string;
  onClose: () => void;
  onNoteSave?: (note: string) => void;
  /** When viewing a server member, pass their data to show roles/join date */
  serverMember?: ServerMemberDto;
  serverId?: string;
  canManageRoles?: boolean;
}

export default function ContactProfileModal({
  contact,
  note = "",
  onClose,
  onNoteSave,
  serverMember,
  serverId,
  canManageRoles = false,
}: Props) {
  const displayName = contact.display_name ?? contact.contact_user_id;
  const [editNote, setEditNote] = useState(note);
  const [copied, setCopied] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [roleOpLoading, setRoleOpLoading] = useState(false);
  const profile = useProfileStore((s) => s.profiles[contact.contact_user_id]);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const roles = useServerStore((s) => serverId ? (s.roles[serverId] ?? []) : []);
  const assignRole = useServerStore((s) => s.assignRole);
  const removeRole = useServerStore((s) => s.removeRole);

  useEffect(() => {
    fetchProfile(contact.contact_user_id, true).catch(() => {});
  }, [contact.contact_user_id, fetchProfile]);

  useEffect(() => {
    setRoleMenuOpen(false);
  }, [contact.contact_user_id]);

  const profileColor = profile?.profile_color ?? serverMember?.profile_color ?? "#6366f1";
  const contactBio = profile?.profile_bio ?? serverMember?.profile_bio ?? "";
  const contactPronouns = profile?.pronouns ?? "";
  const contactAvatar = profile?.avatar ?? serverMember?.avatar ?? null;
  const contactBanner = profile?.banner ?? serverMember?.banner ?? null;
  const selectedTags = profile?.selected_tags ?? serverMember?.selected_tags ?? [];
  const customStatus = profile?.custom_status ?? "";
  const statusMatch = customStatus.match(/^(\p{Emoji})\s*(.*)/u);
  const contactStatusEmoji = statusMatch?.[1] ?? "";
  const contactStatus = statusMatch?.[2] ?? customStatus;
  const assignedRoleIds = new Set((serverMember?.roles ?? []).map((r) => r.id));
  const assignableRoles = roles
    .filter((r) => r.position > 0 && !assignedRoleIds.has(r.id))
    .sort((a, b) => b.position - a.position);

  const initials = displayName.charAt(0).toUpperCase();

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(contact.fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const saveNote = () => {
    onNoteSave?.(editNote);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
  };

  const handleAssignRole = async (roleId: string) => {
    if (!serverId || !serverMember) return;
    setRoleOpLoading(true);
    try {
      await assignRole(serverId, serverMember.user_id, roleId);
      await fetchProfile(contact.contact_user_id, true);
      setRoleMenuOpen(false);
    } finally {
      setRoleOpLoading(false);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (!serverId || !serverMember) return;
    setRoleOpLoading(true);
    try {
      await removeRole(serverId, serverMember.user_id, roleId);
      await fetchProfile(contact.contact_user_id, true);
    } finally {
      setRoleOpLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[340px] bg-[#111218] border border-white/[0.06] rounded-xl shadow-2xl shadow-black/60 overflow-hidden">
        {/* ── Banner ──────────────────────────────────────────────── */}
        <div className="relative h-[60px]">
          {contactBanner ? (
            <img
              src={contactBanner}
              alt="Banner"
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: `linear-gradient(135deg, ${profileColor}55 0%, ${profileColor}22 50%, transparent 100%)` }}
            />
          )}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors"
          >
            <X size={13} className="text-white/70" />
          </button>
        </div>

        {/* ── Avatar (overlaps banner) ────────────────────────────── */}
        <div className="relative px-4 -mt-10">
          {contactAvatar ? (
            <img
              src={contactAvatar}
              alt={displayName}
              className="w-[80px] h-[80px] rounded-full ring-[6px] ring-[#111218] object-cover shadow-lg"
            />
          ) : (
            <div
              className="w-[80px] h-[80px] rounded-full ring-[6px] ring-[#111218] flex items-center justify-center text-3xl font-bold text-white shadow-lg"
              style={{ background: `linear-gradient(135deg, ${profileColor}77, ${profileColor}33)` }}
            >
              {initials}
            </div>
          )}
        </div>

        {/* ── Name + Status ───────────────────────────────────────── */}
        <div className="px-4 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white leading-tight">{displayName}</span>
            {contact.verified_fingerprint
              ? <ShieldCheck size={16} className="text-green-400 shrink-0" />
              : <Shield size={16} className="text-white/20 shrink-0" />
            }
          </div>
          <p className="text-xs text-white/40 mt-0.5">{contact.contact_user_id}</p>
          {contactPronouns && (
            <p className="text-[11px] text-white/25 mt-0.5">{contactPronouns}</p>
          )}

          {/* Custom status */}
          {(contactStatus || contactStatusEmoji) && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-white/50">
              {contactStatusEmoji && <span>{contactStatusEmoji}</span>}
              {contactStatus && <span>{contactStatus}</span>}
            </div>
          )}
        </div>

        {/* ── Card body ───────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-4">
          <div className="bg-[#0b0c10] rounded-lg p-3 space-y-3">
            {/* Verification badge */}
            <div className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide",
              contact.verified_fingerprint
                ? "bg-green-500/10 text-green-400"
                : "bg-white/[0.05] text-white/30"
            )}>
              {contact.verified_fingerprint ? (
                <><ShieldCheck size={11} /> Verified</>
              ) : (
                <><Shield size={11} /> Not Verified</>
              )}
            </div>

            {/* About Me */}
            {contactBio ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-1">About Me</p>
                <LinkifiedText text={contactBio} className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap" />
              </div>
            ) : (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-1">About Me</p>
                <p className="text-[11px] text-white/15 italic">No bio available</p>
              </div>
            )}

            {/* App-granted tags */}
            {selectedTags.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                      style={{
                        color: tag.color_hex,
                        borderColor: `${tag.color_hex}40`,
                        backgroundColor: `${tag.color_hex}18`,
                      }}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Separator */}
            <div className="h-px bg-white/[0.05]" />

            {/* Server Roles & Join Date (only when serverMember is provided) */}
            {serverMember && (
              <>
                <div className="relative">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">Roles</p>
                    {canManageRoles && serverId && (
                      <button
                        onClick={() => setRoleMenuOpen((v) => !v)}
                        className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/[0.05] text-white/60 hover:text-white/85 hover:bg-white/[0.09]"
                        title="Add role"
                        disabled={roleOpLoading}
                      >
                        {roleOpLoading ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                      </button>
                    )}
                  </div>

                  {roleMenuOpen && canManageRoles && serverId && (
                    <div className="absolute right-0 top-6 z-10 w-44 rounded-lg border border-white/[0.08] bg-[#111218] shadow-xl py-1 max-h-40 overflow-y-auto">
                      {assignableRoles.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-white/35">No assignable roles</div>
                      ) : (
                        assignableRoles.map((role) => (
                          <button
                            key={role.id}
                            onClick={() => handleAssignRole(role.id)}
                            className="w-full text-left px-3 py-2 text-[11px] text-white/65 hover:bg-white/[0.06] hover:text-white/90"
                          >
                            {role.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {serverMember.roles.filter((r) => r.position > 0).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {serverMember.roles
                        .filter((r) => r.position > 0)
                        .sort((a, b) => b.position - a.position)
                        .map((role) => (
                          <span
                            key={role.id}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                            style={{
                              color: role.color_hex,
                              borderColor: `${role.color_hex}30`,
                              backgroundColor: `${role.color_hex}10`,
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: role.color_hex }}
                            />
                            {role.name}
                            {canManageRoles && serverId && !serverMember.is_owner && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleRemoveRole(role.id).catch(() => {});
                                }}
                                className="ml-0.5 text-white/45 hover:text-red-300"
                                title={`Remove ${role.name}`}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-white/15 italic">No roles assigned</p>
                  )}
                </div>
                {serverMember.joined_at && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-1">Member Since</p>
                    <p className="text-xs text-white/40">
                      {new Date(serverMember.joined_at).toLocaleDateString("en-US", {
                        year: "numeric", month: "long", day: "numeric",
                      })}
                    </p>
                  </div>
                )}
                {serverMember.is_owner && (
                  <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide bg-amber-500/10 text-amber-400">
                    👑 Server Owner
                  </div>
                )}
                <div className="h-px bg-white/[0.05]" />
              </>
            )}

            {/* Mutual */}
            <div className="flex items-center gap-2 text-xs text-white/40">
              <MessageSquare size={12} />
              <span>Direct Message</span>
            </div>

            {/* Security (collapsible) */}
            <button
              onClick={() => setShowSecurity(!showSecurity)}
              className="flex items-center justify-between w-full text-[10px] font-bold uppercase tracking-widest text-white/25 hover:text-white/40 transition-colors pt-1"
            >
              <span>Security</span>
              {showSecurity ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showSecurity && (
              <div className="space-y-2">
                {contact.fingerprint ? (
                  <button
                    onClick={copyFingerprint}
                    className="w-full text-left font-mono text-[9px] bg-white/[0.03] hover:bg-white/[0.06] rounded-lg px-3 py-2 text-white/30 leading-relaxed break-all transition-colors group"
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex-1">{contact.fingerprint}</span>
                      <span className="shrink-0 mt-0.5">
                        {copied
                          ? <Check size={10} className="text-green-400" />
                          : <Copy size={10} className="opacity-40 group-hover:opacity-100 transition-opacity" />
                        }
                      </span>
                    </div>
                    {copied && <div className="text-[9px] text-green-400 mt-1">Copied to clipboard</div>}
                  </button>
                ) : (
                  <div className="text-[11px] text-white/25">No fingerprint available for this profile.</div>
                )}
              </div>
            )}

            {/* Separator */}
            <div className="h-px bg-white/[0.05]" />

            {/* Note */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <FileText size={10} className="text-white/25" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Note</span>
              </div>
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Click to add a note"
                className="w-full bg-transparent border-none outline-none text-xs text-white/50 resize-none h-[40px] leading-relaxed placeholder:text-white/15"
              />
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-white/15">Only visible to you</span>
                {editNote !== note && (
                  <button onClick={saveNote} className="text-[10px] font-semibold text-dl-accent hover:text-dl-accent/80 transition-colors">
                    {noteSaved ? "✓ Saved" : "Save"}
                  </button>
                )}
                {noteSaved && editNote === note && (
                  <span className="text-[10px] text-green-400 font-semibold">✓ Saved</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
