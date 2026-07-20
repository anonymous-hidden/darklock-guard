import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { useChatStore, type UIConversation } from './chatStore';
import * as ws from '../net/wsClient';
import {
  decryptPayload,
  encryptPayload,
  recipientHasNoBundle,
  recipientRequiresVerification,
} from '../crypto/e2eeSessions';
import type { EncryptedMessage, X3DHHeader } from '@darklock/channel-crypto';
import { createLogger } from '../utils/logger';
import { fetchTurnCredentials } from '../net/idsClient';

const log = createLogger('dl-calls');

export type CallKind = 'audio' | 'video';
export type CallMode = 'dm' | 'group';
export type ParticipantConnectionState =
  | 'invited'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'declined'
  | 'disconnected'
  | 'failed';

interface CallInvitePayload {
  callId: string;
  conversationId: string;
  mode: CallMode;
  kind: CallKind;
  participants: string[];
  issuedAt: number;
  initiatorId: string;
}

interface CallAcceptPayload {
  callId: string;
  conversationId: string;
  participantId: string;
  kind: CallKind;
  participants: string[];
}

interface CallRejectPayload {
  callId: string;
  conversationId: string;
  reason?: string;
}

interface CallEndPayload {
  callId: string;
  conversationId: string;
  reason?: string;
  endedAt?: number;
}

interface CallMediaPayload {
  callId: string;
  conversationId: string;
  participantId: string;
  audioMuted: boolean;
  videoEnabled: boolean;
}

interface CallSignalPayload {
  callId: string;
  conversationId: string;
  signalType: 'offer' | 'answer' | 'candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export interface RelayCallMessage {
  type: string;
  from?: string;
  payload?: unknown;
  timestamp?: number;
}

export interface IncomingCall {
  callId: string;
  conversationId: string;
  mode: CallMode;
  kind: CallKind;
  from: string;
  fromDisplayName: string;
  participants: string[];
  issuedAt: number;
}

export interface CallParticipant {
  userId: string;
  displayName: string;
  isSelf: boolean;
  connectionState: ParticipantConnectionState;
  audioMuted: boolean;
  videoEnabled: boolean;
  stream: MediaStream | null;
  updatedAt: number;
}

export interface ActiveCall {
  callId: string;
  conversationId: string;
  mode: CallMode;
  kind: CallKind;
  state: 'calling' | 'ringing' | 'connecting' | 'connected';
  initiatorId: string;
  startedAt: number;
  participants: Record<string, CallParticipant>;
  localAudioMuted: boolean;
  localVideoEnabled: boolean;
}

interface CallStoreState {
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  localStream: MediaStream | null;
  lastError: string | null;

  startCall: (conversationId: string, kind: CallKind) => Promise<void>;
  acceptIncomingCall: (kind?: CallKind) => Promise<void>;
  declineIncomingCall: () => Promise<void>;
  endCall: (reason?: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  clearError: () => void;
  handleRelayMessage: (msg: RelayCallMessage) => Promise<void>;
}

const peerConnections = new Map<string, RTCPeerConnection>();
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const makingOffer = new Map<string, boolean>();
const ignoreOffer = new Map<string, boolean>();

const CALL_INVITE_TTL_MS = 45_000;
const MAX_GROUP_CALL_PARTICIPANTS = 16;
const DEFAULT_STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'];
const TURN_CREDENTIAL_REFRESH_SKEW_SECONDS = 10;

type CallPacketType = 'call_invite' | 'call_accept' | 'call_reject' | 'call_end' | 'call_signal' | 'call_media';

interface TurnCredentialsState {
  userId: string;
  urls: string[];
  username: string;
  credential: string;
  expiresAtEpochSeconds: number;
}

let activeTurnCredentials: TurnCredentialsState | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  return Array.from(new Set(out));
}

function shouldInitiateOffer(selfUserId: string, remoteUserId: string): boolean {
  return selfUserId.localeCompare(remoteUserId) < 0;
}

