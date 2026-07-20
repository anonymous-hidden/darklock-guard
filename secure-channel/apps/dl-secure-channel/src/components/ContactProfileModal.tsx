/**
 * ContactProfileModal — Discord-style floating profile popup.
 * Shows banner, PFP (large round), display name, pronouns, custom status,
 * bio, member since, verification badge, and a collapsible security section.
 * Note field preserved at bottom.
 */
import { useState, useEffect } from "react";
import {
  X, ShieldCheck, Shield, Copy, Check, FileText,
  ChevronDown, ChevronUp, MessageSquare,
} from "lucide-react";
import clsx from "clsx";
import type { ContactDto, ServerMemberDto } from "../types";
import LinkifiedText from "./LinkifiedText";

interface Props {
  contact: ContactDto;
  note?: string;
  onClose: () => void;
  onNoteSave?: (note: string) => void;
  /** When viewing a server member, pass their data to show roles/join date */
  serverMember?: ServerMemberDto;
}

export default function ContactProfileModal({ contact, note = "", onClose, onNoteSave, serverMember }: Props) {
  const displayName = contact.display_name ?? contact.contact_user_id;
  const [editNote, setEditNote] = useState(note);
  const [copied, setCopied] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);

  // Load contact's public profile from IDS
  const [profileColor, setProfileColor] = useState("#6366f1");
  const [contactBio, setContactBio] = useState("");
  const [contactPronouns, setContactPronouns] = useState("");
  const [contactStatus, setContactStatus] = useState("");
  const [contactStatusEmoji, setContactStatusEmoji] = useState("");
  const [contactAvatar, setContactAvatar] = useState<string | null>(null);
  const [contactBanner, setContactBanner] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { getContactProfile } = await import("@/lib/tauri");
        const p = await getContactProfile(contact.contact_user_id);
        if (p.profile_color) setProfileColor(p.profile_color);
        if (p.profile_bio) setContactBio(p.profile_bio);
        if (p.pronouns) setContactPronouns(p.pronouns);
        if (p.avatar) setContactAvatar(p.avatar);
        if (p.banner) setContactBanner(p.banner);
        if (p.custom_status) {
          // Support "emoji text" format e.g. "🎮 Playing games"
          const match = p.custom_status.match(/^(\p{Emoji})\s*(.*)/u);
          if (match) { setContactStatusEmoji(match[1]); setContactStatus(match[2]); }
          else setContactStatus(p.custom_status);
        }
      } catch {}
    };
    load();
  }, [contact.contact_user_id]);

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

            {/* Separator */}
            <div className="h-px bg-white/[0.05]" />

            {/* Server Roles & Join Date (only when serverMember is provided) */}
            {serverMember && (
              <>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-1.5">Roles</p>
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
