/**
 * AddContactDialog — two-step contact lookup and friend request.
 * Step 1: type a username → debounced identity-server lookup (getUserKeys).
 * Step 2: preview the user card (username + key fingerprint) → Send Request.
 */
import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, ShieldCheck, Key, X, Loader2, AlertCircle, Check, MessageSquare } from "lucide-react";
import { getUserKeys, sendFriendRequest } from "../lib/tauri";
import type { UserKeysResponse } from "../types";

interface Props {
  onClose: () => void;
  /** Called after a request is successfully sent (no longer receives a ContactDto). */
  onAdded: () => void;
  /** Called when user is already a contact — lets parent re-open their DM. */
  onOpenDM?: (userId: string, username: string) => void;
}

/** Shorten a base64 key to a readable fingerprint like "A3F2 · 9C1D · 7B44 · E82A" */
function shortFingerprint(pubkey: string): string {
  try {
    const hex = Array.from(atob(pubkey.replace(/-/g, "+").replace(/_/g, "/")))
      .map((b) => b.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16)
      .toUpperCase();
    return hex.match(/.{4}/g)?.join(" · ") ?? hex;
  } catch {
    return pubkey.slice(0, 16) + "…";
  }
}

export default function AddContactDialog({ onClose, onAdded, onOpenDM }: Props) {
  const [query, setQuery] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "searching" | "found" | "not-found" | "error">("idle");
  const [preview, setPreview] = useState<UserKeysResponse | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced lookup — fires 450ms after user stops typing
  useEffect(() => {
    setPreview(null);
    setSendError(null);
    setSent(false);
    if (!query.trim() || query.trim().length < 2) {
      setLookupState("idle");
      return;
    }
    setLookupState("searching");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const keys = await getUserKeys(query.trim());
        setPreview(keys);
        setLookupState("found");
      } catch (e) {
        const msg = String(e).toLowerCase();
        if (msg.includes("not_found") || msg.includes("not found") || msg.includes("404") || msg.includes("no user")) {
          setLookupState("not-found");
        } else {
          setLookupState("error");
        }
      }
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleSendRequest = async () => {
    if (!preview) return;
    setSendLoading(true);
    setSendError(null);
    try {
      await sendFriendRequest(preview.username);
      setSent(true);
      // Close after a brief "Sent!" confirmation
      setTimeout(() => onAdded(), 1200);
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSendLoading(false);
    }
  };

  const alreadyPending = sendError?.toLowerCase().includes("already_pending") ||
    sendError?.toLowerCase().includes("already pending");
  const alreadyFriends = sendError?.toLowerCase().includes("already_friends") ||
    sendError?.toLowerCase().includes("already friends");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="dl-card max-w-sm w-full mx-4 p-0 overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dl-border">
          <div className="flex items-center gap-2">
            <UserPlus size={17} className="text-dl-accent" />
            <h2 className="text-sm font-semibold text-dl-text">Add Contact</h2>
          </div>
          <button onClick={onClose} className="text-dl-muted hover:text-dl-text transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Search input */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            {lookupState === "searching" ? (
              <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dl-muted animate-spin" />
            ) : (
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dl-muted" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username…"
              className="dl-input pl-9 pr-4 text-sm"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setLookupState("idle"); inputRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dl-muted hover:text-dl-text"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <p className="text-xs text-dl-muted mt-1.5 px-1">
            Looks up the user's identity keys on the Darklock ID server.
          </p>
        </div>

        {/* States */}
        <div className="px-5 pb-5 min-h-[80px]">
          {/* Idle hint */}
          {lookupState === "idle" && (
            <p className="text-xs text-dl-muted italic text-center py-4">
              Type a username to search
            </p>
          )}

          {/* Searching spinner */}
          {lookupState === "searching" && (
            <div className="flex items-center gap-2 justify-center py-4 text-sm text-dl-muted">
              <Loader2 size={16} className="animate-spin" />
              Searching…
            </div>
          )}

          {/* Not found */}
          {lookupState === "not-found" && (
            <div className="flex items-center gap-2 py-4 text-sm text-dl-warning">
              <AlertCircle size={16} />
              No user found for <span className="font-medium text-dl-text">"{query}"</span>
            </div>
          )}

          {/* Error */}
          {lookupState === "error" && (
            <div className="flex items-center gap-2 py-4 text-sm text-dl-danger">
              <AlertCircle size={16} />
              Lookup failed — check your connection.
            </div>
          )}

          {/* User preview card */}
          {lookupState === "found" && preview && (
            <div className="rounded-xl border border-dl-border bg-dl-elevated p-4 space-y-3">
              {/* Avatar + name */}
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-dl-accent/20 flex items-center justify-center text-lg font-semibold text-dl-accent uppercase select-none">
                  {preview.username.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-dl-text truncate">
                    {preview.username}
                  </div>
                  <div className="text-xs text-dl-muted truncate">
                    ID: {preview.user_id.slice(0, 12)}…
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-dl-success bg-dl-success/10 px-2 py-0.5 rounded-full">
                  <ShieldCheck size={10} />
                  Found
                </div>
              </div>

              {/* Key fingerprint */}
              <div className="text-xs rounded-lg bg-dl-surface border border-dl-border px-3 py-2 flex items-start gap-2">
                <Key size={11} className="text-dl-muted mt-0.5 shrink-0" />
                <div>
                  <div className="text-dl-muted mb-0.5 font-medium">Identity key fingerprint</div>
                  <code className="text-dl-text font-mono tracking-wider">
                    {shortFingerprint(preview.identity_pubkey)}
                  </code>
                </div>
              </div>

              {/* Key version */}
              <div className="text-[10px] text-dl-muted flex items-center gap-1">
                <span>Key version:</span>
                <span className="text-dl-text font-medium">v{preview.key_version}</span>
                <span className="mx-1">·</span>
                <span>OPK available:</span>
                <span className={preview.prekey_bundle.opk_pub ? "text-dl-success" : "text-dl-warning"}>
                  {preview.prekey_bundle.opk_pub ? "Yes" : "No (fallback)"}
                </span>
              </div>

              {/* Send errors */}
              {sendError && !alreadyPending && !alreadyFriends && (
                <p className="text-xs text-dl-danger flex items-center gap-1">
                  <AlertCircle size={12} /> {sendError}
                </p>
              )}
              {alreadyPending && (
                <p className="text-xs text-dl-warning flex items-center gap-1">
                  <AlertCircle size={12} /> Friend request already pending.
                </p>
              )}
              {alreadyFriends && (
                <div className="space-y-2">
                  <p className="text-xs text-dl-success flex items-center gap-1">
                    <Check size={12} /> Already in your contacts.
                  </p>
                  {onOpenDM && preview && (
                    <button
                      onClick={() => { onOpenDM(preview.user_id, preview.username); onClose(); }}
                      className="dl-btn-primary w-full py-2 text-sm"
                    >
                      <MessageSquare size={14} /> Open DM with {preview.username}
                    </button>
                  )}
                </div>
              )}

              {/* Send request button — hidden when already friends and onOpenDM is provided */}
              {!(alreadyFriends && onOpenDM) && (
              <button
                onClick={handleSendRequest}
                disabled={sendLoading || sent || alreadyPending || alreadyFriends}
                className="dl-btn-primary w-full py-2 text-sm"
              >
                {sent ? (
                  <><Check size={14} /> Request sent!</>
                ) : sendLoading ? (
                  <><Loader2 size={14} className="animate-spin" /> Sending…</>
                ) : (
                  <><UserPlus size={14} /> Send friend request to {preview.username}</>
                )}
              </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}