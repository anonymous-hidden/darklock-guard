/**
 * FriendRequestsSection
 *
 * Renders a collapsible section inside the contacts sidebar that shows
 * both incoming and outgoing pending friend requests.
 *
 *  Incoming  → Accept ✓ / Deny ✗ buttons
 *  Outgoing  → Cancel × button + "Pending…" badge
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, Clock, UserPlus, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { FriendRequestDto } from "../types";

interface Props {
  requests: FriendRequestDto[];
  onAccept: (req: FriendRequestDto) => Promise<void>;
  onDeny:   (req: FriendRequestDto) => Promise<void>;
  onCancel: (req: FriendRequestDto) => Promise<void>;
}

export default function FriendRequestsSection({ requests, onAccept, onDeny, onCancel }: Props) {
  const [expanded, setExpanded] = useState(true);
  // Track loading: "reqId:accept" | "reqId:deny" | "reqId:cancel"
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

  if (requests.length === 0) return null;

  const act = async (key: string, fn: () => Promise<void>, reqId: string) => {
    setLoading(key);
    setErrors((e) => { const n = { ...e }; delete n[reqId]; return n; });
    try {
      await fn();
    } catch (err) {
      setErrors((e) => ({ ...e, [reqId]: String(err) }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mb-2">
      {/* Section header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold text-dl-muted uppercase tracking-wide hover:bg-dl-elevated transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <UserPlus size={11} />
        Friend Requests
        {incoming.length > 0 && (
          <span className="ml-auto inline-flex items-center justify-center w-4 h-4 rounded-full bg-dl-accent text-[9px] font-bold text-white">
            {incoming.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-0.5 mt-0.5">
          {/* Incoming requests */}
          {incoming.map((req) => {
            const isAccepting = loading === `${req.request_id}:accept`;
            const isDenying   = loading === `${req.request_id}:deny`;
            const busy = isAccepting || isDenying;
            const err  = errors[req.request_id];
            return (
              <div key={req.request_id} className="rounded-lg bg-dl-elevated overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full bg-dl-accent/20 flex items-center justify-center text-xs font-semibold text-dl-accent uppercase shrink-0">
                    {req.username.charAt(0)}
                  </div>
                  {/* Name + label */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-dl-text truncate">{req.username}</div>
                    <div className="text-[10px] text-dl-muted">wants to connect</div>
                  </div>
                  {/* Accept */}
                  <button
                    disabled={busy}
                    onClick={() => act(`${req.request_id}:accept`, () => onAccept(req), req.request_id)}
                    title="Accept"
                    className={clsx(
                      "w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0",
                      busy ? "opacity-50 cursor-not-allowed bg-dl-elevated" : "bg-dl-success/15 hover:bg-dl-success/30"
                    )}
                  >
                    {isAccepting
                      ? <Loader2 size={10} className="animate-spin text-dl-success" />
                      : <Check size={11} className="text-dl-success" />}
                  </button>
                  {/* Deny */}
                  <button
                    disabled={busy}
                    onClick={() => act(`${req.request_id}:deny`, () => onDeny(req), req.request_id)}
                    title="Deny"
                    className={clsx(
                      "w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0",
                      busy ? "opacity-50 cursor-not-allowed bg-dl-elevated" : "bg-dl-danger/15 hover:bg-dl-danger/30"
                    )}
                  >
                    {isDenying
                      ? <Loader2 size={10} className="animate-spin text-dl-danger" />
                      : <X size={11} className="text-dl-danger" />}
                  </button>
                </div>
                {err && (
                  <div className="px-2 pb-1.5 text-[10px] text-dl-danger">
                    {err}
                  </div>
                )}
              </div>
            );
          })}

          {/* Outgoing requests */}
          {outgoing.length > 0 && (
            <>
              {incoming.length > 0 && (
                <div className="text-[9px] text-dl-muted uppercase tracking-wide px-2 pt-1">
                  Sent
                </div>
              )}
              {outgoing.map((req) => {
                const isCancelling = loading === `${req.request_id}:cancel`;
                const err = errors[req.request_id];
                return (
                  <div key={req.request_id} className="rounded-lg bg-dl-elevated/60 overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div className="w-7 h-7 rounded-full bg-dl-muted/20 flex items-center justify-center text-xs font-semibold text-dl-muted uppercase shrink-0">
                        {req.username.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-dl-text truncate">{req.username}</div>
                        <div className="flex items-center gap-1 text-[10px] text-dl-muted">
                          <Clock size={9} />
                          Pending…
                        </div>
                      </div>
                      <button
                        disabled={isCancelling}
                        onClick={() => act(`${req.request_id}:cancel`, () => onCancel(req), req.request_id)}
                        title="Cancel request"
                        className={clsx(
                          "w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0",
                          isCancelling ? "opacity-50 cursor-not-allowed" : "bg-dl-elevated hover:bg-dl-danger/20"
                        )}
                      >
                        {isCancelling
                          ? <Loader2 size={10} className="animate-spin text-dl-muted" />
                          : <X size={11} className="text-dl-muted" />}
                      </button>
                    </div>
                    {err && (
                      <div className="px-2 pb-1.5 text-[10px] text-dl-danger">
                        {err}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