function parseDelimitedUrls(rawValue: unknown): string[] {
  return String(rawValue ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasFreshTurnCredentialsForUser(userId: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return !!(
    activeTurnCredentials
    && activeTurnCredentials.userId === userId
    && activeTurnCredentials.expiresAtEpochSeconds > (nowSeconds + TURN_CREDENTIAL_REFRESH_SKEW_SECONDS)
    && activeTurnCredentials.urls.length > 0
    && activeTurnCredentials.username
    && activeTurnCredentials.credential
  );
}

async function ensureFreshTurnCredentials(): Promise<void> {
  const auth = useAuthStore.getState();
  const userId = String(auth.userId ?? '').trim();
  const sessionToken = String(auth.sessionToken ?? '').trim();

  if (!userId || !sessionToken) {
    activeTurnCredentials = null;
    return;
  }

  if (hasFreshTurnCredentialsForUser(userId)) return;

  try {
    const result = await fetchTurnCredentials(sessionToken);
    const username = String(result?.username ?? '').trim();
    const credential = String(result?.credential ?? '');
    const expiresAtEpochSeconds = Number(result?.expires_at);
    const urlsFromServer = Array.isArray(result?.urls)
      ? result.urls.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    const fallbackUrls = parseDelimitedUrls(import.meta.env.VITE_TURN_URL);
    const urls = urlsFromServer.length > 0 ? urlsFromServer : fallbackUrls;

    if (
      !username
      || !credential
      || urls.length === 0
      || !Number.isFinite(expiresAtEpochSeconds)
      || expiresAtEpochSeconds <= Math.floor(Date.now() / 1000)
    ) {
      activeTurnCredentials = null;
      return;
    }

    activeTurnCredentials = {
      userId,
      urls,
      username,
      credential,
      expiresAtEpochSeconds,
    };
  } catch {
    // TURN is optional for connectivity; keep calls functional on STUN-only paths.
    activeTurnCredentials = null;
  }
}

function getRtcConfiguration(): RTCConfiguration {
  const stunListRaw = String(import.meta.env.VITE_STUN_SERVERS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const stunUrls = stunListRaw.length > 0 ? stunListRaw : DEFAULT_STUN_SERVERS;

  const servers: RTCIceServer[] = [{ urls: stunUrls }];
  const currentUserId = String(useAuthStore.getState().userId ?? '').trim();
  if (currentUserId && hasFreshTurnCredentialsForUser(currentUserId) && activeTurnCredentials) {
    servers.push({
      urls: activeTurnCredentials.urls,
      username: activeTurnCredentials.username,
      credential: activeTurnCredentials.credential,
    });
  }

  return {
    iceServers: servers,
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: 2,
  };
}

function resolveConversation(conversationId: string): UIConversation | null {
  return useChatStore.getState().conversations[conversationId] ?? null;
}

function resolveDisplayName(userId: string): string {
  const chat = useChatStore.getState();
  return (
    chat.contacts[userId]?.displayName
    ?? chat.remoteProfiles[userId]?.displayName
    ?? userId.slice(0, 8)
  );
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // no-op
    }
  }
}

function closeAllPeerConnections(): void {
  for (const pc of peerConnections.values()) {
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.onnegotiationneeded = null;
      pc.close();
    } catch {
      // no-op
    }
  }
  peerConnections.clear();
  pendingIceCandidates.clear();
  makingOffer.clear();
  ignoreOffer.clear();
}

function localMediaState(stream: MediaStream | null): { audioMuted: boolean; videoEnabled: boolean } {
  if (!stream) {
    return { audioMuted: true, videoEnabled: false };
  }
  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];
  return {
    audioMuted: !audioTrack || !audioTrack.enabled,
    videoEnabled: !!videoTrack && videoTrack.enabled,
  };
}

function parseInvitePayload(raw: Record<string, unknown>): CallInvitePayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const mode: CallMode = raw.mode === 'group' ? 'group' : 'dm';
  const kind: CallKind = raw.kind === 'video' ? 'video' : 'audio';
  const participants = toStringArray(raw.participants);
  const issuedAt = typeof raw.issuedAt === 'number' ? raw.issuedAt : Date.now();
  const initiatorId = typeof raw.initiatorId === 'string' ? raw.initiatorId : '';

  if (!callId || !conversationId || !initiatorId) return null;
  if (participants.length < 2 || participants.length > MAX_GROUP_CALL_PARTICIPANTS) return null;

  return { callId, conversationId, mode, kind, participants, issuedAt, initiatorId };
}

function parseAcceptPayload(raw: Record<string, unknown>): CallAcceptPayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const participantId = typeof raw.participantId === 'string' ? raw.participantId : '';
  const kind: CallKind = raw.kind === 'video' ? 'video' : 'audio';
  const participants = toStringArray(raw.participants);
  if (!callId || !conversationId || !participantId) return null;
  return { callId, conversationId, participantId, kind, participants };
}

function parseRejectPayload(raw: Record<string, unknown>): CallRejectPayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
  if (!callId || !conversationId) return null;
  return { callId, conversationId, reason };
}

function parseEndPayload(raw: Record<string, unknown>): CallEndPayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
  const endedAt = typeof raw.endedAt === 'number' ? raw.endedAt : undefined;
  if (!callId || !conversationId) return null;
  return { callId, conversationId, reason, endedAt };
}

