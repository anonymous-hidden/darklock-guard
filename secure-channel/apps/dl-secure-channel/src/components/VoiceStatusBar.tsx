/**
 * VoiceStatusBar — Shows connection status, mute/deafen controls,
 * and disconnect button when connected to a voice channel.
 * Wired to voiceStore for real state management.
 */
import { Mic, MicOff, Headphones, EarOff, PhoneOff, Signal } from "lucide-react";
import { useVoiceStore } from "@/store/voiceStore";

interface VoiceStatusBarProps {
  channelName: string;
  serverName: string;
  onDisconnect: () => void;
}

export default function VoiceStatusBar({ channelName, serverName, onDisconnect }: VoiceStatusBarProps) {
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);

  return (
    <div className="border-t border-white/[0.06] bg-[#111218]/80 px-3 py-2">
      {/* Connection info */}
      <div className="flex items-center gap-2 mb-2">
        <Signal size={12} className="text-green-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-green-400">Voice Connected</p>
          <p className="text-[10px] text-white/30 truncate">{channelName} / {serverName}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => toggleMute()}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            muted
              ? "bg-red-500/15 text-red-400 border border-red-500/20"
              : "bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08]"
          }`}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff size={13} /> : <Mic size={13} />}
          {muted ? "Muted" : "Mute"}
        </button>

        <button
          onClick={() => toggleDeafen()}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            deafened
              ? "bg-red-500/15 text-red-400 border border-red-500/20"
              : "bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08]"
          }`}
          title={deafened ? "Undeafen" : "Deafen"}
        >
          {deafened ? <EarOff size={13} /> : <Headphones size={13} />}
          {deafened ? "Deaf" : "Deafen"}
        </button>

        <button
          onClick={onDisconnect}
          className="px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-all"
          title="Disconnect"
        >
          <PhoneOff size={13} />
        </button>
      </div>
    </div>
  );
}
