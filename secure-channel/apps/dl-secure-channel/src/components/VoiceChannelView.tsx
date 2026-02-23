import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Headphones, Video, PhoneOff, Radio, Hand, ArrowUpCircle, ArrowDownCircle, ShieldAlert } from "lucide-react";
import { useVoiceStore } from "@/store/voiceStore";
import { useAuthStore } from "@/store/authStore";
import type { ChannelDto } from "@/types";
import { Permissions } from "@/types";
import Avatar from "@/components/Avatar";
import { useServerStore } from "@/store/serverStore";

interface VoiceChannelViewProps {
  serverId: string;
  channel: ChannelDto;
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function VoiceChannelView({ serverId, channel }: VoiceChannelViewProps) {
  const { userId } = useAuthStore();
  const {
    connection,
    muted,
    deafened,
    cameraOn,
    joinChannel,
    leaveChannel,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    requestToSpeak,
    promoteSpeaker,
    demoteSpeaker,
    sendSignal,
    consumeSignals,
    channelMembers,
    fingerprintWarnings,
  } = useVoiceStore();
  const serverMembers = useServerStore((s) => s.members[serverId] ?? []);
  const serverRoles = useServerStore((s) => s.roles[serverId] ?? []);

  const members = channelMembers[channel.id] ?? [];
  const connected = connection?.channelId === channel.id;
  const isStage = channel.type === "stage";
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerMapRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const myMember = useMemo(() => members.find((m) => m.user_id === userId), [members, userId]);
  const serverSelf = useMemo(() => serverMembers.find((m) => m.user_id === userId), [serverMembers, userId]);
  const canModerateStage = useMemo(() => {
    if (!serverSelf) return false;
    if (serverSelf.is_owner) return true;
    return serverSelf.roles.some((mr) => {
      const role = serverRoles.find((r) => r.id === mr.id);
      return !!role && (role.is_admin || (Number(role.permissions) & Permissions.MANAGE_CHANNELS) === Permissions.MANAGE_CHANNELS);
    });
  }, [serverSelf, serverRoles]);
  const speakers = isStage ? members.filter((m) => m.is_stage_speaker) : members;
  const audience = isStage ? members.filter((m) => !m.is_stage_speaker) : [];

  const ensurePeer = async (peerId: string) => {
    if (!userId || !localStreamRef.current) return null;
    if (peerMapRef.current.has(peerId)) return peerMapRef.current.get(peerId)!;
    const pc = new RTCPeerConnection(rtcConfig);
    localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignal(peerId, "ice", ev.candidate.toJSON());
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
    };
    peerMapRef.current.set(peerId, pc);
    return pc;
  };