function parseMediaPayload(raw: Record<string, unknown>): CallMediaPayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const participantId = typeof raw.participantId === 'string' ? raw.participantId : '';
  const audioMuted = typeof raw.audioMuted === 'boolean' ? raw.audioMuted : false;
  const videoEnabled = typeof raw.videoEnabled === 'boolean' ? raw.videoEnabled : false;
  if (!callId || !conversationId || !participantId) return null;
  return { callId, conversationId, participantId, audioMuted, videoEnabled };
}

function parseSignalPayload(raw: Record<string, unknown>): CallSignalPayload | null {
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
  const signalType = raw.signalType;
  if (!callId || !conversationId) return null;
  if (signalType !== 'offer' && signalType !== 'answer' && signalType !== 'candidate') return null;

  const sdp = typeof raw.sdp === 'string' ? raw.sdp : undefined;
  const candidate = isRecord(raw.candidate) ? (raw.candidate as RTCIceCandidateInit) : undefined;
  return { callId, conversationId, signalType, sdp, candidate };
}

async function acquireLocalMedia(requestedKind: CallKind): Promise<{ stream: MediaStream; effectiveKind: CallKind }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Media capture is not available in this environment.');
  }

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (requestedKind === 'audio') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    return { stream, effectiveKind: 'audio' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    return { stream, effectiveKind: 'video' };
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    return { stream, effectiveKind: 'audio' };
  }
}

