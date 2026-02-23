/**
 * PinPanel — Slide-out panel showing pinned messages for the active DM.
 * Wired to cmd_get_dm_pins / cmd_unpin_dm_message.
 */
import { useEffect, useState } from "react";
import { Pin, X, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";

import { useLayoutStore } from "@/store/layoutStore";
import { useChatStore } from "@/store/chatStore";
import { getDmPins, unpinDmMessage } from "@/lib/tauri";
import type { PinnedMessageDto } from "@/types";

export default function PinPanel() {
  const { pinPanelOpen, setPinPanelOpen } = useLayoutStore();
  const { activeSessionId } = useChatStore();
  const [pins, setPins] = useState<PinnedMessageDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pinPanelOpen || !activeSessionId) return;
    setLoading(true);
    getDmPins(activeSessionId)
      .then(setPins)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [pinPanelOpen, activeSessionId]);

  if (!pinPanelOpen) return null;

  const handleUnpin = async (pinId: string) => {
    try {
      await unpinDmMessage(pinId);
      setPins((prev) => prev.filter((p) => p.id !== pinId));
    } catch (e) {
      console.error("Unpin failed:", e);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[340px] bg-[#111218] border-l border-white/[0.06] z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-dl-accent" />
          <span className="text-sm font-semibold text-white/90">Pinned Messages</span>
          <span className="text-[10px] bg-white/[0.08] px-1.5 py-0.5 rounded-full text-white/50">
            {pins.length}
          </span>
        </div>
        <button
          onClick={() => setPinPanelOpen(false)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06]"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-white/30 text-sm">
            Loading...
          </div>
        )}

        {!loading && pins.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/30">
            <Pin size={32} className="mb-3 text-white/15" />
            <p className="text-sm font-medium">No pinned messages</p>
            <p className="text-xs mt-1 text-white/20">
              Right-click a message and pin it to keep it here.
            </p>
          </div>
        )}

        {pins.map((pin) => (
          <div
            key={pin.id}
            className="group bg-white/[0.03] hover:bg-white/[0.05] rounded-lg p-3 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/40 mb-1">
                  Pinned {formatPinDate(pin.pinned_at)}
                </p>
                <p className="text-sm text-white/80 break-words">
                  {pin.content_preview || "(empty)"}
                </p>
              </div>
              <button
                onClick={() => handleUnpin(pin.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-white/[0.06]"
                title="Unpin"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPinDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy 'at' HH:mm");
  } catch {
    return iso;
  }
}