  useEffect(() => {
    return () => {
      peerMapRef.current.forEach((pc) => pc.close());
      peerMapRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!connected || !userId) return;
    let mounted = true;
    (async () => {
      if (!localStreamRef.current) {
        try {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: cameraOn });
        } catch {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
      }
      for (const m of members) {
        if (!mounted || m.user_id === userId) continue;
        const pc = await ensurePeer(m.user_id);
        if (!pc) continue;
        // Deterministic offerer to avoid glare.
        if (userId < m.user_id && pc.signalingState === "stable") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(m.user_id, "offer", offer);
        }
      }
    })();
    return () => { mounted = false; };
  }, [connected, members, userId, cameraOn]);

  useEffect(() => {
    if (!connected || !userId) return;
    const iv = setInterval(async () => {
      const signals = consumeSignals();
      for (const s of signals) {
        if (!s || s.channel_id !== channel.id || s.server_id !== serverId) continue;
        const fromId = s.from_user_id;
        if (fingerprintWarnings[fromId]) continue;
        const pc = await ensurePeer(fromId);
        if (!pc) continue;
        if (s.signal_type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(s.payload as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(fromId, "answer", answer);
        } else if (s.signal_type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(s.payload as RTCSessionDescriptionInit));
        } else if (s.signal_type === "ice" && s.payload) {
          await pc.addIceCandidate(new RTCIceCandidate(s.payload as RTCIceCandidateInit)).catch(() => {});
        }
      }
    }, 250);
    return () => clearInterval(iv);
  }, [connected, channel.id, serverId, userId, consumeSignals, sendSignal, fingerprintWarnings]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        {isStage ? <Radio size={16} className="text-purple-400/70" /> : <Headphones size={16} className="text-green-400/70" />}
        <h2 className="text-sm font-semibold text-white/80">{channel.name}</h2>
      </div>

      {Object.keys(fingerprintWarnings).length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
          <ShieldAlert size={13} />
          <span>Fingerprint mismatch detected. Review peer identity before continuing.</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {!connected && (
          <button
            onClick={() => joinChannel(serverId, channel.id)}
            className="px-4 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/85"
          >
            Join {isStage ? "Stage" : "Voice"}
          </button>
        )}

        {isStage && (
          <>
            <section>
              <h3 className="text-xs uppercase tracking-wider text-white/35 mb-2">Speakers ({speakers.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {speakers.map((m) => (
                  <MemberTile
                    key={m.user_id}
                    member={m}
                    stream={remoteStreams[m.user_id]}
                    isSelf={m.user_id === userId}
                    onDemote={canModerateStage && m.user_id !== userId ? () => demoteSpeaker(m.user_id) : undefined}
                  />
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wider text-white/35 mb-2">Audience ({audience.length})</h3>
              <div className="space-y-2">
                {audience.map((m) => (
                  <div key={m.user_id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03]">
                    <Avatar userId={m.user_id} fallbackName={m.nickname ?? m.username} size={28} />
                    <span className="text-sm text-white/70 flex-1 truncate">{m.nickname ?? m.username}</span>
                    {canModerateStage && (
                      <button onClick={() => promoteSpeaker(m.user_id)} className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-300">
                        <ArrowUpCircle size={12} className="inline mr-1" />
                        Promote
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {connected && !myMember?.is_stage_speaker && (
                <button
                  onClick={() => requestToSpeak()}
                  className="mt-3 text-xs px-3 py-1.5 rounded bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
                >
                  <Hand size={12} className="inline mr-1" />
                  Request to Speak
                </button>
              )}
            </section>
          </>
        )}

        {!isStage && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {members.map((m) => (
              <MemberTile key={m.user_id} member={m} stream={remoteStreams[m.user_id]} isSelf={m.user_id === userId} />
            ))}
          </div>
        )}
      </div>

      {connected && (
        <div className="px-4 py-3 border-t border-white/[0.06] flex items-center gap-2">
          <button onClick={() => toggleMute()} className="px-3 py-1.5 rounded bg-white/[0.06] text-white/75 text-xs">
            {muted ? <MicOff size={13} className="inline mr-1" /> : <Mic size={13} className="inline mr-1" />}
            {muted ? "Unmute" : "Mute"}
          </button>
          <button onClick={() => toggleDeafen()} className="px-3 py-1.5 rounded bg-white/[0.06] text-white/75 text-xs">
            <Headphones size={13} className="inline mr-1" />
            {deafened ? "Undeafen" : "Deafen"}
          </button>
          <button onClick={() => toggleCamera()} className="px-3 py-1.5 rounded bg-white/[0.06] text-white/75 text-xs">
            <Video size={13} className="inline mr-1" />
            {cameraOn ? "Camera Off" : "Camera On"}
          </button>
          <button onClick={() => leaveChannel()} className="ml-auto px-3 py-1.5 rounded bg-red-500/20 text-red-300 text-xs">
            <PhoneOff size={13} className="inline mr-1" />
            Hang Up
          </button>
        </div>
      )}
    </div>
  );
}

function MemberTile({
  member,
  stream,
  isSelf,
  onDemote,
}: {
  member: any;
  stream?: MediaStream;
  isSelf?: boolean;
  onDemote?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="aspect-video rounded-lg bg-black/35 mb-2 overflow-hidden flex items-center justify-center">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted={isSelf} className="w-full h-full object-cover" />
        ) : (
          <Avatar userId={member.user_id} fallbackName={member.nickname ?? member.username} size={44} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/75 truncate flex-1">{member.nickname ?? member.username}{isSelf ? " (You)" : ""}</span>
        {member.is_muted && <MicOff size={12} className="text-red-400/70" />}
        {member.is_deafened && <Headphones size={12} className="text-red-400/70" />}
      </div>
      {onDemote && (
        <button onClick={onDemote} className="mt-2 text-[11px] px-2 py-1 rounded bg-amber-500/20 text-amber-200">
          <ArrowDownCircle size={11} className="inline mr-1" />
          Move to Audience
        </button>
      )}
    </div>
  );
}