async function decodeEncryptedPayload(fromUserId: string, payload: unknown): Promise<Record<string, unknown> | null> {
  let parsedEnvelope: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsedEnvelope = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsedEnvelope)) return null;
  if (parsedEnvelope.e2ee !== true || !isRecord(parsedEnvelope.ciphertext)) return null;

  const plaintext = await decryptPayload(
    fromUserId,
    parsedEnvelope.ciphertext as unknown as EncryptedMessage,
    isRecord(parsedEnvelope.x3dh) ? (parsedEnvelope.x3dh as unknown as X3DHHeader) : undefined,
  );
  if (!plaintext) return null;

  try {
    const parsed = JSON.parse(plaintext);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const useCallStore = create<CallStoreState>((set, get) => {
  async function buildEncryptedWirePayload(toUserId: string, payload: object): Promise<string | null> {
    const targetUserId = String(toUserId || '').trim();
    if (!targetUserId || recipientHasNoBundle(targetUserId) || recipientRequiresVerification(targetUserId)) {
      return null;
    }

    const encrypted = await encryptPayload(targetUserId, JSON.stringify(payload));
    if (!encrypted) return null;

    return JSON.stringify({
      e2ee: true,
      ciphertext: encrypted.encrypted,
      ...(encrypted.x3dhHeader ? { x3dh: encrypted.x3dhHeader } : {}),
    });
  }

  async function sendEncryptedPacket(
    toUserId: string,
    type: CallPacketType,
    payload: object,
  ): Promise<boolean> {
    const wirePayload = await buildEncryptedWirePayload(toUserId, payload);
    if (!wirePayload) return false;

    return ws.sendCallEvent(type, toUserId, wirePayload, Date.now());
  }

  async function sendEncryptedPacketFanout(
    recipients: string[],
    type: CallPacketType,
    payload: object,
  ): Promise<boolean> {
    const selfUserId = useAuthStore.getState().userId;
    const targets = Array.from(new Set(
      recipients
        .map((id) => String(id || '').trim())
        .filter((id) => !!id && (!selfUserId || id !== selfUserId)),
    ));
    if (targets.length === 0) return false;

    const packets: Array<{ to: string; payload: string; timestamp: number }> = [];
    for (const recipientId of targets) {
      const wirePayload = await buildEncryptedWirePayload(recipientId, payload);
      if (!wirePayload) return false;
      packets.push({ to: recipientId, payload: wirePayload, timestamp: Date.now() });
    }

    return ws.sendCallEventFanout(type, packets);
  }

  function buildParticipantMap(
    participantIds: string[],
    selfUserId: string,
    callKind: CallKind,
    selfAudioMuted: boolean,
    selfVideoEnabled: boolean,
  ): Record<string, CallParticipant> {
    const now = Date.now();
    const uniqueParticipants = Array.from(new Set(participantIds));
    const map: Record<string, CallParticipant> = {};

    for (const userId of uniqueParticipants) {
      const isSelf = userId === selfUserId;
      map[userId] = {
        userId,
        displayName: resolveDisplayName(userId),
        isSelf,
        connectionState: isSelf ? 'connected' : 'invited',
        audioMuted: isSelf ? selfAudioMuted : false,
        videoEnabled: isSelf ? selfVideoEnabled : callKind === 'video',
        stream: null,
        updatedAt: now,
      };
    }

    return map;
  }

  function updateActiveCallState(nextState: ActiveCall['state']): void {
    set((state) => {
      if (!state.activeCall || state.activeCall.state === nextState) return state;
      return { activeCall: { ...state.activeCall, state: nextState } };
    });
  }

  function updateParticipant(userId: string, patch: Partial<CallParticipant>): void {
    set((state) => {
      if (!state.activeCall) return state;
      const existing = state.activeCall.participants[userId];
      if (!existing) return state;
      return {
        activeCall: {
          ...state.activeCall,
          participants: {
            ...state.activeCall.participants,
            [userId]: {
              ...existing,
              ...patch,
              updatedAt: Date.now(),
            },
          },
        },
      };
    });
  }

  function isParticipantLiveState(status: ParticipantConnectionState): boolean {
    return status === 'invited' || status === 'ringing' || status === 'connecting' || status === 'connected';
  }

  function allRemoteParticipantsTerminal(call: ActiveCall, selfUserId: string): boolean {
    return Object.values(call.participants)
      .filter((p) => p.userId !== selfUserId)
      .every((p) => !isParticipantLiveState(p.connectionState));
  }

  function setError(message: string): void {
    set({ lastError: message });
  }

  function validateConversationMembership(
    conversationId: string,
    fromUserId: string,
    participantIds?: string[],
  ): boolean {
    const selfUserId = useAuthStore.getState().userId;
    if (!selfUserId) return false;

    const conv = resolveConversation(conversationId);
    if (!conv) return false;
    if (!conv.members.includes(selfUserId) || !conv.members.includes(fromUserId)) return false;

    if (participantIds && participantIds.some((id) => !conv.members.includes(id))) {
      return false;
    }

    return true;
  }

  function ensureDmConversation(conversationId: string, fromUserId: string): void {
    const selfUserId = useAuthStore.getState().userId;
    if (!selfUserId) return;
    if (resolveConversation(conversationId)) return;

    const expected = [selfUserId, fromUserId].sort().join(':');
    if (conversationId !== expected) return;

    const chat = useChatStore.getState();
    if (!chat.contacts[fromUserId]) {
      chat.addContact({
        id: fromUserId,
        displayName: resolveDisplayName(fromUserId),
        identityKey: '',
        trustLevel: 'unverified',
        addedAt: Date.now(),
      });
    }

    chat.addConversation({
      id: conversationId,
      type: 'dm',
      members: [selfUserId, fromUserId],
      createdAt: Date.now(),
      unreadCount: 0,
    });
  }

  async function teardownCall(notifyRemote: boolean, reason: string): Promise<void> {
    const currentCall = get().activeCall;
    const selfUserId = useAuthStore.getState().userId;

    if (notifyRemote && currentCall && selfUserId) {
      const recipients = Object.keys(currentCall.participants).filter((id) => id !== selfUserId);
      const payload: CallEndPayload = {
        callId: currentCall.callId,
        conversationId: currentCall.conversationId,
        reason,
        endedAt: Date.now(),
      };
      await sendEncryptedPacketFanout(recipients, 'call_end', payload);
    }

    closeAllPeerConnections();

    const local = get().localStream;
    stopStream(local);

    set({ activeCall: null, localStream: null, incomingCall: null });
  }

  function attachLocalTracksToPeer(pc: RTCPeerConnection): void {
    const stream = get().localStream;
    if (!stream) return;

    const senders = pc.getSenders();
    for (const track of stream.getTracks()) {
      const existing = senders.find((s) => s.track?.kind === track.kind);
      if (existing) {
        void existing.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    }
  }

  async function flushQueuedCandidates(remoteUserId: string, pc: RTCPeerConnection): Promise<void> {
    const queued = pendingIceCandidates.get(remoteUserId);
    if (!queued || queued.length === 0) return;
    pendingIceCandidates.delete(remoteUserId);

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  async function broadcastLocalMediaState(): Promise<void> {
    const call = get().activeCall;
    const selfUserId = useAuthStore.getState().userId;
    if (!call || !selfUserId) return;

    const payload: CallMediaPayload = {
      callId: call.callId,
      conversationId: call.conversationId,
      participantId: selfUserId,
      audioMuted: call.localAudioMuted,
      videoEnabled: call.localVideoEnabled,
    };

    const recipients = Object.keys(call.participants).filter((id) => id !== selfUserId);
    await sendEncryptedPacketFanout(recipients, 'call_media', payload);
  }

  async function createAndSendOffer(remoteUserId: string, allowAnyInitiator = false): Promise<void> {
    const call = get().activeCall;
    const selfUserId = useAuthStore.getState().userId;
    if (!call || !selfUserId) return;

    if (!allowAnyInitiator && !shouldInitiateOffer(selfUserId, remoteUserId)) {
      return;
    }

    const pc = peerConnections.get(remoteUserId);
    if (!pc) return;
    if (makingOffer.get(remoteUserId)) return;
    if (pc.signalingState !== 'stable') return;

    try {
      makingOffer.set(remoteUserId, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (!pc.localDescription?.sdp) return;
      const payload: CallSignalPayload = {
        callId: call.callId,
        conversationId: call.conversationId,
        signalType: 'offer',
        sdp: pc.localDescription.sdp,
      };
      const sent = await sendEncryptedPacket(remoteUserId, 'call_signal', payload);
      if (!sent) {
        updateParticipant(remoteUserId, { connectionState: 'failed' });
      }
    } catch (err) {
      log.warn('offer send failed:', err instanceof Error ? err.message : String(err));
      updateParticipant(remoteUserId, { connectionState: 'failed' });
    } finally {
      makingOffer.set(remoteUserId, false);
    }
  }

  function ensurePeerConnection(remoteUserId: string): RTCPeerConnection | null {
    const existing = peerConnections.get(remoteUserId);
    if (existing) return existing;

    const call = get().activeCall;
    if (!call) return null;

    const pc = new RTCPeerConnection(getRtcConfiguration());
    peerConnections.set(remoteUserId, pc);

    attachLocalTracksToPeer(pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const currentCall = get().activeCall;
      if (!currentCall) return;
      const payload: CallSignalPayload = {
        callId: currentCall.callId,
        conversationId: currentCall.conversationId,
        signalType: 'candidate',
        candidate: event.candidate.toJSON(),
      };
      void sendEncryptedPacket(remoteUserId, 'call_signal', payload);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      updateParticipant(remoteUserId, {
        stream,
        connectionState: 'connected',
        audioMuted: !stream.getAudioTracks().some((t) => t.enabled),
        videoEnabled: stream.getVideoTracks().some((t) => t.enabled),
      });
      updateActiveCallState('connected');
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        updateParticipant(remoteUserId, { connectionState: 'connected' });
        updateActiveCallState('connected');
      } else if (state === 'failed') {
        updateParticipant(remoteUserId, { connectionState: 'failed' });
        try {
          pc.restartIce();
        } catch {
          // no-op
        }
      } else if (state === 'disconnected' || state === 'closed') {
        updateParticipant(remoteUserId, { connectionState: 'disconnected' });
      }
    };

    pc.onnegotiationneeded = () => {
      void createAndSendOffer(remoteUserId, true);
    };

    return pc;
  }

  async function handleOffer(fromUserId: string, signal: CallSignalPayload): Promise<void> {
    if (!signal.sdp) return;

    const selfUserId = useAuthStore.getState().userId;
    if (!selfUserId) return;

    const pc = ensurePeerConnection(fromUserId);
    if (!pc) return;

    const polite = selfUserId.localeCompare(fromUserId) > 0;
    const offerCollision = (makingOffer.get(fromUserId) ?? false) || pc.signalingState !== 'stable';
    const shouldIgnoreOffer = !polite && offerCollision;
    ignoreOffer.set(fromUserId, shouldIgnoreOffer);

    if (shouldIgnoreOffer) return;

    try {
      if (offerCollision) {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      await flushQueuedCandidates(fromUserId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const call = get().activeCall;
      if (!call || !pc.localDescription?.sdp) return;
      const payload: CallSignalPayload = {
        callId: call.callId,
        conversationId: call.conversationId,
        signalType: 'answer',
        sdp: pc.localDescription.sdp,
      };
      await sendEncryptedPacket(fromUserId, 'call_signal', payload);
      updateParticipant(fromUserId, { connectionState: 'connecting' });
    } catch (err) {
      log.warn('offer handling failed:', err instanceof Error ? err.message : String(err));
      updateParticipant(fromUserId, { connectionState: 'failed' });
    }
  }

  async function handleAnswer(fromUserId: string, signal: CallSignalPayload): Promise<void> {
    if (!signal.sdp) return;

    const pc = ensurePeerConnection(fromUserId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await flushQueuedCandidates(fromUserId, pc);
      updateParticipant(fromUserId, { connectionState: 'connecting' });
    } catch (err) {
      log.warn('answer handling failed:', err instanceof Error ? err.message : String(err));
      updateParticipant(fromUserId, { connectionState: 'failed' });
    }
  }

  async function handleCandidate(fromUserId: string, signal: CallSignalPayload): Promise<void> {
    if (!signal.candidate) return;

    const pc = ensurePeerConnection(fromUserId);
    if (!pc) return;

    if (!pc.remoteDescription) {
      const queued = pendingIceCandidates.get(fromUserId) ?? [];
      queued.push(signal.candidate);
      pendingIceCandidates.set(fromUserId, queued);
      return;
    }

    try {
      await pc.addIceCandidate(signal.candidate);
    } catch {
      // Ignore stale/invalid candidate
    }
  }

  return {
    activeCall: null,
    incomingCall: null,
    localStream: null,
    lastError: null,

    clearError: () => set({ lastError: null }),

    startCall: async (conversationId: string, requestedKind: CallKind) => {
      const selfUserId = useAuthStore.getState().userId;
      if (!selfUserId) {
        setError('You must be logged in to start a call.');
        return;
      }
      if (get().activeCall || get().incomingCall) {
        setError('Finish your current call before starting a new one.');
        return;
      }

      const conversation = resolveConversation(conversationId);
      if (!conversation) {
        setError('Conversation not found.');
        return;
      }
      if (!conversation.members.includes(selfUserId)) {
        setError('You are not a member of this conversation.');
        return;
      }

      const participantIds = Array.from(new Set(conversation.members));
      if (!participantIds.includes(selfUserId)) participantIds.push(selfUserId);
      if (participantIds.length < 2 || participantIds.length > MAX_GROUP_CALL_PARTICIPANTS) {
        setError('This call size is not supported.');
        return;
      }

      const recipients = participantIds.filter((id) => id !== selfUserId);
      if (recipients.length === 0) {
        setError('No recipients available for this call.');
        return;
      }

      const blockedRecipients = recipients.filter((id) => recipientRequiresVerification(id));
      if (blockedRecipients.length > 0) {
        const names = blockedRecipients.map((id) => resolveDisplayName(id)).join(', ');
        setError(`Verify the safety number first for: ${names}.`);
        return;
      }

      let stream: MediaStream;
      let effectiveKind: CallKind;
      try {
        const acquired = await acquireLocalMedia(requestedKind);
        stream = acquired.stream;
        effectiveKind = acquired.effectiveKind;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access your microphone/camera.');
        return;
      }

      await ensureFreshTurnCredentials();

      const media = localMediaState(stream);
      const callId = crypto.randomUUID();
      const mode: CallMode = conversation.type === 'group' ? 'group' : 'dm';

      set({
        localStream: stream,
        incomingCall: null,
        lastError: null,
        activeCall: {
          callId,
          conversationId,
          mode,
          kind: effectiveKind,
          state: 'calling',
          initiatorId: selfUserId,
          startedAt: Date.now(),
          participants: buildParticipantMap(participantIds, selfUserId, effectiveKind, media.audioMuted, media.videoEnabled),
          localAudioMuted: media.audioMuted,
          localVideoEnabled: media.videoEnabled,
        },
      });

      const invitePayload: CallInvitePayload = {
        callId,
        conversationId,
        mode,
        kind: effectiveKind,
        participants: participantIds,
        issuedAt: Date.now(),
        initiatorId: selfUserId,
      };

      const deliveredAll = await sendEncryptedPacketFanout(recipients, 'call_invite', invitePayload);

      for (const recipientId of recipients) {
        updateParticipant(recipientId, { connectionState: deliveredAll ? 'ringing' : 'failed' });
      }

      if (!deliveredAll) {
        await teardownCall(false, 'delivery_failed');
        setError('Could not deliver the call invite securely.');
      }
    },

    acceptIncomingCall: async (kind?: CallKind) => {
      const selfUserId = useAuthStore.getState().userId;
      const incoming = get().incomingCall;
      if (!selfUserId || !incoming) return;

      const requestedKind = kind ?? incoming.kind;
      let stream: MediaStream;
      let effectiveKind: CallKind;
      try {
        const acquired = await acquireLocalMedia(requestedKind);
        stream = acquired.stream;
        effectiveKind = acquired.effectiveKind;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access your microphone/camera.');
        return;
      }

      await ensureFreshTurnCredentials();

      const media = localMediaState(stream);
      const participantIds = Array.from(new Set(incoming.participants));
      if (!participantIds.includes(selfUserId)) participantIds.push(selfUserId);

      set({
        localStream: stream,
        incomingCall: null,
        lastError: null,
        activeCall: {
          callId: incoming.callId,
          conversationId: incoming.conversationId,
          mode: incoming.mode,
          kind: effectiveKind,
          state: 'connecting',
          initiatorId: incoming.from,
          startedAt: Date.now(),
          participants: buildParticipantMap(participantIds, selfUserId, effectiveKind, media.audioMuted, media.videoEnabled),
          localAudioMuted: media.audioMuted,
          localVideoEnabled: media.videoEnabled,
        },
      });

      const acceptPayload: CallAcceptPayload = {
        callId: incoming.callId,
        conversationId: incoming.conversationId,
        participantId: selfUserId,
        kind: effectiveKind,
        participants: participantIds,
      };

      const recipients = participantIds.filter((id) => id !== selfUserId);
      const deliveryOk = await sendEncryptedPacketFanout(recipients, 'call_accept', acceptPayload);

      for (const recipientId of recipients) {
        updateParticipant(recipientId, { connectionState: deliveryOk ? 'connecting' : 'failed' });
      }

      if (!deliveryOk) {
        await teardownCall(false, 'delivery_failed');
        setError('Could not deliver call acceptance securely.');
        return;
      }

      for (const recipientId of recipients) {
        const pc = ensurePeerConnection(recipientId);
        if (!pc) continue;

        if (shouldInitiateOffer(selfUserId, recipientId)) {
          void createAndSendOffer(recipientId);
        }
      }

      await broadcastLocalMediaState();
    },

    declineIncomingCall: async () => {
      const incoming = get().incomingCall;
      const selfUserId = useAuthStore.getState().userId;
      if (!incoming || !selfUserId) {
        set({ incomingCall: null });
        return;
      }

      const recipients = incoming.participants.filter((id) => id !== selfUserId);
      const rejectPayload: CallRejectPayload = {
        callId: incoming.callId,
        conversationId: incoming.conversationId,
        reason: 'declined',
      };

      await sendEncryptedPacketFanout(recipients, 'call_reject', rejectPayload);
      set({ incomingCall: null });
    },

    endCall: async (reason = 'ended') => {
      await teardownCall(true, reason);
    },

    toggleMute: async () => {
      const stream = get().localStream;
      const activeCall = get().activeCall;
      const selfUserId = useAuthStore.getState().userId;
      if (!stream || !activeCall || !selfUserId) return;

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const currentlyMuted = audioTracks.every((track) => !track.enabled);
      const nextEnabled = currentlyMuted;
      for (const track of audioTracks) track.enabled = nextEnabled;

      const nextMuted = !nextEnabled;
      set((state) => {
        if (!state.activeCall) return state;
        const self = state.activeCall.participants[selfUserId];
        return {
          activeCall: {
            ...state.activeCall,
            localAudioMuted: nextMuted,
            participants: self
              ? {
                  ...state.activeCall.participants,
                  [selfUserId]: {
                    ...self,
                    audioMuted: nextMuted,
                    updatedAt: Date.now(),
                  },
                }
              : state.activeCall.participants,
          },
        };
      });

      await broadcastLocalMediaState();
    },

    toggleVideo: async () => {
      const activeCall = get().activeCall;
      const selfUserId = useAuthStore.getState().userId;
      if (!activeCall || !selfUserId) return;

      let stream = get().localStream;
      if (!stream) return;

      let videoTrack = stream.getVideoTracks()[0] ?? null;
      if (!videoTrack) {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          const newTrack = cam.getVideoTracks()[0];
          if (!newTrack) throw new Error('No camera track available.');
          stream.addTrack(newTrack);
          videoTrack = newTrack;

          for (const pc of peerConnections.values()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) {
              void sender.replaceTrack(newTrack);
            } else {
              pc.addTrack(newTrack, stream);
            }
          }
        } catch {
          setError('Could not enable camera.');
          return;
        }
      }

      videoTrack.enabled = !videoTrack.enabled;
      const nextVideoEnabled = videoTrack.enabled;

      set((state) => {
        if (!state.activeCall) return state;
        const self = state.activeCall.participants[selfUserId];
        return {
          activeCall: {
            ...state.activeCall,
            kind: nextVideoEnabled ? 'video' : state.activeCall.kind,
            localVideoEnabled: nextVideoEnabled,
            participants: self
              ? {
                  ...state.activeCall.participants,
                  [selfUserId]: {
                    ...self,
                    videoEnabled: nextVideoEnabled,
                    stream,
                    updatedAt: Date.now(),
                  },
                }
              : state.activeCall.participants,
          },
          localStream: stream,
        };
      });

      await broadcastLocalMediaState();
    },

    handleRelayMessage: async (msg: RelayCallMessage) => {
      const fromUserId = typeof msg.from === 'string' ? msg.from : '';
      if (!fromUserId) return;

      if (msg.type === 'call_invite') {
        const payload = await decodeEncryptedPayload(fromUserId, msg.payload);
        if (!payload) return;

        const invite = parseInvitePayload(payload);
        if (!invite) return;

        const selfUserId = useAuthStore.getState().userId;
        if (!selfUserId) return;
        if (Date.now() - invite.issuedAt > CALL_INVITE_TTL_MS) {
          await sendEncryptedPacket(fromUserId, 'call_reject', {
            callId: invite.callId,
            conversationId: invite.conversationId,
            reason: 'expired',
          });
          return;
        }

        ensureDmConversation(invite.conversationId, fromUserId);
        if (!validateConversationMembership(invite.conversationId, fromUserId, invite.participants)) return;
        if (!invite.participants.includes(selfUserId) || !invite.participants.includes(fromUserId)) return;

        const active = get().activeCall;
        if (active && active.callId !== invite.callId) {
          await sendEncryptedPacket(fromUserId, 'call_reject', {
            callId: invite.callId,
            conversationId: invite.conversationId,
            reason: 'busy',
          });
          return;
        }

        set({
          incomingCall: {
            callId: invite.callId,
            conversationId: invite.conversationId,
            mode: invite.mode,
            kind: invite.kind,
            from: fromUserId,
            fromDisplayName: resolveDisplayName(fromUserId),
            participants: invite.participants,
            issuedAt: invite.issuedAt,
          },
          lastError: null,
        });
        return;
      }

      const payload = await decodeEncryptedPayload(fromUserId, msg.payload);
      if (!payload) return;

      if (msg.type === 'call_accept') {
        const accepted = parseAcceptPayload(payload);
        if (!accepted) return;
        if (!validateConversationMembership(accepted.conversationId, fromUserId, accepted.participants)) return;
        if (accepted.participantId !== fromUserId) return;

        const call = get().activeCall;
        if (!call) return;
        if (call.callId !== accepted.callId || call.conversationId !== accepted.conversationId) return;
        if (!call.participants[fromUserId]) return;

        updateParticipant(fromUserId, { connectionState: 'connecting' });
        updateActiveCallState('connecting');

        const pc = ensurePeerConnection(fromUserId);
        const selfUserId = useAuthStore.getState().userId;
        if (pc && selfUserId && shouldInitiateOffer(selfUserId, fromUserId)) {
          void createAndSendOffer(fromUserId);
        }
        return;
      }

      if (msg.type === 'call_reject') {
        const rejected = parseRejectPayload(payload);
        if (!rejected) return;

        const currentIncoming = get().incomingCall;
        if (currentIncoming && currentIncoming.callId === rejected.callId) {
          set({ incomingCall: null });
        }

        const call = get().activeCall;
        const selfUserId = useAuthStore.getState().userId;
        if (!call || !selfUserId) return;
        if (call.callId !== rejected.callId || call.conversationId !== rejected.conversationId) return;

        updateParticipant(fromUserId, { connectionState: 'declined' });

        const pc = peerConnections.get(fromUserId);
        if (pc) {
          try { pc.close(); } catch {}
          peerConnections.delete(fromUserId);
        }

        if (call.mode === 'dm' || allRemoteParticipantsTerminal(call, selfUserId)) {
          await teardownCall(false, rejected.reason ?? 'rejected');
        }
        return;
      }

      if (msg.type === 'call_end') {
        const ended = parseEndPayload(payload);
        if (!ended) return;

        const currentIncoming = get().incomingCall;
        if (currentIncoming && currentIncoming.callId === ended.callId) {
          set({ incomingCall: null });
        }

        const call = get().activeCall;
        const selfUserId = useAuthStore.getState().userId;
        if (!call || !selfUserId) return;
        if (call.callId !== ended.callId || call.conversationId !== ended.conversationId) return;

        const pc = peerConnections.get(fromUserId);
        if (pc) {
          try { pc.close(); } catch {}
          peerConnections.delete(fromUserId);
        }

        updateParticipant(fromUserId, { connectionState: 'disconnected', stream: null });

        if (call.mode === 'dm' || fromUserId === call.initiatorId || allRemoteParticipantsTerminal(call, selfUserId)) {
          await teardownCall(false, ended.reason ?? 'ended');
        }
        return;
      }

      if (msg.type === 'call_media') {
        const media = parseMediaPayload(payload);
        if (!media) return;

        const call = get().activeCall;
        if (!call) return;
        if (call.callId !== media.callId || call.conversationId !== media.conversationId) return;
        if (!call.participants[fromUserId]) return;

        updateParticipant(fromUserId, {
          audioMuted: media.audioMuted,
          videoEnabled: media.videoEnabled,
        });
        return;
      }

      if (msg.type === 'call_signal') {
        const signal = parseSignalPayload(payload);
        if (!signal) return;

        const call = get().activeCall;
        if (!call) return;
        if (call.callId !== signal.callId || call.conversationId !== signal.conversationId) return;
        if (!call.participants[fromUserId]) return;

        ensurePeerConnection(fromUserId);

        if (signal.signalType === 'offer') {
          await handleOffer(fromUserId, signal);
        } else if (signal.signalType === 'answer') {
          await handleAnswer(fromUserId, signal);
        } else if (signal.signalType === 'candidate') {
          await handleCandidate(fromUserId, signal);
        }
      }
    },
  };
});
