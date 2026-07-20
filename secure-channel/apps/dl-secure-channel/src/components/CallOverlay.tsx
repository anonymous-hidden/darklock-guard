import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCallStore, type CallParticipant } from '../stores/callStore';
import { useChatStore } from '../stores/chatStore';
import { Avatar } from './Shared';
import { Mic, MicOff, Phone, PhoneOff, Shield, Video, VideoOff } from './Icons';
import './CallOverlay.css';

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface ParticipantTileProps {
  participant: CallParticipant;
  stream: MediaStream | null;
}

function ParticipantTile({ participant, stream }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hasVideoTrack = !!stream && stream.getVideoTracks().length > 0;
  const showVideo = participant.videoEnabled && hasVideoTrack;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <article className={`call-tile${participant.isSelf ? ' call-tile--self' : ''}`}>
      <div className="call-tile__media">
        {showVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={participant.isSelf}
            className="call-tile__video"
          />
        ) : (
          <div className="call-tile__avatar-wrap">
            <Avatar name={participant.displayName} size={72} />
          </div>
        )}
      </div>

      <footer className="call-tile__meta">
        <span className="call-tile__name">{participant.displayName}{participant.isSelf ? ' (You)' : ''}</span>
        <span className="call-tile__state">{participant.connectionState}</span>
        <span className="call-tile__badges">
          {participant.audioMuted ? <MicOff size={14} /> : <Mic size={14} />}
          {participant.videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
        </span>
      </footer>
    </article>
  );
}

export function CallOverlay() {
  const selfUserId = useAuthStore((s) => s.userId);
  const activeCall = useCallStore((s) => s.activeCall);
  const incomingCall = useCallStore((s) => s.incomingCall);
  const localStream = useCallStore((s) => s.localStream);
  const lastError = useCallStore((s) => s.lastError);

  const startCall = useCallStore((s) => s.startCall);
  const acceptIncomingCall = useCallStore((s) => s.acceptIncomingCall);
  const declineIncomingCall = useCallStore((s) => s.declineIncomingCall);
  const endCall = useCallStore((s) => s.endCall);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleVideo = useCallStore((s) => s.toggleVideo);
  const clearError = useCallStore((s) => s.clearError);

  const conversations = useChatStore((s) => s.conversations);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!activeCall) {
      setElapsedMs(0);
      return;
    }

    const update = () => setElapsedMs(Date.now() - activeCall.startedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall]);

  const callTitle = useMemo(() => {
    if (activeCall) {
      return conversations[activeCall.conversationId]?.name
        ?? (activeCall.mode === 'group' ? 'Group Call' : 'Direct Call');
    }
    if (incomingCall) {
      return conversations[incomingCall.conversationId]?.name
        ?? (incomingCall.mode === 'group' ? 'Group Call' : 'Direct Call');
    }
    return 'Direct Call';
  }, [activeCall, incomingCall, conversations]);

  const statusText = useMemo(() => {
    if (!activeCall) return '';
    if (activeCall.state === 'connected') return formatDuration(elapsedMs);
    if (activeCall.state === 'calling') return 'Calling…';
    if (activeCall.state === 'ringing') return 'Ringing…';
    return 'Connecting…';
  }, [activeCall, elapsedMs]);

  const participantTiles = useMemo(() => {
    if (!activeCall) return [];
    return Object.values(activeCall.participants)
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
      .map((participant) => {
        const stream = participant.isSelf ? localStream : participant.stream;
        return { participant, stream };
      });
  }, [activeCall, localStream]);

  if (!activeCall && !incomingCall) return null;

  if (incomingCall && !activeCall) {
    return (
      <div className="call-overlay call-overlay--incoming" role="dialog" aria-modal="true" aria-label="Incoming call">
        <section className="call-incoming-card">
          <header className="call-incoming-card__head">
            <span className="call-incoming-card__eyebrow">Incoming {incomingCall.kind} call</span>
            <h3>{incomingCall.fromDisplayName}</h3>
            <p>{callTitle}</p>
          </header>

          <div className="call-incoming-card__actions">
            <button className="call-btn call-btn--decline" onClick={() => void declineIncomingCall()}>
              <PhoneOff size={16} />
              Decline
            </button>
            <button className="call-btn call-btn--accept" onClick={() => void acceptIncomingCall('audio')}>
              <Phone size={16} />
              Voice
            </button>
            {incomingCall.kind === 'video' && (
              <button className="call-btn call-btn--accept-video" onClick={() => void acceptIncomingCall('video')}>
                <Video size={16} />
                Video
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (!activeCall) return null;

  return (
    <div className="call-overlay call-overlay--active" role="dialog" aria-modal="true" aria-label="Active call">
      <section className="call-stage">
        <header className="call-stage__header">
          <div>
            <h3>{callTitle}</h3>
            <p>{statusText}</p>
          </div>
          <div className="call-stage__secure-badge">
            <Shield size={14} />
            WebRTC transport protected
          </div>
        </header>

        {lastError && (
          <div className="call-stage__error" role="alert">
            <span>{lastError}</span>
            <button onClick={clearError}>Dismiss</button>
          </div>
        )}

        <div className="call-grid">
          {participantTiles.map(({ participant, stream }) => (
            <ParticipantTile
              key={participant.userId}
              participant={participant}
              stream={stream}
            />
          ))}
        </div>

        <footer className="call-stage__controls">
          <button
            className={`call-control${activeCall.localAudioMuted ? ' call-control--muted' : ''}`}
            onClick={() => void toggleMute()}
            aria-label={activeCall.localAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {activeCall.localAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <button
            className={`call-control${activeCall.localVideoEnabled ? '' : ' call-control--muted'}`}
            onClick={() => void toggleVideo()}
            aria-label={activeCall.localVideoEnabled ? 'Disable camera' : 'Enable camera'}
          >
            {activeCall.localVideoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
          </button>

          <button className="call-control call-control--danger" onClick={() => void endCall('hangup')} aria-label="Hang up">
            <PhoneOff size={18} />
          </button>
        </footer>

        {!selfUserId && (
          <footer className="call-stage__controls">
            <button className="call-control" onClick={() => void startCall(activeCall.conversationId, 'audio')}>
              <Phone size={18} />
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
