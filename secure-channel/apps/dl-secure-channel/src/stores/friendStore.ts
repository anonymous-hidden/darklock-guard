/* ──────────────────────────────────────────────────────────
 *  Friend Store — friend requests & friend list
 * ────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { useAuthStore } from './authStore.js';

const IDS_URL = import.meta.env.VITE_IDS_URL ?? 'http://localhost:4100';

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().sessionToken;
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export interface FriendRequest {
  id: string;
  fromUser: string;
  displayName: string;
  createdAt: string;
}

export interface OutgoingRequest {
  id: string;
  toUser: string;
  displayName: string;
  status: string;
  createdAt: string;
}

export interface Friend {
  userId: string;
  displayName: string;
}

interface FriendState {
  incoming: FriendRequest[];
  outgoing: OutgoingRequest[];
  friends: Friend[];
  loading: boolean;

  fetchIncoming: (userId: string) => Promise<void>;
  fetchOutgoing: (userId: string) => Promise<void>;
  fetchFriends: (userId: string) => Promise<void>;
  addIncomingRequest: (req: FriendRequest) => void;
  removeIncoming: (requestId: string) => void;
  addFriend: (friend: Friend) => void;

  sendRequest: (fromUser: string, toUser: string) => Promise<{ status: string; requestId?: number }>;
  acceptRequest: (requestId: string, userId: string) => Promise<{ fromUser: string; toUser: string } | null>;
  rejectRequest: (requestId: string, userId: string) => Promise<boolean>;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  incoming: [],
  outgoing: [],
  friends: [],
  loading: false,

  fetchIncoming: async (userId) => {
    try {
      const res = await fetch(`${IDS_URL}/friends/requests`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      set({ incoming: data.requests ?? [] });
    } catch { /* ignore */ }
  },

  fetchOutgoing: async (userId) => {
    try {
      const res = await fetch(`${IDS_URL}/friends/requests/sent`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      set({ outgoing: data.requests ?? [] });
    } catch { /* ignore */ }
  },

  fetchFriends: async (userId) => {
    try {
      const res = await fetch(`${IDS_URL}/friends`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      set({ friends: data.friends ?? [] });
    } catch { /* ignore */ }
  },

  addIncomingRequest: (req) =>
    set((s) => {
      if (s.incoming.some(r => r.id === req.id)) return s;
      return { incoming: [req, ...s.incoming] };
    }),

  removeIncoming: (requestId) =>
    set((s) => ({ incoming: s.incoming.filter(r => r.id !== requestId) })),

  addFriend: (friend) =>
    set((s) => {
      if (s.friends.some(f => f.userId === friend.userId)) return s;
      return { friends: [...s.friends, friend] };
    }),

  sendRequest: async (fromUser, toUser) => {
    const res = await fetch(`${IDS_URL}/friends/request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ target_user_id: toUser }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { status: data.status, requestId: data.requestId };
    if (data.code === 'already_pending') return { status: 'already_sent' };
    if (data.code === 'already_friends') return { status: 'already_friends' };
    throw new Error(data.error || 'friend_request_failed');
  },

  acceptRequest: async (requestId, userId) => {
    const res = await fetch(`${IDS_URL}/friends/requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.status === 'accepted' && data.contact?.userId
      ? { fromUser: data.contact.userId, toUser: userId }
      : null;
  },

  rejectRequest: async (requestId, userId) => {
    const res = await fetch(`${IDS_URL}/friends/requests/${encodeURIComponent(requestId)}/deny`, {
      method: 'POST',
      headers: authHeaders(),
    });
    return res.ok;
  },
}));
